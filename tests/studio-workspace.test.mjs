import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  realpath,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { scanStudioWorkspace } from '../publisher/lib/studio-workspace.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-workspace-'));
  const workspace = path.join(root, 'Research');
  const repoRoot = path.join(root, 'repo');
  await mkdir(workspace);
  await mkdir(repoRoot);
  return {
    root,
    repoRoot,
    workspace,
    config: {
      repoRoot: await realpath(repoRoot),
      studioWorkspaces: [{
        id: 'research',
        label: '产业研究',
        path: await realpath(workspace),
      }],
    },
  };
}

function digest(source) {
  return createHash('sha256').update(Buffer.from(source, 'utf8')).digest('hex');
}

async function cleanup(root) {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}

test('workspace scan returns only physical Markdown files sorted by modification time', async () => {
  const current = await fixture();
  const outside = path.join(current.root, 'Private');

  try {
    await mkdir(path.join(current.workspace, 'Nested'));
    await mkdir(path.join(current.workspace, '.obsidian'));
    await mkdir(outside);
    await writeFile(path.join(current.workspace, 'Recent.md'), '---\ntitle: Recent\n---\npublic\n');
    await writeFile(path.join(current.workspace, 'Nested', 'Older.md'), '---\ntitle: Older\n---\npublic\n');
    await writeFile(path.join(current.workspace, 'Notes.txt'), 'not Markdown');
    await writeFile(path.join(current.workspace, '.obsidian', 'Private.md'), 'secret');
    await writeFile(path.join(outside, 'Outside.md'), 'outside secret');
    await symlink(outside, path.join(current.workspace, 'Linked'));
    await symlink(
      path.join(outside, 'Outside.md'),
      path.join(current.workspace, 'Linked-file.md'),
    );
    await utimes(
      path.join(current.workspace, 'Nested', 'Older.md'),
      new Date('2026-07-20T00:00:00.000Z'),
      new Date('2026-07-20T00:00:00.000Z'),
    );
    await utimes(
      path.join(current.workspace, 'Recent.md'),
      new Date('2026-07-21T00:00:00.000Z'),
      new Date('2026-07-21T00:00:00.000Z'),
    );

    const workspaces = await scanStudioWorkspace(current.config);

    assert.equal(workspaces.length, 1);
    assert.equal(workspaces[0].id, 'research');
    assert.equal(workspaces[0].label, '产业研究');
    assert.deepEqual(
      workspaces[0].documents.map(({ relativePath }) => relativePath),
      ['Recent.md', 'Nested/Older.md'],
    );
    assert.equal(
      workspaces[0].documents.some(({ relativePath }) => relativePath.includes('Private')),
      false,
    );
    assert.equal(
      workspaces[0].documents.every(({ relativePath }) => !relativePath.includes('\\')),
      true,
    );
  } finally {
    await cleanup(current.root);
  }
});

test('workspace index exposes only public search metadata and sanitizes invalid diagnostics', async () => {
  const current = await fixture();
  const bodySecret = 'BODY-SECRET-4cb331';
  const privateYaml = 'YAML-SECRET-83dc9a';

  try {
    await writeFile(
      path.join(current.workspace, 'Copper.md'),
      `---
publish: false
title: 铜矿供给
topic: 矿山
tags: [铜, 周期]
private_note: ${privateYaml}
---
${bodySecret}
`,
    );
    await writeFile(
      path.join(current.workspace, 'Broken.md'),
      `---
title: [unterminated
---
${bodySecret}
`,
    );
    await writeFile(
      path.join(current.workspace, 'Invalid.md'),
      `---
publish: true
domain: ai
format: log
section: commodities
---
public body
`,
    );

    const [{ documents }] = await scanStudioWorkspace(current.config);
    const copper = documents.find(({ relativePath }) => relativePath === 'Copper.md');
    const broken = documents.find(({ relativePath }) => relativePath === 'Broken.md');
    const invalid = documents.find(({ relativePath }) => relativePath === 'Invalid.md');

    assert.deepEqual(copper.search, {
      filename: 'Copper.md',
      title: '铜矿供给',
      topic: '矿山',
      tags: ['铜', '周期'],
    });
    assert.deepEqual(Object.keys(copper.search), ['filename', 'title', 'topic', 'tags']);
    assert.equal(Object.hasOwn(copper, 'source'), false);
    assert.equal(Object.hasOwn(copper, 'body'), false);
    assert.equal(Object.hasOwn(copper, 'metadata'), false);
    assert.equal(copper.status, 'draft');

    assert.equal(broken.status, 'invalid');
    assert.equal(broken.diagnostics[0].code, 'invalid_yaml');
    assert.equal(invalid.status, 'invalid');
    assert.deepEqual(invalid.diagnostics, [{
      filename: 'Invalid.md',
      field: 'section',
      message: 'Publication metadata is invalid',
      code: 'invalid_section',
    }]);
    const serialized = JSON.stringify(documents);
    assert.equal(serialized.includes(bodySecret), false);
    assert.equal(serialized.includes(privateYaml), false);
    assert.equal(serialized.includes('unterminated'), false);
    assert.equal(serialized.includes('Section commodities'), false);
  } finally {
    await cleanup(current.root);
  }
});

test('workspace scan rejects a configured workspace replaced by a symlink', async () => {
  const current = await fixture();
  const displaced = path.join(current.root, 'Research-original');
  const outside = path.join(current.root, 'Outside');

  try {
    await writeFile(path.join(current.workspace, 'Before.md'), 'before');
    await mkdir(outside);
    await writeFile(path.join(outside, 'Private.md'), 'private');
    await rename(current.workspace, displaced);
    await symlink(outside, current.workspace);

    await assert.rejects(
      scanStudioWorkspace(current.config),
      (error) => error.code === 'unsafe_path',
    );
  } finally {
    await cleanup(current.root);
  }
});

test('workspace status distinguishes ready, published, and modified source hashes', async () => {
  const current = await fixture();
  const published = `---
publish: true
publish_id: published-note
domain: ai
format: log
---
published
`;
  const modified = `---
publish: true
publish_id: modified-note
domain: ai
format: log
---
modified
`;
  const ready = `---
publish: true
publish_id: ready-note
domain: ai
format: log
---
ready
`;

  try {
    await writeFile(path.join(current.workspace, 'Published.md'), published);
    await writeFile(path.join(current.workspace, 'Modified.md'), modified);
    await writeFile(path.join(current.workspace, 'Ready.md'), ready);
    await writeFile(
      path.join(current.repoRoot, '.publish-state.json'),
      `${JSON.stringify({
        version: 1,
        entries: {
          'published-note': { lastPublishedSourceHash: digest(published) },
          'modified-note': { lastPublishedSourceHash: digest(`${modified}external baseline`) },
        },
      }, null, 2)}\n`,
    );

    const [{ documents }] = await scanStudioWorkspace(current.config);
    const statuses = Object.fromEntries(
      documents.map(({ relativePath, status }) => [relativePath, status]),
    );
    assert.deepEqual(statuses, {
      'Modified.md': 'modified',
      'Published.md': 'published',
      'Ready.md': 'ready',
    });
  } finally {
    await cleanup(current.root);
  }
});
