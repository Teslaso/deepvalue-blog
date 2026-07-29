import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { buildAssetIndex as defaultBuildAssetIndex } from './assets.mjs';
import { createStateStore as defaultCreateStateStore } from './state-store.mjs';
import {
  applyPublicationTransaction as defaultApplyPublicationTransaction,
  buildTransactionPreview as defaultBuildTransactionPreview,
  cancelPublicationTransaction as defaultCancelPublicationTransaction,
  confirmPublicationTransaction as defaultConfirmPublicationTransaction,
  createPublicationTransaction as defaultCreatePublicationTransaction,
} from './transaction.mjs';
import { transformNote as defaultTransformNote } from './transform.mjs';
import { assertValidPublicationNote as defaultAssertValidPublicationNote } from './validate.mjs';
import {
  buildVaultIndex as defaultBuildVaultIndex,
  scanCurrentNote as defaultScanCurrentNote,
} from './vault-index.mjs';

const preparedContexts = new WeakMap();
const SOURCE_HASH_PATTERN = /^(?:sha256:)?[a-f0-9]{64}$/iu;
const CANCELABLE_TRANSACTION_STATES = new Set([
  'staged',
  'previewed',
  'preview_failed',
  'apply_failed',
  'rolled_back',
]);

export class PublicationPreparationError extends Error {
  constructor(message, code = 'publication_preparation_failed', cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PublicationPreparationError';
    this.code = code;
  }
}

