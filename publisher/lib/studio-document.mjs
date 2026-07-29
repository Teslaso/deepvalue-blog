import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  link,
  lstat,
  open,
  realpath,
  rename,
  rm,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';

import {
  resolveExistingContainedPath,
  resolveMissingContainedPath,
} from './studio-paths.mjs';
import {
  parseStudioDocument,
  serializeStudioDocument,
} from './studio-frontmatter.mjs';
import { createStateStore } from './state-store.mjs';
import { validatePublicationNote } from './validate.mjs';

const updateQueues = new Map();
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

export class StudioDocumentError extends Error {
  constructor(message, code = 'document_error', cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'StudioDocumentError';
    this.code = code;
  }
}

function documentError(message, code, cause) {
  return new StudioDocumentError(message, code, cause);
}

function sameIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function sameSnapshot(left, right) {
  return sameIdentity(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function toNativePath(root, relativePath) {
  return path.join(root, ...relativePath.split('/'));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw documentError('Studio documents must contain valid UTF-8', 'invalid_encoding', error);
  }
}

function normalizedRelativeMarkdownPath(value) {
  if (
    typeof value !== 'string'
    || value === ''
    || value.includes('\0')
    || value.includes('\\')
    || value.trim() !== value
    || path.isAbsolute(value)
    || path.win32.isAbsolute(value)
  ) {
    throw documentError('Document path must be a safe POSIX relative path', 'unsafe_path');
  }

  const normalized = path.posix.normalize(value);
  if (
    normalized !== value
    || normalized === '.'
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized.startsWith('/')
    || path.posix.extname(normalized).toLowerCase() !== '.md'
  ) {
    throw documentError('Document path must be a safe Markdown path', 'unsafe_path');
  }
  return normalized;
}

function expectedFingerprint(value) {
  if (typeof value !== 'string' || !FINGERPRINT_PATTERN.test(value)) {
    throw documentError('A valid expectedFingerprint is required', 'invalid_input');
  }
  return value;
}

function workspaceFromConfig(config, workspaceId) {
  if (typeof workspaceId !== 'string' || workspaceId === '') {
    throw documentError('workspaceId is required', 'invalid_input');
  }
  const workspace = config?.studioWorkspaces?.find(({ id }) => id === workspaceId);
  if (!workspace) {
    throw documentError('Configured studio workspace was not found', 'workspace_not_found');
  }
  if (typeof workspace.path !== 'string' || !path.isAbsolute(workspace.path)) {
    throw documentError('Configured studio workspace is not normalized', 'unsafe_path');
  }
  return workspace;
}

async function safeLstat(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw documentError('Studio document was not found', 'document_not_found', error);
    }
    throw error;
  }
}

async function assertNoSymlinkSegments(root, relativePath, { includeLeaf = true } = {}) {
  const segments = relativePath === '.' ? [] : relativePath.split('/');
  const checked = includeLeaf ? segments : segments.slice(0, -1);
  let candidate = root;
  for (const segment of checked) {
    candidate = path.join(candidate, segment);
    let details;
    try {
      details = await lstat(candidate);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw documentError('Studio path does not exist', 'document_not_found', error);
      }
      throw error;
    }
    if (details.isSymbolicLink()) {
      throw documentError('Studio paths must never contain symlinks', 'unsafe_path');
    }
  }
}

/**
 * Binds an operation to the normalized physical workspace directory.
 * The open directory handle makes replacement detectable throughout the operation.
 */
