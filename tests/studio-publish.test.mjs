import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cancelPreparedPublication,
  confirmPreparedPublication,
  prepareNotePublication,
} from '../publisher/lib/publish-note.mjs';
import {
  createStudioPublisher,
  StudioPublicationError,
} from '../publisher/lib/studio-publish.mjs';

const FINGERPRINT = 'a'.repeat(64);

function manifest() {
  return {
    version: 1,
    transactionId: 'transaction-alpha',
    publications: [{
      publishId: 'alpha',
      title: 'Alpha',
      sourcePath: 'Publishing/Alpha.md',
      entryTargetPath: 'src/content/entries/alpha.md',
      assetTargetPaths: [],
    }],
    files: [{
      kind: 'entry',
      publishId: 'alpha',
      targetPath: 'src/content/entries/alpha.md',
      stagedPath: 'files/src/content/entries/alpha.md',
      sha256: 'b'.repeat(64),
    }],
  };
}

function note() {
  return {
    sourcePath: 'Publishing/Alpha.md',
    sourceHash: FINGERPRINT,
    publishId: 'alpha',
    data: {
      publish: true,
      publish_id: 'alpha',
      domain: 'ai',
      format: 'log',
      source_type: 'original',
    },
    body: 'Alpha body',
    eligible: true,
  };
}

function config() {
  return {
    repoRoot: '/repo',
    vaultRoot: '/vault',
    entryOutputDir: '/repo/src/content/entries',
    mediaOutputDir: '/repo/public/media',
    attachmentRoots: ['/vault'],
    ignoreFolders: ['.obsidian'],
    includeInlineHashtags: true,
    studioWorkspaces: [{
      id: 'research',
      label: '产业研究',
      path: '/vault/Publishing',
    }],
  };
}

function publicationDependencies({
  transaction = { id: 'transaction-alpha', manifest: manifest(), status: 'staged' },
  calls = [],
} = {}) {
  const stateStore = {
    readState: async () => {
      calls.push('state');
      return { version: 1, entries: {} };
    },
    updateState: async () => ({ version: 1, entries: {} }),
  };
  return {
    calls,
    transaction,
    stateStore,
    dependencies: {
      now: () => new Date('2026-07-29T04:00:00.000Z'),
      createStateStore: () => stateStore,
      buildVaultIndex: async () => {
        calls.push('index');
        return { byRelativePath: new Map(), byBasename: new Map() };
      },
      scanCurrentNote: async ({ sourcePath }) => {
        calls.push(['scan', sourcePath]);
        return note();
      },
      assertValidPublicationNote: ({ filename }) => {
        calls.push(['validate', filename]);
      },
      buildAssetIndex: async () => {
        calls.push('assets');
        return {};
      },
      transformNote: async ({ note: selected }) => {
        calls.push(['transform', selected.publishId]);
        return { ...selected, assets: [] };
      },
      createPublicationTransaction: async ({ notes }) => {
        calls.push(['stage', notes.map(({ publishId }) => publishId)]);
        return transaction;
      },
      buildTransactionPreview: async (candidate) => {
        calls.push(['preview', candidate.id]);
        candidate.status = 'previewed';
        return { root: '/private/staging/preview-repo' };
      },
      buildDisplayManifest: async (candidate) => {
        calls.push(['display', candidate.transactionId]);
        const display = structuredClone(candidate);
        display.files = display.files.map(({ stagedPath: _private, ...file }) => file);
        return display;
      },
      applyPublicationTransaction: async (candidate) => {
        calls.push(['apply', candidate.id]);
        candidate.status = 'applied';
      },
      confirmPublicationTransaction: async (candidate, { push }) => {
        calls.push(['confirm', candidate.id, push]);
        candidate.status = 'confirmed';
        return { commitSha: 'deadbeef', pushed: push };
      },
      cancelPublicationTransaction: async (candidate) => {
        calls.push(['cancel', candidate.id]);
        candidate.status = 'canceled';
        return { canceled: true };
      },
    },
  };
}

