import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PublicationPreparationError } from '../publisher/lib/publish-note.mjs';
import { runStudio } from '../publisher/studio.mjs';
import { startStudioServer } from '../publisher/studio-server.mjs';

const JSON_LIMIT = 2 * 1024 * 1024;
const ATTACHMENT_LIMIT = 25 * 1024 * 1024;
const FINGERPRINT_A = 'a'.repeat(64);
const FINGERPRINT_B = 'b'.repeat(64);

async function makePublicRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-public-'));
  await mkdir(path.join(root, 'assets'));
  await writeFile(
    path.join(root, 'index.html'),
    '<!doctype html><main data-testid="studio-shell">Studio</main>'
      + '<script id="studio-data" type="application/json">__STUDIO_DATA__</script>'
      + '<script type="module" src="/_studio/assets/app.js"></script>',
  );
  await writeFile(path.join(root, 'assets', 'app.js'), 'export const studio = true;\n');
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function makePreviewRoot(t, marker = 'FINAL ALPHA') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-preview-'));
  await mkdir(path.join(root, 'blog', 'alpha'), { recursive: true });
  await mkdir(path.join(root, '_astro'));
  await writeFile(
    path.join(root, 'blog', 'alpha', 'index.html'),
    `<link rel="stylesheet" href="/_astro/site.css"><a href="/blog/alpha/"><h1>${marker}</h1></a>`,
  );
  await writeFile(
    path.join(root, '_astro', 'site.css'),
    "@font-face { src: url('/_astro/site.woff2'); }\nbody { color: black; }\n",
  );
  await writeFile(path.join(root, '_astro', 'site.woff2'), Buffer.from('font'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function sampleDocument(overrides = {}) {
  return {
    workspaceId: 'research',
    relativePath: 'Alpha.md',
    source: '---\ntitle: Alpha\n---\nPublic body',
    body: 'Public body',
    metadata: { title: 'Alpha' },
    fingerprint: FINGERPRINT_A,
    modifiedAt: '2026-07-29T04:00:00.000Z',
    status: 'ready',
    diagnostics: [],
    ...overrides,
  };
}

function defaultModules({ previewRoot, calls = [] } = {}) {
  const publisher = {
    prepare: async (input) => {
      calls.push(['prepare', input]);
      return {
        transactionId: 'transaction-alpha',
        route: '/blog/alpha/',
        manifest: {
          version: 1,
          transactionId: 'transaction-alpha',
          publications: [{ publishId: 'alpha', entryTargetPath: 'src/content/entries/alpha.md' }],
          files: [{ kind: 'entry', targetPath: 'src/content/entries/alpha.md', sha256: 'c'.repeat(64) }],
        },
        previewRoot,
        preparedAt: '2026-07-29T04:00:00.000Z',
      };
    },
    confirm: async (input) => {
      calls.push(['confirm', input]);
      return { commitSha: 'deadbeef', pushed: input.push };
    },
    cancel: async (input) => {
      calls.push(['cancel', input]);
      return { canceled: true };
    },
  };
  return {
    scanStudioWorkspace: async () => [{
      id: 'research',
      label: '产业研究',
      documents: [{ relativePath: 'Alpha.md', title: 'Alpha', fingerprint: FINGERPRINT_A }],
    }],
    readStudioDocument: async (_config, input) => {
      calls.push(['read', input]);
      return sampleDocument({ relativePath: input.relativePath });
    },
    createStudioDocument: async (_config, input) => {
      calls.push(['create', input]);
      return sampleDocument();
    },
    saveStudioDocument: async (_config, input) => {
      calls.push(['save', input]);
      return sampleDocument({
        source: input.source,
        fingerprint: FINGERPRINT_B,
      });
    },
    saveStudioAttachment: async (_config, input) => {
      calls.push(['attachment', input]);
      return {
        relativePath: 'Attachments/chart-deadbeef.png',
        embed: '![[Attachments/chart-deadbeef.png|周期图]]',
        size: input.bytes.length,
        sha256: 'd'.repeat(64),
      };
    },
    renderStudioPreview: async (input) => {
      calls.push(['preview', input]);
      return {
        html: '<h1 id="alpha">Alpha</h1>',
        outline: [{ depth: 1, text: 'Alpha', id: 'alpha' }],
        diagnostics: [],
      };
    },
    createStudioPublisher: () => publisher,
  };
}

function parseStudioState(html) {
  const match = html.match(/<script id="studio-data" type="application\/json">([^<]*)<\/script>/u);
  assert.ok(match, 'studio page must contain escaped JSON state');
  return JSON.parse(match[1]);
}

async function startFixture(t, {
  moduleOverrides = {},
  calls = [],
  previewRoot,
  openBrowser,
} = {}) {
  const publicRoot = await makePublicRoot(t);
  const modules = {
    ...defaultModules({ previewRoot, calls }),
    ...moduleOverrides,
  };
  const studio = await startStudioServer({
    config: {
      vaultRoot: '/private/vault',
      studioWorkspaces: [{ id: 'research', label: '产业研究', path: '/private/vault/Research' }],
    },
    publicRoot,
    openBrowser,
  }, modules);
  t.after(() => studio.close());
  const page = await fetch(studio.url);
  const state = parseStudioState(await page.text());
  return { studio, state, calls, page };
}

function rawRequest(url, {
  method = 'GET',
  pathname,
  headers = {},
  body,
  chunks,
} = {}) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      method,
      path: pathname ?? target.pathname,
      headers,
      agent: false,
    }, (response) => {
      const received = [];
      response.on('data', (chunk) => received.push(chunk));
      response.on('end', () => {
        settled = true;
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(received).toString('utf8'),
        });
      });
    });
    request.on('error', (error) => {
      if (!settled) reject(error);
    });
    if (chunks) {
      for (const chunk of chunks) request.write(chunk);
      request.end();
    } else {
      request.end(body);
    }
  });
}

