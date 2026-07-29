import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  loadStudioPublicationState,
  openStudioWorkspaceGuard,
  readStudioDocument,
} from './studio-document.mjs';
import { resolveExistingContainedPath } from './studio-paths.mjs';

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

async function stableDirectoryEntries(guard, relativeDirectory) {
  await guard.assertStable();
  const candidate = relativeDirectory === ''
    ? guard.root
    : path.join(guard.root, ...relativeDirectory.split('/'));
  const physicalDirectory = await resolveExistingContainedPath({
    root: guard.root,
    rawPath: relativeDirectory || '.',
    label: 'Studio workspace directory',
    allowRoot: true,
  });
  const before = await lstat(candidate);
  if (
    before.isSymbolicLink()
    || !before.isDirectory()
    || physicalDirectory !== candidate
  ) {
    return [];
  }
  const entries = await readdir(candidate, { withFileTypes: true });
  const [resolvedAfter, after] = await Promise.all([realpath(candidate), lstat(candidate)]);
  if (
    resolvedAfter !== physicalDirectory
    || after.isSymbolicLink()
    || !after.isDirectory()
    || before.dev !== after.dev
    || before.ino !== after.ino
  ) {
    return [];
  }
  await guard.assertStable();
  return entries;
}

async function listMarkdownFiles(guard, relativeDirectory = '') {
  const entries = await stableDirectoryEntries(guard, relativeDirectory);
  const files = [];

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      files.push(...await listMarkdownFiles(guard, relativePath));
      continue;
    }
    if (entry.isFile() && path.posix.extname(entry.name).toLowerCase() === '.md') {
      files.push(relativePath);
    }
  }
  return files;
}

function indexEntry(document) {
  const filename = path.posix.basename(document.relativePath);
  const diagnostics = document.diagnostics.map((entry) => ({
    filename: document.relativePath,
    field: typeof entry.field === 'string'
      && /^(?:<frontmatter>|[a-z_]+(?:\[\d+\])?)$/u.test(entry.field)
      ? entry.field
      : '<metadata>',
    message: entry.field === '<frontmatter>'
      ? 'Frontmatter is invalid'
      : 'Publication metadata is invalid',
    code: typeof entry.code === 'string' && /^[a-z0-9_]+$/u.test(entry.code)
      ? entry.code
      : 'invalid_metadata',
  }));
  return {
    workspaceId: document.workspaceId,
    relativePath: document.relativePath,
    filename,
    title: typeof document.metadata.title === 'string' ? document.metadata.title : undefined,
    topic: typeof document.metadata.topic === 'string' ? document.metadata.topic : undefined,
    tags: Array.isArray(document.metadata.tags)
      ? document.metadata.tags.filter((tag) => typeof tag === 'string')
      : [],
    fingerprint: document.fingerprint,
    modifiedAt: document.modifiedAt,
    status: document.status,
    diagnostics,
    search: {
      filename,
      title: typeof document.metadata.title === 'string' ? document.metadata.title : undefined,
      topic: typeof document.metadata.topic === 'string' ? document.metadata.topic : undefined,
      tags: Array.isArray(document.metadata.tags)
        ? document.metadata.tags.filter((tag) => typeof tag === 'string')
        : [],
    },
  };
}

function newestFirst(left, right) {
  const byTime = Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt);
  if (byTime !== 0) return byTime;
  return left.relativePath.localeCompare(right.relativePath, 'en');
}

export async function scanStudioWorkspace(config) {
  if (!Array.isArray(config?.studioWorkspaces)) return [];
  const workspaces = [];
  const publicationState = await loadStudioPublicationState(config);

  for (const workspace of config.studioWorkspaces) {
    const guard = await openStudioWorkspaceGuard(config, workspace.id);
    try {
      const relativePaths = await listMarkdownFiles(guard);
      const documents = [];
      for (const relativePath of relativePaths) {
        try {
          const document = await readStudioDocument(config, {
            workspaceId: workspace.id,
            relativePath: toPosixPath(relativePath),
          }, {
            publicationState,
          });
          documents.push(indexEntry(document));
        } catch (error) {
          if (!['document_not_found', 'unsafe_path'].includes(error?.code)) throw error;
        }
      }
      await guard.assertStable();
      documents.sort(newestFirst);
      workspaces.push({
        id: workspace.id,
        label: workspace.label,
        documents,
      });
    } finally {
      await guard.close();
    }
  }
  return workspaces;
}