test('single-note preparation builds the current note without applying repository changes', async () => {
  const fixture = publicationDependencies();
  const prepared = await prepareNotePublication({
    config: config(),
    sourcePath: '/vault/Publishing/Alpha.md',
    expectedSourceHash: FINGERPRINT,
  }, fixture.dependencies);

  assert.deepEqual(Object.keys(prepared).sort(), [
    'manifest',
    'preparedAt',
    'previewRoot',
    'route',
    'transactionId',
  ]);
  assert.equal(prepared.transactionId, 'transaction-alpha');
  assert.equal(prepared.route, '/blog/alpha/');
  assert.equal(prepared.previewRoot, '/private/staging/preview-repo/dist');
  assert.equal(prepared.preparedAt, '2026-07-29T04:00:00.000Z');
  assert.equal(prepared.manifest.files[0].stagedPath, undefined);
  assert.equal(fixture.calls.some(([name]) => name === 'apply'), false);
  assert.deepEqual(fixture.calls.at(-1), ['display', 'transaction-alpha']);
});

test('prepared publication confirmation applies and confirms exactly once', async () => {
  const fixture = publicationDependencies();
  const prepared = await prepareNotePublication({
    config: config(),
    sourcePath: '/vault/Publishing/Alpha.md',
  }, fixture.dependencies);

  const result = await confirmPreparedPublication(prepared, { push: false });
  assert.deepEqual(result, { commitSha: 'deadbeef', pushed: false });
  assert.equal(fixture.calls.filter(([name]) => name === 'apply').length, 1);
  assert.equal(fixture.calls.filter(([name]) => name === 'confirm').length, 1);
  await assert.rejects(
    confirmPreparedPublication(prepared, { push: false }),
    (error) => error.code === 'transaction_already_used',
  );
  assert.equal(fixture.calls.filter(([name]) => name === 'confirm').length, 1);
});

test('preparation cancels staging when isolated preview construction fails', async () => {
  const fixture = publicationDependencies();
  const failure = new Error('preview failed');
  failure.code = 'preview_build_failed';
  fixture.dependencies.buildTransactionPreview = async (candidate) => {
    candidate.status = 'preview_failed';
    throw failure;
  };

  await assert.rejects(
    prepareNotePublication({
      config: config(),
      sourcePath: '/vault/Publishing/Alpha.md',
    }, fixture.dependencies),
    (error) => error === failure,
  );
  assert.deepEqual(fixture.calls.at(-1), ['cancel', 'transaction-alpha']);
});

test('single-note preparation rejects bytes that no longer match the saved fingerprint', async () => {
  const fixture = publicationDependencies();

  await assert.rejects(
    prepareNotePublication({
      config: config(),
      sourcePath: '/vault/Publishing/Alpha.md',
      expectedSourceHash: 'c'.repeat(64),
    }, fixture.dependencies),
    (error) => error.code === 'external_change',
  );
  assert.equal(fixture.calls.some(([name]) => name === 'stage'), false);
});

test('studio prepare requires a saved fingerprint and binds publication to those bytes', async () => {
  let prepareCalls = 0;
  const publisher = createStudioPublisher({ config: config() }, {
    readStudioDocument: async () => ({
      fingerprint: FINGERPRINT,
    }),
    prepareNotePublication: async (input) => {
      prepareCalls += 1;
      assert.equal(input.expectedSourceHash, FINGERPRINT);
      return {
        transactionId: 'transaction-alpha',
        manifest: manifest(),
        route: '/blog/alpha/',
        previewRoot: '/private/staging/preview-repo/dist',
        preparedAt: '2026-07-29T04:00:00.000Z',
      };
    },
  });

  await assert.rejects(
    publisher.prepare({ workspaceId: 'research', relativePath: 'Alpha.md' }),
    (error) => error instanceof StudioPublicationError && error.code === 'invalid_input',
  );
  assert.equal(prepareCalls, 0);

  await assert.rejects(
    publisher.prepare({
      workspaceId: 'research',
      relativePath: 'Alpha.md',
      expectedFingerprint: 'b'.repeat(64),
    }),
    (error) => error instanceof StudioPublicationError && error.code === 'external_change',
  );
  assert.equal(prepareCalls, 0);

  const prepared = await publisher.prepare({
    workspaceId: 'research',
    relativePath: 'Alpha.md',
    expectedFingerprint: FINGERPRINT,
  });
  assert.equal(prepareCalls, 1);
  assert.deepEqual(Object.keys(prepared).sort(), [
    'manifest',
    'preparedAt',
    'previewRoot',
    'route',
    'transactionId',
  ]);
  assert.equal(JSON.stringify(prepared).includes('/vault/'), false);
  assert.equal(JSON.stringify(prepared).includes('Alpha body'), false);
});

