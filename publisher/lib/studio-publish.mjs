import path from 'node:path';

import {
  cancelPreparedPublication as defaultCancelPreparedPublication,
  confirmPreparedPublication as defaultConfirmPreparedPublication,
  prepareNotePublication as defaultPrepareNotePublication,
  preparedPublicationNeedsCleanup as defaultPreparedPublicationNeedsCleanup,
} from './publish-note.mjs';
import { readStudioDocument as defaultReadStudioDocument } from './studio-document.mjs';

const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u;

export class StudioPublicationError extends Error {
  constructor(message, code = 'studio_publication_failed', cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'StudioPublicationError';
    this.code = code;
  }
}

function studioError(message, code, cause) {
  return new StudioPublicationError(message, code, cause);
}

function workspaceFor(config, workspaceId) {
  if (typeof workspaceId !== 'string' || workspaceId === '') {
    throw studioError('workspaceId is required', 'invalid_input');
  }
  const workspace = config?.studioWorkspaces?.find(({ id }) => id === workspaceId);
  if (!workspace) throw studioError('Studio workspace was not found', 'workspace_not_found');
  return workspace;
}

function expectedFingerprint(value) {
  if (typeof value !== 'string' || !FINGERPRINT_PATTERN.test(value)) {
    throw studioError('A saved expectedFingerprint is required', 'invalid_input');
  }
  return value;
}

function publicPublication(publication = {}) {
  return {
    publishId: publication.publishId,
    ...(typeof publication.title === 'string' ? { title: publication.title } : {}),
    ...(typeof publication.publishedAt === 'string' ? { publishedAt: publication.publishedAt } : {}),
    ...(typeof publication.updatedAt === 'string' ? { updatedAt: publication.updatedAt } : {}),
    entryTargetPath: publication.entryTargetPath,
    assetTargetPaths: Array.isArray(publication.assetTargetPaths)
      ? publication.assetTargetPaths.filter((value) => typeof value === 'string')
      : [],
  };
}

function publicManifestFile(file = {}) {
  return {
    kind: file.kind,
    ...(typeof file.operation === 'string' ? { operation: file.operation } : {}),
    publishId: file.publishId,
    targetPath: file.targetPath,
    ...(typeof file.beforeSha256 === 'string' ? { beforeSha256: file.beforeSha256 } : {}),
    sha256: file.sha256,
  };
}

function publicManifest(manifest = {}) {
  return {
    version: manifest.version,
    transactionId: manifest.transactionId,
    publications: Array.isArray(manifest.publications)
      ? manifest.publications.map(publicPublication)
      : [],
    files: Array.isArray(manifest.files)
      ? manifest.files.map(publicManifestFile)
      : [],
  };
}

function publicPrepared(prepared) {
  return {
    transactionId: prepared.transactionId,
    manifest: publicManifest(prepared.manifest),
    route: prepared.route,
    previewRoot: prepared.previewRoot,
    preparedAt: prepared.preparedAt,
  };
}

export function createStudioPublisher({ config } = {}, overrides = {}) {
  if (!config || typeof config !== 'object') {
    throw studioError('A normalized Publisher config is required', 'invalid_input');
  }
  const dependencies = {
    readStudioDocument: defaultReadStudioDocument,
    prepareNotePublication: defaultPrepareNotePublication,
    confirmPreparedPublication: defaultConfirmPreparedPublication,
    cancelPreparedPublication: defaultCancelPreparedPublication,
    preparedPublicationNeedsCleanup: defaultPreparedPublicationNeedsCleanup,
    ...overrides,
  };
  let active;
  let preparing = false;
  const seenIds = new Set();

  function activeTransaction(transactionId, operation) {
    if (typeof transactionId !== 'string' || transactionId === '') {
      throw studioError('transactionId is required', 'invalid_input');
    }
    if (active?.prepared.transactionId === transactionId) {
      const allowed = operation === 'confirm'
        ? active.phase === 'prepared'
        : ['prepared', 'cleanup_required'].includes(active.phase);
      if (!allowed) {
        throw studioError('Publication transaction has already been used', 'transaction_already_used');
      }
      return active;
    }
    if (seenIds.has(transactionId)) {
      throw studioError('Publication transaction has already been used', 'transaction_already_used');
    }
    throw studioError('Prepared publication transaction was not found', 'transaction_not_found');
  }

  async function rejectPrepared(prepared, error) {
    try {
      await dependencies.cancelPreparedPublication(prepared);
    } catch (cleanupError) {
      throw studioError(
        'Rejected publication staging could not be cleaned safely',
        'transaction_rejected_cleanup_failed',
        cleanupError,
      );
    }
    throw error;
  }

  async function prepare(input = {}) {
    if (preparing || active) {
      throw studioError('Another publication transaction is already prepared', 'transaction_active');
    }
    const fingerprint = expectedFingerprint(input.expectedFingerprint);
    const workspace = workspaceFor(config, input.workspaceId);
    preparing = true;
    try {
      const document = await dependencies.readStudioDocument(config, {
        workspaceId: input.workspaceId,
        relativePath: input.relativePath,
      });
      if (document.fingerprint !== fingerprint) {
        throw studioError('Studio document changed outside the editor', 'external_change');
      }
      const relativePath = document.relativePath ?? input.relativePath;
      const prepared = await dependencies.prepareNotePublication({
        config,
        sourcePath: path.join(workspace.path, ...relativePath.split('/')),
        expectedSourceHash: fingerprint,
      });
      const transactionId = prepared?.transactionId;
      if (typeof transactionId !== 'string' || transactionId.trim() === '') {
        return await rejectPrepared(
          prepared,
          studioError('Prepared publication returned an invalid transaction ID', 'invalid_transaction_id'),
        );
      }
      if (seenIds.has(transactionId)) {
        return await rejectPrepared(
          prepared,
          studioError('Prepared publication reused a historical transaction ID', 'transaction_id_collision'),
        );
      }
      const exposed = publicPrepared(prepared);
      seenIds.add(transactionId);
      active = { prepared, phase: 'prepared' };
      return exposed;
    } finally {
      preparing = false;
    }
  }

  async function confirm({ transactionId, push } = {}) {
    if (typeof push !== 'boolean') throw studioError('push must be a boolean', 'invalid_input');
    const current = activeTransaction(transactionId, 'confirm');
    current.phase = 'confirming';
    try {
      const result = await dependencies.confirmPreparedPublication(current.prepared, { push });
      active = undefined;
      return result;
    } catch (error) {
      let cleanupRequired = true;
      try {
        cleanupRequired = dependencies.preparedPublicationNeedsCleanup(current.prepared);
      } catch {
        // An injected or interrupted confirmation cannot prove that staging is
        // terminal, so retain the only cleanup handle and fail closed.
      }
      if (cleanupRequired) {
        current.phase = 'cleanup_required';
      } else {
        active = undefined;
      }
      throw error;
    }
  }

  async function cancel({ transactionId } = {}) {
    const current = activeTransaction(transactionId, 'cancel');
    current.phase = 'canceling';
    try {
      const result = await dependencies.cancelPreparedPublication(current.prepared);
      active = undefined;
      return result;
    } catch (error) {
      let cleanupRequired = true;
      try {
        cleanupRequired = dependencies.preparedPublicationNeedsCleanup(current.prepared);
      } catch {
        // Preserve an uncertain cleanup handle rather than permit overlapping
        // repository transactions.
      }
      if (cleanupRequired) {
        current.phase = 'cleanup_required';
      } else {
        active = undefined;
      }
      throw error;
    }
  }

  return Object.freeze({ prepare, confirm, cancel });
}
