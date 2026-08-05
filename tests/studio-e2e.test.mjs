import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { validatePublishConfig } from '../publisher/lib/config.mjs';
import { buildStudioAssets } from '../publisher/studio.mjs';
import { startStudioServer } from '../publisher/studio-server.mjs';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function command(executable, args, cwd) {
  return execFileAsync(executable, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

async function linkDependencies(repoRoot) {
  const source = path.join(projectRoot, 'node_modules');
  const destination = path.join(repoRoot, 'node_modules');
  await mkdir(destination);
  for (const entry of await readdir(source)) {
    await symlink(path.join(source, entry), path.join(destination, entry), 'junction');
  }
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

function parseStudioState(html) {
  const match = html.match(/<script id="studio-data" type="application\/json">([^<]*)<\/script>/u);
  assert.ok(match, 'studio page must contain escaped JSON state');
  return JSON.parse(match[1]);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function pngBytes() {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00]),
  ]);
}

test('writing studio end-to-end publishes an article without leaking private Vault content', { timeout: 240_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-e2e-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const repoRoot = path.join(root, 'repo');
  const vaultRoot = path.join(root, 'Vault');
  const stagingParent = path.join(root, 'staging');
  const PRIVATE_TEXT = '绝不公开的私人内容。';

  await command('git', ['clone', '--quiet', '--no-local', projectRoot, repoRoot], root);
  await command('git', ['config', 'user.name', 'Studio E2E'], repoRoot);
  await command('git', ['config', 'user.email', 'studio-e2e@example.com'], repoRoot);
  await linkDependencies(repoRoot);
  await mkdir(stagingParent);

  await mkdir(path.join(vaultRoot, 'Publishing', 'Research'), { recursive: true });
  await mkdir(path.join(vaultRoot, 'Attachments'), { recursive: true });
  await writeFile(path.join(vaultRoot, 'Private.md'), `---\npublish: false\n---\n${PRIVATE_TEXT}\n`);

  const config = await validatePublishConfig({
    vaultRoot,
    entryOutputDir: 'src/content/entries',
    mediaOutputDir: 'public/media',
    attachmentRoots: ['Attachments'],
    ignoreFolders: ['.obsidian'],
    studioWorkspaces: [{ id: 'research', label: '产业研究', path: 'Publishing/Research' }],
    studioAttachmentRoot: 'Attachments/Studio',
    stagingParent,
  }, { repoRoot });

  const assets = await buildStudioAssets();
  t.after(() => assets.cleanup());
  const studio = await startStudioServer({
    config,
    publicRoot: assets.publicRoot,
    openBrowser: async () => {},
  });
  t.after(() => studio.close());

  const page = await fetch(studio.url);
  const token = parseStudioState(await page.text()).token;

  // 1. workspace scan exposes only the configured workspace; private note invisible.
  const workspaces = await apiJson(studio, token, '/_studio/api/workspaces');
  assert.equal(workspaces.response.status, 200);
  const workspace = workspaces.json.workspaces.find(({ id }) => id === 'research');
  assert.deepEqual(workspace.documents.map(({ relativePath }) => relativePath), []);
  assert.doesNotMatch(JSON.stringify(workspaces.json), /Private\.md|绝不公开/u);

  // 2. create an article in the workspace.
  const created = await apiJson(studio, token, '/_studio/api/document', {
    method: 'POST',
    body: { workspaceId: 'research', title: '铜供给观察' },
  });
  assert.equal(created.response.status, 201);
  const relativePath = created.json.document.relativePath;
  assert.match(relativePath, /^铜供给观察\.md$/u);

  // 3. upload a PNG and use the returned Obsidian embed.
  const attachment = await fetch(new URL('/_studio/api/attachment', studio.url), {
    method: 'POST',
    headers: apiHeaders(token, {
      'content-type': 'image/png',
      'x-studio-filename': encodeURIComponent('库存 图.png'),
      'x-studio-alt': encodeURIComponent('库存图'),
    }),
    body: pngBytes(),
  });
  assert.equal(attachment.status, 201);
  const attachmentBody = await attachment.json();
  assert.match(attachmentBody.attachment.relativePath, /^Attachments\/Studio\//u);
  assert.match(attachmentBody.attachment.embed, /^!\[\[Attachments\/Studio\/.+\.png\|库存图\]\]$/u);
  const embed = attachmentBody.attachment.embed;

  // 4. save the article with complete publication metadata.
  const save = await apiJson(studio, token, '/_studio/api/document', {
    method: 'PUT',
    body: {
      workspaceId: 'research',
      relativePath,
      expectedFingerprint: created.json.document.fingerprint,
      patch: {
        publish: true,
        publish_id: 'copper-supply-note',
        title: '铜供给观察',
        domain: 'investment',
        section: 'commodities',
        topic: '铜',
        format: 'article',
        summary: '从库存与资本开支观察铜供给约束。',
        source_type: 'original',
        tags: ['铜', '供给'],
        commodities: ['铜'],
      },
      body: `# 铜供给观察\n\n正文内容。\n\n${embed}\n`,
    },
  });
  assert.equal(save.response.status, 200);
  assert.equal(save.json.document.status, 'ready');

  // 5. an external modification produces a 409 conflict on the next save.
  const diskPath = path.join(config.studioWorkspaces[0].path, relativePath);
  await writeFile(diskPath, `${await readFile(diskPath, 'utf8')}# 外部补充\n`);
  const conflicted = await apiJson(studio, token, '/_studio/api/document', {
    method: 'PUT',
    body: {
      workspaceId: 'research',
      relativePath,
      expectedFingerprint: save.json.document.fingerprint,
      patch: { title: '铜供给观察' },
      body: '另一个正文',
    },
  });
  assert.equal(conflicted.response.status, 409);

  // 6. resolve by reloading the disk version.
  const diskDoc = await apiJson(
    studio,
    token,
    `/_studio/api/document?workspaceId=research&path=${encodeURIComponent(relativePath)}`,
  );
  assert.equal(diskDoc.response.status, 200);
  assert.match(diskDoc.json.document.source, /外部补充/u);

  // 7. prepare publication without modifying the repository.
  const prepared = await apiJson(studio, token, '/_studio/api/publish/prepare', {
    method: 'POST',
    body: {
      workspaceId: 'research',
      relativePath,
      expectedFingerprint: diskDoc.json.document.fingerprint,
    },
  });
  assert.equal(prepared.response.status, 200);
  assert.equal(prepared.json.publication.route, '/blog/copper-supply-note/');
  assert.match(
    prepared.json.publication.previewUrl,
    /^\/_studio\/final-preview\/blog\/copper-supply-note\//u,
  );
  assert.equal(Object.hasOwn(prepared.json.publication, 'previewRoot'), false);
  assert.doesNotMatch(
    JSON.stringify(prepared.json),
    new RegExp(escapeRegex(vaultRoot), 'u'),
  );
  const repoStatusAfterPrepare = await command(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    repoRoot,
  );
  assert.equal(repoStatusAfterPrepare.stdout.trim(), '');

  // 8. fetch the real Astro preview route.
  const finalPage = await fetch(new URL(prepared.json.publication.previewUrl, studio.url));
  assert.equal(finalPage.status, 200);
  assert.match(await finalPage.text(), /铜供给观察/u);

  // 9. confirm a local-only publication.
  const confirmed = await apiJson(studio, token, '/_studio/api/publish/confirm', {
    method: 'POST',
    body: { transactionId: prepared.json.publication.transactionId, push: false },
  });
  assert.equal(confirmed.response.status, 200);
  assert.equal(confirmed.json.result.pushed, false);
  assert.match(confirmed.json.result.commitSha, /^[a-f0-9]{40}$/u);

  // 10. only the exact entry and media targets are committed.
  const committed = (await command(
    'git',
    ['-c', 'core.quotepath=false', 'show', '--pretty=', '--name-only', confirmed.json.result.commitSha],
    repoRoot,
  )).stdout.trim().split('\n').sort();
  const mediaFiles = committed.filter((file) => file.startsWith('public/media/copper-supply-note/'));
  assert.equal(mediaFiles.length, 1, committed.join('\n'));
  assert.match(mediaFiles[0], /\.png$/u);
  assert.deepEqual(
    committed,
    ['src/content/entries/copper-supply-note.md', mediaFiles[0]].sort(),
  );

  // 11. private Vault content never appears in responses, state, or Git.
  const emittedEntry = await readFile(
    path.join(repoRoot, 'src/content/entries/copper-supply-note.md'),
    'utf8',
  );
  const persistedState = await readFile(path.join(repoRoot, '.publish-state.json'), 'utf8');
  const combined = `${emittedEntry}\n${persistedState}\n${JSON.stringify(workspaces.json)}`;
  assert.doesNotMatch(combined, new RegExp(escapeRegex(vaultRoot), 'u'));
  assert.doesNotMatch(combined, new RegExp(PRIVATE_TEXT, 'u'));
  assert.doesNotMatch(combined, /Private\.md/u);
  const repoTree = (await command(
    'git',
    ['-c', 'core.quotepath=false', 'ls-tree', '-r', '--name-only', 'HEAD'],
    repoRoot,
  )).stdout;
  assert.doesNotMatch(repoTree, /Private\.md|绝不公开/u);

  // 12. the workspace now lists only the article and the private note is still invisible.
  const afterPublish = await apiJson(studio, token, '/_studio/api/workspaces');
  const documents = afterPublish.json.workspaces[0].documents;
  assert.deepEqual(documents.map(({ relativePath }) => relativePath), [relativePath]);
  assert.doesNotMatch(JSON.stringify(afterPublish.json), /Private\.md|绝不公开/u);
});