function preparationError(message, code, cause) {
  return new PublicationPreparationError(message, code, cause);
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function realpathAllowMissing(candidate) {
  const suffix = [];
  let current = candidate;
  while (true) {
    try {
      return path.resolve(await realpath(current), ...suffix);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

function safeManifestTarget(value) {
  if (
    typeof value !== 'string'
    || value === ''
    || value.includes('\0')
    || value.includes('\\')
    || path.posix.isAbsolute(value)
    || path.win32.isAbsolute(value)
  ) {
    throw new TypeError('Manifest target must be a safe repository-relative path');
  }
  const normalized = path.posix.normalize(value);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new TypeError('Manifest target must stay inside the repository');
  }
  return normalized;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function publicManifestFile(file) {
  return {
    kind: file.kind,
    ...(file.operation ? { operation: file.operation } : {}),
    publishId: file.publishId,
    targetPath: file.targetPath,
    ...(file.beforeSha256 ? { beforeSha256: file.beforeSha256 } : {}),
    sha256: file.sha256,
  };
}

export async function buildDisplayManifest(manifest, { repoRoot } = {}) {
  if (!manifest || !Array.isArray(manifest.files) || !Array.isArray(manifest.publications)) {
    throw new TypeError('A publication transaction manifest is required');
  }
  const physicalRepoRoot = await realpath(repoRoot);
  const display = structuredClone(manifest);

  display.files = await Promise.all(display.files.map(async (rawFile) => {
    const file = publicManifestFile(rawFile);
    const targetPath = safeManifestTarget(file.targetPath);
    const destination = path.join(physicalRepoRoot, ...targetPath.split('/'));
    const physicalDestination = await realpathAllowMissing(destination);
    if (!isInside(physicalRepoRoot, physicalDestination)) {
      return { ...file, operation: 'conflict' };
    }

    try {
      const details = await lstat(destination);
      if (!details.isFile() || details.isSymbolicLink()) {
        return { ...file, operation: 'conflict' };
      }
      const beforeSha256 = sha256(await readFile(destination));
      return {
        ...file,
        operation: beforeSha256 === file.sha256 ? 'unchanged' : 'update',
        beforeSha256,
      };
    } catch (error) {
      if (error?.code === 'ENOENT') return { ...file, operation: 'create' };
      throw error;
    }
  }));
  return display;
}

export function formatDisplayManifest(manifest) {
  const lines = ['Publication manifest (exact targets):', '  Notes:'];
  for (const publication of manifest.publications) {
    lines.push(`    - ${publication.title || publication.publishId} [${publication.publishId}]`);
    lines.push(`      source: ${publication.sourcePath}`);
  }
  lines.push('  Files:');
  for (const file of manifest.files) {
    lines.push(`    - ${(file.operation || file.kind).toUpperCase()} ${file.targetPath}`);
    if (file.beforeSha256) lines.push(`      before sha256:${file.beforeSha256}`);
    lines.push(`      after sha256:${file.sha256}`);
  }
  return lines.join('\n');
}

function publicationRoute(note) {
  return `/blog/${encodeURIComponent(note.publishId)}/`;
}

function contextFor(prepared) {
  const context = prepared && typeof prepared === 'object'
    ? preparedContexts.get(prepared)
    : undefined;
  if (!context) {
    throw preparationError('Unknown prepared publication', 'transaction_not_found');
  }
  return context;
}

async function cancelTransactionIfPossible(context) {
  if (!CANCELABLE_TRANSACTION_STATES.has(context.transaction.status)) return;
  await context.dependencies.cancelPublicationTransaction(context.transaction);
}

function consume(context) {
  if (context.status !== 'prepared') {
    throw preparationError('Prepared publication has already been used', 'transaction_already_used');
  }
  context.status = 'used';
}

export async function prepareNotePublication(input = {}, overrides = {}) {
  const dependencies = {
    createStateStore: defaultCreateStateStore,
    buildVaultIndex: defaultBuildVaultIndex,
    scanCurrentNote: defaultScanCurrentNote,
    assertValidPublicationNote: defaultAssertValidPublicationNote,
    buildAssetIndex: defaultBuildAssetIndex,
    transformNote: defaultTransformNote,
    createPublicationTransaction: defaultCreatePublicationTransaction,
    buildTransactionPreview: defaultBuildTransactionPreview,
    buildDisplayManifest,
    applyPublicationTransaction: defaultApplyPublicationTransaction,
    confirmPublicationTransaction: defaultConfirmPublicationTransaction,
    cancelPublicationTransaction: defaultCancelPublicationTransaction,
    write: () => {},
    now: () => new Date(),
    ...overrides,
  };
  const { config, sourcePath } = input;
  if (!config || typeof config !== 'object') {
    throw preparationError('A normalized Publisher config is required', 'invalid_input');
  }
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) {
    throw preparationError('An absolute sourcePath is required', 'invalid_input');
  }
  if (
    input.expectedSourceHash !== undefined
    && (
      typeof input.expectedSourceHash !== 'string'
      || !SOURCE_HASH_PATTERN.test(input.expectedSourceHash)
    )
  ) {
    throw preparationError('expectedSourceHash must be a SHA-256 digest', 'invalid_input');
  }
  if (input.allowPush !== undefined && typeof input.allowPush !== 'boolean') {
    throw preparationError('allowPush must be a boolean', 'invalid_input');
  }

  const stateStore = dependencies.createStateStore({ repoRoot: config.repoRoot });
  const state = await stateStore.readState();
  const vaultIndex = await dependencies.buildVaultIndex({
    vaultRoot: config.vaultRoot,
    ignoreFolders: config.ignoreFolders,
  });
  const selectedNote = await dependencies.scanCurrentNote({
    vaultRoot: config.vaultRoot,
    sourcePath,
    ignoreFolders: config.ignoreFolders,
  });
  if (!selectedNote) {
    throw preparationError(
      'The current note is not eligible; add the YAML boolean publish: true',
      'note_not_eligible',
    );
  }
  if (
    input.expectedSourceHash !== undefined
    && selectedNote.sourceHash.toLowerCase()
      !== input.expectedSourceHash.replace(/^sha256:/iu, '').toLowerCase()
  ) {
    throw preparationError(
      'The saved document changed before publication preparation',
      'external_change',
    );
  }

  dependencies.assertValidPublicationNote({
    filename: selectedNote.sourcePath,
    data: selectedNote.data,
    body: selectedNote.body,
  });
  if (selectedNote.suggestedField) {
    dependencies.write(
      `Suggested stable identity for ${selectedNote.sourcePath}: ${selectedNote.suggestedField}`,
    );
  }

  const assetIndex = await dependencies.buildAssetIndex({
    vaultRoot: config.vaultRoot,
    attachmentRoots: config.attachmentRoots,
  });
  const transformedNote = await dependencies.transformNote({
    note: selectedNote,
    vaultIndex,
    assetIndex,
    includeInlineHashtags: config.includeInlineHashtags,
    publicPublishIds: new Set([
      ...Object.keys(state.entries ?? {}),
      selectedNote.publishId,
    ]),
  });
  const transaction = await dependencies.createPublicationTransaction({
    repoRoot: config.repoRoot,
    entryOutputDir: config.entryOutputDir,
    mediaOutputDir: config.mediaOutputDir,
    vaultRoot: config.vaultRoot,
    notes: [transformedNote],
    state,
  });

  try {
    const preview = await dependencies.buildTransactionPreview(transaction);
    const displayManifest = await dependencies.buildDisplayManifest(transaction.manifest, {
      repoRoot: config.repoRoot,
    });
    const timestamp = dependencies.now();
    const preparedAt = timestamp instanceof Date
      ? timestamp.toISOString()
      : new Date(timestamp).toISOString();
    const prepared = Object.freeze({
      transactionId: transaction.id ?? transaction.manifest.transactionId,
      manifest: displayManifest,
      route: publicationRoute(transformedNote),
      previewRoot: path.join(preview.root, 'dist'),
      preparedAt,
    });
    preparedContexts.set(prepared, {
      transaction,
      stateStore,
      dependencies,
      allowPush: input.allowPush ?? true,
      status: 'prepared',
    });
    return prepared;
  } catch (error) {
    try {
      await cancelTransactionIfPossible({ transaction, dependencies });
    } catch (cleanupError) {
      dependencies.write(`Temporary transaction cleanup failed: ${cleanupError.message}`);
    }
    throw error;
  }
}

export async function confirmPreparedPublication(prepared, { push = true } = {}) {
  const context = contextFor(prepared);
  if (typeof push !== 'boolean') {
    throw preparationError('push must be a boolean', 'invalid_input');
  }
  if (push && !context.allowPush) {
    throw preparationError('Push is disabled for this publication', 'push_not_allowed');
  }
  consume(context);
  try {
    const currentState = await context.stateStore.readState();
    await context.dependencies.applyPublicationTransaction(context.transaction, {
      state: currentState,
    });
    return await context.dependencies.confirmPublicationTransaction(context.transaction, {
      stateStore: context.stateStore,
      push,
    });
  } catch (error) {
    try {
      await cancelTransactionIfPossible(context);
    } catch (cleanupError) {
      context.dependencies.write(`Temporary transaction cleanup failed: ${cleanupError.message}`);
    }
    throw error;
  }
}

export async function cancelPreparedPublication(prepared) {
  const context = contextFor(prepared);
  consume(context);
  return context.dependencies.cancelPublicationTransaction(context.transaction);
}