function rawSocketRequest(url, requestText) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = netConnect({
      host: target.hostname,
      port: Number(target.port),
    });
    socket.once('connect', () => socket.end(requestText));
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.once('end', () => {
      const response = Buffer.concat(chunks).toString('utf8');
      const status = Number(response.match(/^HTTP\/1\.1 (\d{3})/u)?.[1]);
      resolve({ status, body: response.split('\r\n\r\n', 2)[1] ?? '' });
    });
    socket.once('error', reject);
  });
}

function apiHeaders(token, extra = {}) {
  return { 'x-studio-token': token, ...extra };
}

async function apiJson(studio, token, pathname, {
  method = 'GET',
  body,
  headers = {},
} = {}) {
  const response = await fetch(new URL(pathname, studio.url), {
    method,
    headers: apiHeaders(token, {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    response,
    json: await response.json(),
  };
}

test('studio server binds exactly to IPv4 loopback and embeds an independent 32-byte session token', async (t) => {
  const opened = [];
  const { studio, state } = await startFixture(t, {
    openBrowser: async (url) => opened.push(url),
  });

  assert.equal(studio.server.address().address, '127.0.0.1');
  assert.equal(studio.server.address().family, 'IPv4');
  assert.equal(new URL(studio.url).hostname, '127.0.0.1');
  assert.equal(new URL(studio.url).pathname, '/_studio/');
  assert.match(state.token, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(studio.url.includes(state.token), false);
  assert.deepEqual(opened, [studio.url]);
});

test('strict Host validation rejects DNS rebinding, localhost, IPv6, and forged loopback authorities', async (t) => {
  const { studio, state } = await startFixture(t);
  const port = new URL(studio.url).port;

  for (const host of [
    'attacker.example',
    `localhost:${port}`,
    `[::1]:${port}`,
    `127.0.0.1:${port}@attacker.example`,
    `127.0.0.1:${port}.attacker.example`,
  ]) {
    const response = await rawRequest(studio.url, { headers: { Host: host } });
    assert.equal(response.status, 421, host);
    assert.doesNotMatch(response.body, new RegExp(state.token, 'u'));
    assert.doesNotMatch(response.body, /Public body|private\/vault/u);
  }
});

test('strict Host validation rejects duplicate Host fields regardless of header-name casing', async (t) => {
  const { studio, state } = await startFixture(t);
  const authority = new URL(studio.url).host;

  for (const secondHost of [authority, 'attacker.example']) {
    const response = await rawSocketRequest(
      studio.url,
      [
        'GET /_studio/ HTTP/1.1',
        `Host: ${authority}`,
        `hOsT: ${secondHost}`,
        'Connection: close',
        '',
        '',
      ].join('\r\n'),
    );
    assert.equal(response.status, 421);
    assert.doesNotMatch(response.body, new RegExp(state.token, 'u'));
  }
});

test('every API route requires the session token while page and assets use a strict CSP', async (t) => {
  const { studio, state, page } = await startFixture(t);
  const csp = page.headers.get('content-security-policy');

  assert.match(csp, /default-src 'self'/u);
  assert.match(csp, /connect-src 'self'/u);
  assert.match(csp, /frame-ancestors 'none'/u);
  assert.match(csp, /frame-src 'self'/u);
  assert.match(csp, /object-src 'none'/u);
  assert.match(csp, /script-src 'self'/u);
  assert.doesNotMatch(csp, /unsafe-inline|https?:/u);

  const asset = await fetch(new URL('/_studio/assets/app.js', studio.url));
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /^text\/javascript/u);
  assert.match(asset.headers.get('content-security-policy'), /script-src 'self'/u);

  const missing = await fetch(new URL('/_studio/api/workspaces', studio.url));
  assert.equal(missing.status, 403);
  const invalid = await fetch(new URL('/_studio/api/workspaces', studio.url), {
    headers: { 'x-studio-token': `${state.token}x` },
  });
  assert.equal(invalid.status, 403);
  const valid = await fetch(new URL('/_studio/api/workspaces', studio.url), {
    headers: { 'x-studio-token': state.token },
  });
  assert.equal(valid.status, 200);
});

test('recognized routes return 405 with Allow and traversal or unrelated routes return 404', async (t) => {
  const { studio, state } = await startFixture(t);
  const mutation = await fetch(new URL('/_studio/api/attachment', studio.url));
  assert.equal(mutation.status, 405);
  assert.equal(mutation.headers.get('allow'), 'POST');

  const wrongReadMethod = await fetch(new URL('/_studio/api/workspaces', studio.url), {
    method: 'POST',
  });
  assert.equal(wrongReadMethod.status, 405);
  assert.equal(wrongReadMethod.headers.get('allow'), 'GET');

  const outside = await fetch(new URL('/private/vault/Research/Alpha.md', studio.url));
  assert.equal(outside.status, 404);
  const unknownApi = await fetch(new URL('/_studio/api/unknown', studio.url), {
    headers: apiHeaders(state.token),
  });
  assert.equal(unknownApi.status, 404);
  const traversal = await rawRequest(studio.url, {
    pathname: '/_studio/assets/%2e%2e%2findex.html',
  });
  assert.equal(traversal.status, 404);
});

test('JSON requests reject malformed input and incrementally abort beyond 2 MiB', async (t) => {
  const { studio, state } = await startFixture(t);
  const malformed = await fetch(new URL('/_studio/api/preview', studio.url), {
    method: 'POST',
    headers: apiHeaders(state.token, { 'content-type': 'application/json' }),
    body: '{"body":',
  });
  assert.equal(malformed.status, 400);

  const oversized = await rawRequest(studio.url, {
    method: 'POST',
    pathname: '/_studio/api/preview',
    headers: apiHeaders(state.token, {
      'content-type': 'application/json',
      'transfer-encoding': 'chunked',
    }),
    chunks: [Buffer.alloc(JSON_LIMIT, 0x20), Buffer.from('x')],
  });
  assert.equal(oversized.status, 413);
});

test('attachment requests enforce a 25 MiB transport limit before buffering', async (t) => {
  const { studio, state } = await startFixture(t);
  const oversized = await rawRequest(studio.url, {
    method: 'POST',
    pathname: '/_studio/api/attachment',
    headers: apiHeaders(state.token, {
      'content-type': 'image/png',
      'content-length': String(ATTACHMENT_LIMIT + 1),
      'x-studio-filename': encodeURIComponent('chart.png'),
    }),
  });
  assert.equal(oversized.status, 413);

  const missingMimeType = await rawRequest(studio.url, {
    method: 'POST',
    pathname: '/_studio/api/attachment',
    headers: apiHeaders(state.token, {
      'x-studio-filename': encodeURIComponent('chart.png'),
    }),
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  assert.equal(missingMimeType.status, 400);
});

test('workspace, document, conflict resolution, attachment, and instant preview routes use injected modules', async (t) => {
  const calls = [];
  const { studio, state } = await startFixture(t, { calls });

  const workspaces = await apiJson(studio, state.token, '/_studio/api/workspaces');
  assert.equal(workspaces.response.status, 200);
  assert.equal(workspaces.json.workspaces[0].id, 'research');

  const opened = await apiJson(
    studio,
    state.token,
    '/_studio/api/document?workspaceId=research&path=Alpha.md',
  );
  assert.equal(opened.response.status, 200);
  assert.equal(opened.json.document.source, sampleDocument().source);

  const created = await apiJson(studio, state.token, '/_studio/api/document', {
    method: 'POST',
    body: { workspaceId: 'research', title: 'Alpha', body: 'Public body' },
  });
  assert.equal(created.response.status, 201);

  const saved = await apiJson(studio, state.token, '/_studio/api/document', {
    method: 'PUT',
    body: {
      workspaceId: 'research',
      relativePath: 'Alpha.md',
      expectedFingerprint: FINGERPRINT_A,
      source: 'Browser source',
    },
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.json.document.fingerprint, FINGERPRINT_B);

  const resolved = await apiJson(studio, state.token, '/_studio/api/document/resolve-conflict', {
    method: 'PUT',
    body: {
      workspaceId: 'research',
      relativePath: 'Alpha.md',
      staleFingerprint: FINGERPRINT_B,
      currentFingerprint: FINGERPRINT_A,
      source: 'Keep browser version',
    },
  });
  assert.equal(resolved.response.status, 200);
  const resolveSave = calls.filter(([name]) => name === 'save').at(-1)[1];
  assert.equal(resolveSave.expectedFingerprint, FINGERPRINT_A);
  assert.equal(resolveSave.source, 'Keep browser version');
  assert.equal(Object.hasOwn(resolveSave, 'force'), false);

  const attachment = await fetch(new URL('/_studio/api/attachment', studio.url), {
    method: 'POST',
    headers: apiHeaders(state.token, {
      'content-type': 'image/png',
      'x-studio-filename': encodeURIComponent('周期 图.png'),
      'x-studio-alt': encodeURIComponent('周期图'),
    }),
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  assert.equal(attachment.status, 201);
  const attachmentBody = await attachment.json();
  assert.equal(attachmentBody.attachment.relativePath, 'Attachments/chart-deadbeef.png');
  const attachmentCall = calls.find(([name]) => name === 'attachment')[1];
  assert.equal(attachmentCall.filename, '周期 图.png');
  assert.equal(attachmentCall.mimeType, 'image/png');
  assert.equal(attachmentCall.alt, '周期图');
  assert.deepEqual(attachmentCall.bytes, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const preview = await apiJson(studio, state.token, '/_studio/api/preview', {
    method: 'POST',
    body: { body: '# Alpha', metadata: { title: 'Alpha' } },
  });
  assert.equal(preview.response.status, 200);
  assert.match(preview.json.preview.html, /<h1/u);
});

test('conflict resolution requires stale and current disk fingerprints and rechecks current disk state', async (t) => {
  const { studio, state } = await startFixture(t);
  const missingProof = await apiJson(studio, state.token, '/_studio/api/document/resolve-conflict', {
    method: 'PUT',
    body: {
      workspaceId: 'research',
      relativePath: 'Alpha.md',
      force: true,
      source: 'Browser source',
    },
  });
  assert.equal(missingProof.response.status, 400);

  const staleDisk = await apiJson(studio, state.token, '/_studio/api/document/resolve-conflict', {
    method: 'PUT',
    body: {
      workspaceId: 'research',
      relativePath: 'Alpha.md',
      staleFingerprint: FINGERPRINT_A,
      currentFingerprint: FINGERPRINT_B,
      source: 'Browser source',
    },
  });
  assert.equal(staleDisk.response.status, 409);
});

test('conflict resolution accepts patch and body and forwards them through the frontmatter adapter', async (t) => {
  const { studio, state, calls } = await startFixture(t);

  const resolved = await apiJson(studio, state.token, '/_studio/api/document/resolve-conflict', {
    method: 'PUT',
    body: {
      workspaceId: 'research',
      relativePath: 'Alpha.md',
      staleFingerprint: FINGERPRINT_B,
      currentFingerprint: FINGERPRINT_A,
      patch: { title: 'Browser 标题', publish: true },
      body: 'Browser body',
    },
  });
  assert.equal(resolved.response.status, 200);
  const resolveSave = calls.filter(([name]) => name === 'save').at(-1)[1];
  assert.equal(resolveSave.expectedFingerprint, FINGERPRINT_A);
  assert.equal(resolveSave.patch.title, 'Browser 标题');
  assert.equal(resolveSave.body, 'Browser body');
  assert.equal(Object.hasOwn(resolveSave, 'force'), false);
  assert.equal(Object.hasOwn(resolveSave, 'source'), false);

  const bothForms = await apiJson(studio, state.token, '/_studio/api/document/resolve-conflict', {
    method: 'PUT',
    body: {
      workspaceId: 'research',
      relativePath: 'Alpha.md',
      staleFingerprint: FINGERPRINT_A,
      currentFingerprint: FINGERPRINT_B,
      source: 'Raw source',
      patch: { title: 'Browser 标题' },
      body: 'Browser body',
    },
  });
  assert.equal(bothForms.response.status, 400);

  const noForm = await apiJson(studio, state.token, '/_studio/api/document/resolve-conflict', {
    method: 'PUT',
    body: {
      workspaceId: 'research',
      relativePath: 'Alpha.md',
      staleFingerprint: FINGERPRINT_A,
      currentFingerprint: FINGERPRINT_B,
    },
  });
  assert.equal(noForm.response.status, 400);
});

test('prepare exposes only a same-origin final preview URL and confirm retires its preview root', async (t) => {
  const previewRoot = await makePreviewRoot(t);
  const { studio, state } = await startFixture(t, { previewRoot });

  const prepared = await apiJson(studio, state.token, '/_studio/api/publish/prepare', {
    method: 'POST',
    body: {
      workspaceId: 'research',
      relativePath: 'Alpha.md',
      expectedFingerprint: FINGERPRINT_A,
    },
  });
  assert.equal(prepared.response.status, 200);
  assert.equal(prepared.json.publication.previewUrl, '/_studio/final-preview/blog/alpha/');
  assert.equal(Object.hasOwn(prepared.json.publication, 'previewRoot'), false);
  assert.doesNotMatch(JSON.stringify(prepared.json), new RegExp(previewRoot, 'u'));

  const finalPage = await fetch(new URL(prepared.json.publication.previewUrl, studio.url));
  assert.equal(finalPage.status, 200);
  const finalHtml = await finalPage.text();
  assert.match(finalHtml, /FINAL ALPHA/u);
  assert.match(finalHtml, /href="\/_studio\/final-preview\/_astro\/site\.css"/u);
  assert.match(finalHtml, /href="\/_studio\/final-preview\/blog\/alpha\/"/u);
  const finalAsset = await fetch(new URL('/_studio/final-preview/_astro/site.css', studio.url));
  assert.equal(finalAsset.status, 200);
  assert.match(finalAsset.headers.get('content-security-policy'), /connect-src 'none'/u);
  assert.match(finalAsset.headers.get('content-security-policy'), /script-src 'none'/u);
  assert.match(
    await finalAsset.text(),
    /url\('\/_studio\/final-preview\/_astro\/site\.woff2'\)/u,
  );

  const confirmed = await apiJson(studio, state.token, '/_studio/api/publish/confirm', {
    method: 'POST',
    body: { transactionId: 'transaction-alpha', push: false },
  });
  assert.equal(confirmed.response.status, 200);
  assert.deepEqual(confirmed.json.result, { commitSha: 'deadbeef', pushed: false });
  assert.equal((await fetch(new URL(prepared.json.publication.previewUrl, studio.url))).status, 404);
});

test('cancel retires the active preview and a later transaction cannot expose the old preview root', async (t) => {
  const firstRoot = await makePreviewRoot(t, 'OLD PREVIEW');
  const secondRoot = await makePreviewRoot(t, 'NEW PREVIEW');
  let prepareCount = 0;
  const { studio, state } = await startFixture(t, {
    previewRoot: firstRoot,
    moduleOverrides: {
      createStudioPublisher: () => ({
        prepare: async () => {
          prepareCount += 1;
          return {
            transactionId: `transaction-${prepareCount}`,
            route: '/blog/alpha/',
            manifest: { version: 1, transactionId: `transaction-${prepareCount}`, publications: [], files: [] },
            previewRoot: prepareCount === 1 ? firstRoot : secondRoot,
            preparedAt: '2026-07-29T04:00:00.000Z',
          };
        },
        confirm: async () => ({ pushed: false }),
        cancel: async () => ({ canceled: true }),
      }),
    },
  });

  const first = await apiJson(studio, state.token, '/_studio/api/publish/prepare', {
    method: 'POST',
    body: { workspaceId: 'research', relativePath: 'Alpha.md', expectedFingerprint: FINGERPRINT_A },
  });
  assert.equal(first.response.status, 200);
  assert.match(await (await fetch(new URL(first.json.publication.previewUrl, studio.url))).text(), /OLD PREVIEW/u);

  const canceled = await apiJson(studio, state.token, '/_studio/api/publish/cancel', {
    method: 'POST',
    body: { transactionId: 'transaction-1' },
  });
  assert.equal(canceled.response.status, 200);
  assert.equal((await fetch(new URL(first.json.publication.previewUrl, studio.url))).status, 404);

  const second = await apiJson(studio, state.token, '/_studio/api/publish/prepare', {
    method: 'POST',
    body: { workspaceId: 'research', relativePath: 'Alpha.md', expectedFingerprint: FINGERPRINT_A },
  });
  assert.equal(second.response.status, 200);
  assert.match(await (await fetch(new URL(second.json.publication.previewUrl, studio.url))).text(), /NEW PREVIEW/u);
});

test('API errors map to stable statuses without leaking note bodies, physical paths, or stacks', async (t) => {
  const secret = '/private/vault/Research/Alpha.md\nVAULT BODY\nSTACK_SENTINEL';
  const cases = [
    {
      route: '/_studio/api/document?workspaceId=research&path=Missing.md',
      method: 'GET',
      override: {
        readStudioDocument: async () => {
          throw Object.assign(new Error(secret), { code: 'document_not_found' });
        },
      },
      status: 404,
    },
    {
      route: '/_studio/api/document',
      method: 'PUT',
      body: { workspaceId: 'research', relativePath: 'Alpha.md', expectedFingerprint: FINGERPRINT_A, source: 'VAULT BODY' },
      override: { saveStudioDocument: async () => { throw Object.assign(new Error(secret), { code: 'external_change' }); } },
      status: 409,
    },
    {
      route: '/_studio/api/publish/prepare',
      method: 'POST',
      body: { workspaceId: 'research', relativePath: 'Alpha.md', expectedFingerprint: FINGERPRINT_A },
      override: {
        createStudioPublisher: () => ({
          prepare: async () => {
            const error = new Error(secret);
            error.name = 'PublicationValidationError';
            error.diagnostics = [{ filename: secret, field: 'title', message: secret, code: 'required' }];
            throw error;
          },
          confirm: async () => {},
          cancel: async () => {},
        }),
      },
      status: 422,
    },
    {
      route: '/_studio/api/workspaces',
      method: 'GET',
      override: { scanStudioWorkspace: async () => { throw new Error(secret); } },
      status: 500,
    },
    {
      route: '/_studio/api/workspaces',
      method: 'GET',
      override: { scanStudioWorkspace: async () => { throw new TypeError(secret); } },
      status: 500,
    },
  ];

  for (const current of cases) {
    await t.test(String(current.status), async (nested) => {
      const { studio, state } = await startFixture(nested, { moduleOverrides: current.override });
      const response = await fetch(new URL(current.route, studio.url), {
        method: current.method,
        headers: apiHeaders(state.token, current.body ? { 'content-type': 'application/json' } : {}),
        ...(current.body ? { body: JSON.stringify(current.body) } : {}),
      });
      assert.equal(response.status, current.status);
      const body = await response.text();
      assert.doesNotMatch(body, /private\/vault|VAULT BODY|STACK_SENTINEL|studio-server\.mjs:\d+/u);
    });
  }
});

test('a real preparation external-change error remains a recoverable 409 conflict', async (t) => {
  const secret = '/private/vault/Research/Alpha.md changed';
  const { studio, state } = await startFixture(t, {
    moduleOverrides: {
      createStudioPublisher: () => ({
        prepare: async () => {
          throw new PublicationPreparationError(secret, 'external_change');
        },
        confirm: async () => assert.fail('not used'),
        cancel: async () => assert.fail('not used'),
      }),
    },
  });

  const response = await apiJson(studio, state.token, '/_studio/api/publish/prepare', {
    method: 'POST',
    body: {
      workspaceId: 'research',
      relativePath: 'Alpha.md',
      expectedFingerprint: FINGERPRINT_A,
    },
  });
  assert.equal(response.response.status, 409);
  assert.equal(response.json.error.code, 'external_change');
  assert.doesNotMatch(JSON.stringify(response.json), /private\/vault|Alpha\.md/u);
});

test('replayed publication transaction errors return 409 and do not use the Studio session token as an ID', async (t) => {
  const calls = [];
  const { studio, state } = await startFixture(t, {
    calls,
    moduleOverrides: {
      createStudioPublisher: () => ({
        prepare: async () => assert.fail('not used'),
        confirm: async ({ transactionId }) => {
          calls.push(transactionId);
          throw Object.assign(new Error('used'), { code: 'transaction_already_used' });
        },
        cancel: async () => assert.fail('not used'),
      }),
    },
  });
  const response = await apiJson(studio, state.token, '/_studio/api/publish/confirm', {
    method: 'POST',
    body: { transactionId: 'transaction-alpha', push: false },
  });
  assert.equal(response.response.status, 409);
  assert.deepEqual(calls, ['transaction-alpha']);
  assert.notEqual(calls[0], state.token);
});

test('runStudio loads config, builds disposable assets, honors --no-open, prints recovery URL, and closes', async () => {
  const calls = [];
  const result = await runStudio(['--no-open'], {
    repoRoot: '/repo',
    loadPublishConfig: async (input) => {
      calls.push(['config', input]);
      return {
        studioWorkspaces: [{
          id: 'research',
          label: '产业研究',
          path: '/private/vault/Research',
        }],
      };
    },
    buildStudioAssets: async () => {
      calls.push(['build']);
      return {
        publicRoot: '/temporary/studio-assets',
        cleanup: async () => calls.push(['cleanup']),
      };
    },
    startStudioServer: async (options) => {
      calls.push(['server', options]);
      return {
        url: 'http://127.0.0.1:43123/_studio/',
        result: Promise.resolve({ closed: true }),
        close: async () => calls.push(['close']),
      };
    },
    openBrowser: async () => assert.fail('--no-open must not open a browser'),
    write: (message) => calls.push(['write', message]),
    processSignals: false,
  });

  assert.deepEqual(result, { closed: true });
  assert.deepEqual(calls[0], ['config', { repoRoot: '/repo' }]);
  assert.deepEqual(calls[1], ['build']);
  assert.equal(calls[2][0], 'server');
  assert.equal(calls[2][1].publicRoot, '/temporary/studio-assets');
  assert.equal(calls[2][1].openBrowser, undefined);
  assert.match(calls.find(([name]) => name === 'write')[1], /http:\/\/127\.0\.0\.1:43123\/_studio\//u);
  assert.deepEqual(calls.slice(-2), [['close'], ['cleanup']]);
});

test('runStudio rejects an empty workspace config before building assets or starting a server', async () => {
  const calls = [];
  await assert.rejects(
    runStudio(['--no-open'], {
      repoRoot: '/repo',
      loadPublishConfig: async () => {
        calls.push('config');
        return {
          vaultRoot: '/private/vault',
          studioWorkspaces: [],
        };
      },
      buildStudioAssets: async () => {
        calls.push('build');
        assert.fail('empty Studio config must fail before building assets');
      },
      startStudioServer: async () => {
        calls.push('server');
        assert.fail('empty Studio config must fail before server startup');
      },
      processSignals: false,
    }),
    (error) => {
      assert.equal(error.code, 'studio_workspaces_required');
      assert.match(error.message, /studioWorkspaces/u);
      assert.doesNotMatch(error.message, /private\/vault/u);
      return true;
    },
  );
  assert.deepEqual(calls, ['config']);
});

test('server close retains an active transaction and retries cleanup after a temporary failure', async (t) => {
  const previewRoot = await makePreviewRoot(t);
  const cancelIds = [];
  const failure = new Error('temporary publication cleanup failure');
  const { studio, state } = await startFixture(t, {
    previewRoot,
    moduleOverrides: {
      createStudioPublisher: () => ({
        prepare: async () => ({
          transactionId: 'transaction-alpha',
          route: '/blog/alpha/',
          manifest: {
            version: 1,
            transactionId: 'transaction-alpha',
            publications: [],
            files: [],
          },
          previewRoot,
          preparedAt: '2026-07-29T04:00:00.000Z',
        }),
        confirm: async () => assert.fail('not used'),
        cancel: async ({ transactionId }) => {
          cancelIds.push(transactionId);
          if (cancelIds.length === 1) throw failure;
          return { canceled: true };
        },
      }),
    },
  });
  const prepared = await apiJson(studio, state.token, '/_studio/api/publish/prepare', {
    method: 'POST',
    body: {
      workspaceId: 'research',
      relativePath: 'Alpha.md',
      expectedFingerprint: FINGERPRINT_A,
    },
  });
  assert.equal(prepared.response.status, 200);

  await assert.rejects(studio.close(), (error) => error === failure);
  assert.deepEqual(cancelIds, ['transaction-alpha']);
  assert.deepEqual(await studio.close(), { closed: true });
  assert.deepEqual(cancelIds, ['transaction-alpha', 'transaction-alpha']);
});

test('runStudio always cleans temporary assets and preserves the original close failure', async () => {
  const calls = [];
  const closeFailure = new Error('close failed');
  const cleanupFailure = new Error('asset cleanup failed');

  await assert.rejects(
    runStudio(['--no-open'], {
      loadPublishConfig: async () => ({
        studioWorkspaces: [{ id: 'research', label: '产业研究', path: '/vault/Research' }],
      }),
      buildStudioAssets: async () => ({
        publicRoot: '/temporary/studio-assets',
        cleanup: async () => {
          calls.push('cleanup');
          throw cleanupFailure;
        },
      }),
      startStudioServer: async () => ({
        url: 'http://127.0.0.1:43123/_studio/',
        result: Promise.resolve({ closed: true }),
        close: async () => {
          calls.push('close');
          throw closeFailure;
        },
      }),
      write: () => {},
      processSignals: false,
    }),
    (error) => error === closeFailure,
  );
  assert.deepEqual(calls, ['close', 'cleanup']);
});

test('runStudio throws an asset cleanup failure when shutdown otherwise succeeds', async () => {
  const cleanupFailure = new Error('asset cleanup failed');
  await assert.rejects(
    runStudio(['--no-open'], {
      loadPublishConfig: async () => ({
        studioWorkspaces: [{ id: 'research', label: '产业研究', path: '/vault/Research' }],
      }),
      buildStudioAssets: async () => ({
        publicRoot: '/temporary/studio-assets',
        cleanup: async () => {
          throw cleanupFailure;
        },
      }),
      startStudioServer: async () => ({
        url: 'http://127.0.0.1:43123/_studio/',
        result: Promise.resolve({ closed: true }),
        close: async () => ({ closed: true }),
      }),
      write: () => {},
      processSignals: false,
    }),
    (error) => error === cleanupFailure,
  );
});

test('SIGTERM follows retryable close and asset cleanup without replacing the first close error', async () => {
  const signals = new EventEmitter();
  const closeFailure = new Error('signal close failed');
  const calls = [];
  let rejectResult;
  const result = new Promise((_resolve, reject) => {
    rejectResult = reject;
  });

  await assert.rejects(
    runStudio(['--no-open'], {
      loadPublishConfig: async () => ({
        studioWorkspaces: [{ id: 'research', label: '产业研究', path: '/vault/Research' }],
      }),
      buildStudioAssets: async () => ({
        publicRoot: '/temporary/studio-assets',
        cleanup: async () => calls.push('cleanup'),
      }),
      startStudioServer: async () => {
        setImmediate(() => signals.emit('SIGTERM'));
        return {
          url: 'http://127.0.0.1:43123/_studio/',
          result,
          close: async () => {
            calls.push('close');
            if (calls.filter((entry) => entry === 'close').length === 1) {
              rejectResult(closeFailure);
              throw closeFailure;
            }
            return { closed: true };
          },
        };
      },
      write: () => {},
      signalProcess: signals,
      processSignals: true,
    }),
    (error) => error === closeFailure,
  );
  assert.deepEqual(calls, ['close', 'close', 'cleanup']);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});
