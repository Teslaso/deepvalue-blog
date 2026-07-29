import path from 'node:path';

import {
  cancelPreparedPublication as defaultCancelPreparedPublication,
  confirmPreparedPublication as defaultConfirmPreparedPublication,
  prepareNotePublication as defaultPrepareNotePublication,
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

function publicPrepared(prepared) {
  return {
    transactionId: prepared.transactionId,
    manifest: prepared.manifest,
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
    ...overrides,
  };
  let active;
  let preparing = false;
  const usedIds = new Set();

  function activeTransaction(transactionId) {
    if (typeof transactionId !== 'string' || transactionId === '') {
      throw studioError('transactionId is required', 'invalid_input');
    }
    if (!active || active.prepared.transactionId !== transactionId) {
      if (usedIds.has(transactionId)) {
        throw studioError('Publication transaction has already been used', 'transaction_already_used');
      }
      throw studioError('Prepared publication transaction was not found', 'transaction_not_found');
    }
    return active;
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
      active = { prepared };
      return publicPrepared(prepared);
    } finally {
      preparing = false;
    }
  }

  async function confirm({ transactionId, push } = {}) {
    if (typeof push !== 'boolean') throw studioError('push must be a boolean', 'invalid_input');
    const current = activeTransaction(transactionId);
    active = undefined;
    usedIds.add(transactionId);
    return dependencies.confirmPreparedPublication(current.prepared, { push });
  }

  async function cancel({ transactionId } = {}) {
    const current = activeTransaction(transactionId);
    active = undefined;
    usedIds.add(transactionId);
    return dependencies.cancelPreparedPublication(current.prepared);
  }

  return Object.freeze({ prepare, confirm, cancel });
}