test('studio publisher permits only one prepared transaction and rejects a wrong ID', async () => {
  const publisher = createStudioPublisher({ config: config() }, {
    readStudioDocument: async () => ({ fingerprint: FINGERPRINT }),
    prepareNotePublication: async () => ({
      transactionId: 'transaction-alpha',
      manifest: manifest(),
      route: '/blog/alpha/',
      previewRoot: '/private/staging/preview-repo/dist',
      preparedAt: '2026-07-29T04:00:00.000Z',
    }),
  });
  const input = {
    workspaceId: 'research',
    relativePath: 'Alpha.md',
    expectedFingerprint: FINGERPRINT,
  };

  await publisher.prepare(input);
  await assert.rejects(
    publisher.prepare(input),
    (error) => error.code === 'transaction_active',
  );
  await assert.rejects(
    publisher.confirm({ transactionId: 'transaction-wrong', push: false }),
    (error) => error.code === 'transaction_not_found',
  );
});

test('studio publisher rejects a second prepare while the first is still in flight', async () => {
  let releaseRead;
  const publisher = createStudioPublisher({ config: config() }, {
    readStudioDocument: async () => new Promise((resolve) => {
      releaseRead = () => resolve({
        relativePath: 'Alpha.md',
        fingerprint: FINGERPRINT,
      });
    }),
    prepareNotePublication: async () => ({
      transactionId: 'transaction-alpha',
      manifest: manifest(),
      route: '/blog/alpha/',
      previewRoot: '/private/staging/preview-repo/dist',
      preparedAt: '2026-07-29T04:00:00.000Z',
    }),
  });
  const input = {
    workspaceId: 'research',
    relativePath: 'Alpha.md',
    expectedFingerprint: FINGERPRINT,
  };

  const first = publisher.prepare(input);
  await assert.rejects(
    publisher.prepare(input),
    (error) => error.code === 'transaction_active',
  );
  releaseRead();
  assert.equal((await first).transactionId, 'transaction-alpha');
});

test('studio confirm consumes its ID before awaiting and cannot invoke confirmation twice', async () => {
  let releaseConfirm;
  let confirmCalls = 0;
  const publisher = createStudioPublisher({ config: config() }, {
    readStudioDocument: async () => ({ fingerprint: FINGERPRINT }),
    prepareNotePublication: async () => ({
      transactionId: 'transaction-alpha',
      manifest: manifest(),
      route: '/blog/alpha/',
      previewRoot: '/private/staging/preview-repo/dist',
      preparedAt: '2026-07-29T04:00:00.000Z',
    }),
    confirmPreparedPublication: async (_prepared, { push }) => {
      confirmCalls += 1;
      assert.equal(push, true);
      await new Promise((resolve) => { releaseConfirm = resolve; });
      return { commitSha: 'deadbeef', pushed: true };
    },
  });
  await publisher.prepare({
    workspaceId: 'research',
    relativePath: 'Alpha.md',
    expectedFingerprint: FINGERPRINT,
  });

  const first = publisher.confirm({ transactionId: 'transaction-alpha', push: true });
  await assert.rejects(
    publisher.confirm({ transactionId: 'transaction-alpha', push: true }),
    (error) => error.code === 'transaction_already_used',
  );
  releaseConfirm();
  assert.deepEqual(await first, { commitSha: 'deadbeef', pushed: true });
  assert.equal(confirmCalls, 1);
});

test('studio cancel consumes its ID and invokes prepared staging cleanup once', async () => {
  let cancelCalls = 0;
  const publisher = createStudioPublisher({ config: config() }, {
    readStudioDocument: async () => ({ fingerprint: FINGERPRINT }),
    prepareNotePublication: async () => ({
      transactionId: 'transaction-alpha',
      manifest: manifest(),
      route: '/blog/alpha/',
      previewRoot: '/private/staging/preview-repo/dist',
      preparedAt: '2026-07-29T04:00:00.000Z',
    }),
    cancelPreparedPublication: async () => {
      cancelCalls += 1;
      return { canceled: true };
    },
  });
  await publisher.prepare({
    workspaceId: 'research',
    relativePath: 'Alpha.md',
    expectedFingerprint: FINGERPRINT,
  });

  assert.deepEqual(
    await publisher.cancel({ transactionId: 'transaction-alpha' }),
    { canceled: true },
  );
  await assert.rejects(
    publisher.cancel({ transactionId: 'transaction-alpha' }),
    (error) => error.code === 'transaction_already_used',
  );
  assert.equal(cancelCalls, 1);
});