export async function openStudioWorkspaceGuard(config, workspaceId) {
  const workspace = workspaceFromConfig(config, workspaceId);
  const root = path.resolve(workspace.path);
  let rootHandle;
  let identity;

  try {
    const [resolvedRoot, pathStats] = await Promise.all([realpath(root), lstat(root)]);
    if (
      resolvedRoot !== root
      || pathStats.isSymbolicLink()
      || !pathStats.isDirectory()
    ) {
      throw new Error('workspace is not a physical directory');
    }
    rootHandle = await open(
      root,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    const handleStats = await rootHandle.stat();
    if (!handleStats.isDirectory() || !sameIdentity(pathStats, handleStats)) {
      throw new Error('workspace identity changed while opening');
    }
    identity = { dev: handleStats.dev, ino: handleStats.ino };
  } catch (error) {
    if (rootHandle) await rootHandle.close().catch(() => {});
    throw documentError('Studio workspace is not a stable physical directory', 'unsafe_path', error);
  }

  let closed = false;
  return {
    workspace,
    root,
    identity,
    async assertStable() {
      if (closed) throw documentError('Studio workspace guard is closed', 'unsafe_path');
      try {
        const [resolvedRoot, pathStats, handleStats] = await Promise.all([
          realpath(root),
          lstat(root),
          rootHandle.stat(),
        ]);
        if (
          resolvedRoot !== root
          || pathStats.isSymbolicLink()
          || !pathStats.isDirectory()
          || !sameIdentity(identity, pathStats)
          || !sameIdentity(identity, handleStats)
        ) {
          throw new Error('workspace identity changed');
        }
      } catch (error) {
        throw documentError('Studio workspace changed during the operation', 'unsafe_path', error);
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await rootHandle.close();
    },
  };
}

async function openParentGuard(workspaceGuard, parentRelativePath) {
  const relativePath = parentRelativePath === '.' ? '.' : parentRelativePath;
  if (relativePath !== '.') {
    normalizedRelativeMarkdownPath(`${relativePath}/placeholder.md`);
  }
  await workspaceGuard.assertStable();
  await assertNoSymlinkSegments(workspaceGuard.root, relativePath);

  const candidate = relativePath === '.'
    ? workspaceGuard.root
    : toNativePath(workspaceGuard.root, relativePath);
  let parentHandle;
  let physicalParent;
  let identity;

  try {
    physicalParent = await resolveExistingContainedPath({
      root: workspaceGuard.root,
      rawPath: relativePath,
      label: 'Studio document parent',
      allowRoot: true,
    });
    const pathStats = await lstat(candidate);
    if (
      pathStats.isSymbolicLink()
      || !pathStats.isDirectory()
      || physicalParent !== candidate
    ) {
      throw new Error('document parent is not a physical directory');
    }
    parentHandle = await open(
      candidate,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    const handleStats = await parentHandle.stat();
    if (!handleStats.isDirectory() || !sameIdentity(pathStats, handleStats)) {
      throw new Error('document parent identity changed while opening');
    }
    identity = { dev: handleStats.dev, ino: handleStats.ino };
  } catch (error) {
    if (parentHandle) await parentHandle.close().catch(() => {});
    throw documentError('Studio document parent is not safe', 'unsafe_path', error);
  }

  let closed = false;
  return {
    path: candidate,
    identity,
    async assertStable() {
      if (closed) throw documentError('Studio parent guard is closed', 'unsafe_path');
      await workspaceGuard.assertStable();
      try {
        const [resolvedNow, pathStats, handleStats] = await Promise.all([
          realpath(candidate),
          lstat(candidate),
          parentHandle.stat(),
        ]);
        if (
          resolvedNow !== physicalParent
          || pathStats.isSymbolicLink()
          || !pathStats.isDirectory()
          || !sameIdentity(identity, pathStats)
          || !sameIdentity(identity, handleStats)
        ) {
          throw new Error('document parent identity changed');
        }
      } catch (error) {
        throw documentError('Studio document parent changed during the operation', 'unsafe_path', error);
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await parentHandle.close();
    },
  };
}

async function secureRead(workspaceGuard, relativePath) {
  await workspaceGuard.assertStable();
  await assertNoSymlinkSegments(workspaceGuard.root, relativePath);
  const candidate = toNativePath(workspaceGuard.root, relativePath);
  let handle;

  try {
    const lexicalStats = await safeLstat(candidate);
    if (lexicalStats.isSymbolicLink() || !lexicalStats.isFile()) {
      throw documentError('Studio document must be a regular file', 'unsafe_path');
    }
    const physicalCandidate = await resolveExistingContainedPath({
      root: workspaceGuard.root,
      rawPath: relativePath,
      label: 'Studio document',
      allowRoot: false,
    });
    if (physicalCandidate !== candidate) {
      throw documentError('Studio document path contains a symlink', 'unsafe_path');
    }

    handle = await open(
      candidate,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const before = await handle.stat();
    const currentPathStats = await lstat(candidate);
    if (
      !before.isFile()
      || currentPathStats.isSymbolicLink()
      || !sameIdentity(before, lexicalStats)
      || !sameIdentity(before, currentPathStats)
    ) {
      throw documentError('Studio document identity changed while opening', 'external_change');
    }
    await workspaceGuard.assertStable();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameSnapshot(before, after)) {
      throw documentError('Studio document changed while it was being read', 'external_change');
    }
    return { bytes, stats: after, identity: { dev: after.dev, ino: after.ino } };
  } catch (error) {
    if (error instanceof StudioDocumentError) throw error;
    if (error?.code === 'ELOOP') {
      throw documentError('Studio documents must never be symlinks', 'unsafe_path', error);
    }
    if (error?.code === 'ENOENT') {
      throw documentError('Studio document was not found', 'document_not_found', error);
    }
    throw error;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function sanitizedParseDiagnostics(error, relativePath) {
  const code = error?.diagnostics?.[0]?.code ?? 'invalid_frontmatter';
  const messages = {
    invalid_yaml: 'YAML frontmatter is invalid',
    malformed_frontmatter: 'YAML frontmatter is malformed',
    invalid_source: 'Markdown source is invalid',
  };
  return [{
    filename: relativePath,
    field: '<frontmatter>',
    message: messages[code] ?? 'Frontmatter could not be parsed',
    code,
  }];
}

export async function loadStudioPublicationState(config) {
  if (typeof config?.repoRoot !== 'string' || !path.isAbsolute(config.repoRoot)) {
    return undefined;
  }
  return createStateStore({ repoRoot: config.repoRoot }).readState();
}

function publicationStateEntry(config, workspaceId, relativePath, parsed, publicationState) {
  const entries = publicationState?.entries;
  if (!entries || typeof entries !== 'object') return undefined;
  if (parsed.known.publish_id && entries[parsed.known.publish_id]) {
    return entries[parsed.known.publish_id];
  }

  const workspace = config?.studioWorkspaces?.find(({ id }) => id === workspaceId);
  if (
    typeof config?.vaultRoot !== 'string'
    || typeof workspace?.path !== 'string'
    || !path.isAbsolute(config.vaultRoot)
  ) {
    return undefined;
  }
  const sourcePath = path.relative(
    config.vaultRoot,
    toNativePath(workspace.path, relativePath),
  );
  if (
    sourcePath === ''
    || sourcePath === '..'
    || sourcePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(sourcePath)
  ) {
    return undefined;
  }
  const portableSourcePath = sourcePath.split(path.sep).join('/');
  return Object.values(entries).find((entry) => entry?.sourcePath === portableSourcePath);
}

function statusFor(
  config,
  workspaceId,
  parsed,
  relativePath,
  fingerprint,
  publicationState,
) {
  if (parsed.known.publish !== true) {
    return { status: 'draft', diagnostics: [] };
  }
  const diagnostics = validatePublicationNote({
    filename: relativePath,
    data: parsed.known,
    body: parsed.body,
  });
  if (diagnostics.length > 0) return { status: 'invalid', diagnostics };
  const stateEntry = publicationStateEntry(
    config,
    workspaceId,
    relativePath,
    parsed,
    publicationState,
  );
  if (!stateEntry?.lastPublishedSourceHash) {
    return { status: 'ready', diagnostics: [] };
  }
  const publishedFingerprint = stateEntry.lastPublishedSourceHash
    .replace(/^sha256:/iu, '')
    .toLowerCase();
  return {
    status: publishedFingerprint === fingerprint ? 'published' : 'modified',
    diagnostics: [],
  };
}

function documentFromRead(config, workspaceId, relativePath, readResult, publicationState) {
  const source = decodeUtf8(readResult.bytes);
  const base = {
    workspaceId,
    relativePath,
    source,
    fingerprint: sha256(readResult.bytes),
    modifiedAt: readResult.stats.mtime.toISOString(),
  };

  try {
    const parsed = parseStudioDocument(source, { filename: relativePath });
    const { status, diagnostics } = statusFor(
      config,
      workspaceId,
      parsed,
      relativePath,
      base.fingerprint,
      publicationState,
    );
    return {
      ...base,
      body: parsed.body,
      metadata: parsed.data,
      status,
      diagnostics,
    };
  } catch (error) {
    return {
      ...base,
      body: source,
      metadata: {},
      status: 'invalid',
      diagnostics: sanitizedParseDiagnostics(error, relativePath),
    };
  }
}

export async function readStudioDocument(
  config,
  { workspaceId, relativePath } = {},
  { publicationState } = {},
) {
  const normalizedPath = normalizedRelativeMarkdownPath(relativePath);
  const guard = await openStudioWorkspaceGuard(config, workspaceId);
  try {
    const readResult = await secureRead(guard, normalizedPath);
    const effectivePublicationState = publicationState === undefined
      ? await loadStudioPublicationState(config)
      : publicationState;
    return documentFromRead(
      config,
      workspaceId,
      normalizedPath,
      readResult,
      effectivePublicationState,
    );
  } finally {
    await guard.close();
  }
}

function safeFilename(title) {
  if (typeof title !== 'string' || title.trim() === '') {
    throw documentError('A non-empty title is required', 'invalid_input');
  }
  let filename = title.normalize('NFKC').trim();
  filename = filename.replace(/\.md$/iu, '');
  filename = filename
    .replaceAll(/[\u0000-\u001f\u007f/\\:*?"<>|]/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .replaceAll(/^[.\s]+|[.\s]+$/gu, '');
  if (filename === '' || filename === '.' || filename === '..' || WINDOWS_RESERVED_NAME.test(filename)) {
    filename = 'Untitled';
  }
  const maxBaseBytes = 220;
  while (Buffer.byteLength(filename, 'utf8') > maxBaseBytes) {
    filename = [...filename].slice(0, -1).join('').trimEnd();
  }
  return `${filename || 'Untitled'}.md`;
}

function nextSource(currentSource, input) {
  if (Object.hasOwn(input, 'source')) {
    if (typeof input.source !== 'string') {
      throw documentError('Document source must be a string', 'invalid_input');
    }
    return input.source;
  }
  return serializeStudioDocument({
    source: currentSource,
    patch: input.patch ?? {},
    body: input.body,
  });
}

function assertPublishIdStable(currentSource, replacementSource) {
  let current;
  try {
    current = parseStudioDocument(currentSource);
  } catch {
    return;
  }
  const publishId = current.data.publish_id;
  if (publishId === undefined || publishId === null || publishId === '') return;

  let replacement;
  try {
    replacement = parseStudioDocument(replacementSource);
  } catch (error) {
    throw documentError('publish_id is locked once it has been set', 'publish_id_locked', error);
  }
  if (replacement.data.publish_id !== publishId) {
    throw documentError('publish_id is locked once it has been set', 'publish_id_locked');
  }
}

function queueKey(root, relativePath) {
  const key = path.join(root, ...relativePath.split('/'));
  return process.platform === 'win32' ? key.toLowerCase() : key;
}

async function enqueue(key, operation) {
  const previous = updateQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  updateQueues.set(key, current);
  try {
    return await current;
  } finally {
    if (updateQueues.get(key) === current) updateQueues.delete(key);
  }
}

async function createTemporarySibling(parentGuard, basename, bytes) {
  await parentGuard.assertStable();
  const temporaryPath = path.join(
    parentGuard.path,
    `.${basename}.studio-tmp-${process.pid}-${Date.now()}-${randomUUID()}`,
  );
  let handle;
  let identity;

  try {
    handle = await open(
      temporaryPath,
      constants.O_WRONLY
        | constants.O_CREAT
        | constants.O_EXCL
        | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.chmod(0o600);
    const openedStats = await handle.stat();
    identity = { dev: openedStats.dev, ino: openedStats.ino };
    const [pathStats, resolvedTemporary] = await Promise.all([
      lstat(temporaryPath),
      realpath(temporaryPath),
    ]);
    if (
      !openedStats.isFile()
      || pathStats.isSymbolicLink()
      || !sameIdentity(openedStats, pathStats)
      || path.dirname(resolvedTemporary) !== parentGuard.path
    ) {
      throw documentError('Temporary document escaped its stable parent', 'unsafe_path');
    }
    await parentGuard.assertStable();
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await parentGuard.assertStable();
    return { path: temporaryPath, identity };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await cleanupTemporary(parentGuard, temporaryPath, identity);
    throw error;
  }
}

async function cleanupTemporary(parentGuard, temporaryPath, identity) {
  if (!identity) return;
  try {
    await parentGuard.assertStable();
    const remaining = await lstat(temporaryPath);
    if (!remaining.isSymbolicLink() && sameIdentity(identity, remaining)) {
      await rm(temporaryPath, { force: true });
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      // Do not attempt cleanup through a parent that is no longer trusted.
    }
  }
}

async function assertUnchanged(workspaceGuard, relativePath, fingerprint, identity) {
  const current = await secureRead(workspaceGuard, relativePath);
  if (!sameIdentity(current.identity, identity) || sha256(current.bytes) !== fingerprint) {
    throw documentError('Studio document changed outside the editor', 'external_change');
  }
  return current;
}

export async function saveStudioDocument(config, input = {}) {
  const relativePath = normalizedRelativeMarkdownPath(input.relativePath);
  const fingerprint = expectedFingerprint(input.expectedFingerprint);
  const workspace = workspaceFromConfig(config, input.workspaceId);

  return enqueue(queueKey(workspace.path, relativePath), async () => {
    const guard = await openStudioWorkspaceGuard(config, input.workspaceId);
    const parent = await openParentGuard(guard, path.posix.dirname(relativePath));
    let temporary;
    try {
      const opened = await secureRead(guard, relativePath);
      if (sha256(opened.bytes) !== fingerprint) {
        throw documentError('Studio document changed outside the editor', 'external_change');
      }
      const currentSource = decodeUtf8(opened.bytes);
      const replacementSource = nextSource(currentSource, input);
      assertPublishIdStable(currentSource, replacementSource);
      const replacementBytes = Buffer.from(replacementSource, 'utf8');
      temporary = await createTemporarySibling(
        parent,
        path.posix.basename(relativePath),
        replacementBytes,
      );

      await assertUnchanged(guard, relativePath, fingerprint, opened.identity);
      await parent.assertStable();
      await rename(temporary.path, toNativePath(guard.root, relativePath));
      const finalStats = await lstat(toNativePath(guard.root, relativePath));
      if (
        finalStats.isSymbolicLink()
        || !sameIdentity(temporary.identity, finalStats)
      ) {
        throw documentError('Atomic document replacement did not retain its identity', 'unsafe_path');
      }
      temporary = undefined;
      await parent.assertStable();
      return await readStudioDocument(config, {
        workspaceId: input.workspaceId,
        relativePath,
      });
    } finally {
      if (temporary) await cleanupTemporary(parent, temporary.path, temporary.identity);
      await parent.close();
      await guard.close();
    }
  });
}

function createSource(input) {
  if (Object.hasOwn(input, 'source')) {
    if (typeof input.source !== 'string') {
      throw documentError('Document source must be a string', 'invalid_input');
    }
    return input.source;
  }
  const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
    ? input.metadata
    : {};
  return serializeStudioDocument({
    source: '',
    patch: { ...metadata, title: metadata.title ?? input.title },
    body: input.body ?? '',
  });
}

async function createAtAvailablePath(guard, parent, filename, bytes) {
  const extension = path.posix.extname(filename);
  const basename = path.posix.basename(filename, extension);
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const candidateName = suffix === 1 ? filename : `${basename} ${suffix}${extension}`;
    const relativePath = candidateName;
    const targetPath = toNativePath(guard.root, relativePath);
    const prospective = await resolveMissingContainedPath({
      root: guard.root,
      rawPath: relativePath,
      label: 'New studio document',
      allowRoot: false,
    });
    if (prospective !== targetPath) {
      throw documentError('New studio document path is not physical', 'unsafe_path');
    }

    const temporary = await createTemporarySibling(parent, candidateName, bytes);
    try {
      await parent.assertStable();
      try {
        await link(temporary.path, targetPath);
      } catch (error) {
        if (error?.code === 'EEXIST') continue;
        throw error;
      }
      const targetStats = await lstat(targetPath);
      if (targetStats.isSymbolicLink() || !sameIdentity(temporary.identity, targetStats)) {
        throw documentError('Created document identity was not stable', 'unsafe_path');
      }
      await rm(temporary.path, { force: true });
      return relativePath;
    } finally {
      await cleanupTemporary(parent, temporary.path, temporary.identity);
    }
  }
  throw documentError('Could not allocate a unique document filename', 'destination_exists');
}

export async function createStudioDocument(config, input = {}) {
  const workspace = workspaceFromConfig(config, input.workspaceId);
  const filename = safeFilename(input.title);
  const source = createSource(input);
  const bytes = Buffer.from(source, 'utf8');

  return enqueue(queueKey(workspace.path, '<create>'), async () => {
    const guard = await openStudioWorkspaceGuard(config, input.workspaceId);
    const parent = await openParentGuard(guard, '.');
    try {
      const relativePath = await createAtAvailablePath(guard, parent, filename, bytes);
      return await readStudioDocument(config, {
        workspaceId: input.workspaceId,
        relativePath,
      });
    } finally {
      await parent.close();
      await guard.close();
    }
  });
}

function renameDestination(input, sourceRelativePath) {
  if (Object.hasOwn(input, 'newRelativePath')) {
    return normalizedRelativeMarkdownPath(input.newRelativePath);
  }
  const parent = path.posix.dirname(sourceRelativePath);
  const filename = safeFilename(input.title);
  return parent === '.' ? filename : `${parent}/${filename}`;
}

export async function renameStudioDocument(config, input = {}) {
  const sourceRelativePath = normalizedRelativeMarkdownPath(input.relativePath);
  const fingerprint = expectedFingerprint(input.expectedFingerprint);
  const destinationRelativePath = renameDestination(input, sourceRelativePath);
  const workspace = workspaceFromConfig(config, input.workspaceId);
  if (destinationRelativePath === sourceRelativePath) {
    return readStudioDocument(config, {
      workspaceId: input.workspaceId,
      relativePath: sourceRelativePath,
    });
  }

  return enqueue(queueKey(workspace.path, sourceRelativePath), async () => {
    const guard = await openStudioWorkspaceGuard(config, input.workspaceId);
    const sourceParent = await openParentGuard(guard, path.posix.dirname(sourceRelativePath));
    const destinationParentPath = path.posix.dirname(destinationRelativePath);
    const destinationParent = destinationParentPath === path.posix.dirname(sourceRelativePath)
      ? sourceParent
      : await openParentGuard(guard, destinationParentPath);
    let destinationLinked = false;
    let sourceIdentity;

    try {
      const opened = await secureRead(guard, sourceRelativePath);
      sourceIdentity = opened.identity;
      if (sha256(opened.bytes) !== fingerprint) {
        throw documentError('Studio document changed outside the editor', 'external_change');
      }
      await resolveMissingContainedPath({
        root: guard.root,
        rawPath: destinationRelativePath,
        label: 'Renamed studio document',
        allowRoot: false,
      });
      await assertNoSymlinkSegments(guard.root, destinationRelativePath, { includeLeaf: false });
      await assertUnchanged(guard, sourceRelativePath, fingerprint, sourceIdentity);
      await Promise.all([sourceParent.assertStable(), destinationParent.assertStable()]);

      try {
        await link(
          toNativePath(guard.root, sourceRelativePath),
          toNativePath(guard.root, destinationRelativePath),
        );
        destinationLinked = true;
      } catch (error) {
        if (error?.code === 'EEXIST') {
          throw documentError('Rename destination already exists', 'destination_exists', error);
        }
        throw error;
      }

      const destinationStats = await lstat(toNativePath(guard.root, destinationRelativePath));
      if (destinationStats.isSymbolicLink() || !sameIdentity(sourceIdentity, destinationStats)) {
        throw documentError('Rename destination identity was not stable', 'unsafe_path');
      }
      await unlink(toNativePath(guard.root, sourceRelativePath));
      destinationLinked = false;
      await Promise.all([sourceParent.assertStable(), destinationParent.assertStable()]);
      return await readStudioDocument(config, {
        workspaceId: input.workspaceId,
        relativePath: destinationRelativePath,
      });
    } finally {
      if (destinationLinked && sourceIdentity) {
        try {
          await destinationParent.assertStable();
          const remaining = await lstat(toNativePath(guard.root, destinationRelativePath));
          if (!remaining.isSymbolicLink() && sameIdentity(sourceIdentity, remaining)) {
            await unlink(toNativePath(guard.root, destinationRelativePath));
          }
        } catch {
          // Do not unlink through a parent whose identity can no longer be trusted.
        }
      }
      if (destinationParent !== sourceParent) await destinationParent.close();
      await sourceParent.close();
      await guard.close();
    }
  });
}
