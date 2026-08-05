import assert from 'node:assert/strict';
import { readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { publicationFormSchema } from '../publisher/lib/studio-frontmatter.mjs';
import { buildStudioAssets } from '../publisher/studio.mjs';

const SHELL_PATH = new URL('../publisher/studio/index.html', import.meta.url);
const INDEX_PATH = new URL('../publisher/studio/client/index.js', import.meta.url);
const UI_PATH = new URL('../publisher/studio/client/ui.js', import.meta.url);
const CSS_PATH = new URL('../publisher/studio/client/styles.css', import.meta.url);

const shell = await readFile(SHELL_PATH, 'utf8');
const indexSource = await readFile(INDEX_PATH, 'utf8');
const uiSource = await readFile(UI_PATH, 'utf8');
const styles = await readFile(CSS_PATH, 'utf8');

test('studio shell exposes the complete data-testid contract', () => {
  for (const testid of [
    'studio-shell',
    'document-list',
    'metadata-panel',
    'markdown-editor',
    'instant-preview',
    'save-status',
    'prepare-publish',
    'publish-review',
    'conflict-dialog',
  ]) {
    assert.match(shell, new RegExp(`data-testid="${testid}"`, 'u'), testid);
  }
});

test('studio shell uses exact Chinese action names', () => {
  for (const label of [
    '保存',
    '准备发布',
    '新建文章',
    '重新载入磁盘版本',
    '打开对比',
    '保留网页版本',
    '确认并推送',
    '仅确认，不推送',
    '取消发布',
    '即时预览',
  ]) {
    assert.ok(shell.includes(label), label);
  }
});

test('status containers are live regions and mobile tabs are real buttons', () => {
  assert.match(shell, /data-testid="save-status"[^>]*role="status"/u);
  assert.match(shell, /data-testid="status-bar"[^>]*role="status"/u);
  for (const tab of ['tab-documents', 'tab-editor', 'tab-preview']) {
    assert.match(
      shell,
      new RegExp(`<button[^>]*data-testid="${tab}"[^>]*aria-selected="(?:true|false)"`, 'u'),
      tab,
    );
  }
});

test('shell keeps the token placeholder and loads only same-origin bundled assets', () => {
  assert.ok(shell.includes('__STUDIO_DATA__'));
  assert.match(shell, /<script id="studio-data" type="application\/json">/u);
  assert.match(shell, /<script type="module" src="\/_studio\/assets\/studio\.js"><\/script>/u);
  assert.match(shell, /<link rel="stylesheet" href="\/_studio\/assets\/studio\.css">/u);
  assert.doesNotMatch(shell, /<script(?![^>]*application\/json)[^>]*>[^<]+</u);
  assert.doesNotMatch(shell, /https?:\/\//u);
});

test('client form schema mirrors the server publicationFormSchema', () => {
  for (const field of publicationFormSchema()) {
    assert.match(
      uiSource,
      new RegExp(`name: '${field.name}',\\s+type: '${field.type}'`, 'u'),
      field.name,
    );
  }
});

test('stylesheet carries the confirmed Deep Value tokens and mobile breakpoint', () => {
  for (const token of [
    '--color-ink: #0b0c0b',
    '--color-paper: #d8cfbd',
    '--color-copper: #a46743',
    '--color-olive: #777b68',
    '"Songti SC"',
    '"Space Mono"',
  ]) {
    assert.ok(styles.includes(token), token);
  }
  assert.match(styles, /@media \(max-width: 719px\)/u);
  assert.match(styles, /grid-template-columns: minmax\(280px, 320px\) minmax\(400px, 1fr\) minmax\(430px, 1fr\)/u);
  assert.match(styles, /prefers-reduced-motion/u);
});

test('runStudio asset build emits the bundled client below the OS temp root', async (t) => {
  const assets = await buildStudioAssets();
  t.after(() => assets.cleanup());
  const temporaryRoot = await realpath(os.tmpdir());
  const physicalPublicRoot = await realpath(assets.publicRoot);
  assert.ok(physicalPublicRoot.startsWith(temporaryRoot));
  const bundle = await readFile(path.join(assets.publicRoot, 'assets', 'studio.js'), 'utf8');
  const css = await readFile(path.join(assets.publicRoot, 'assets', 'studio.css'), 'utf8');
  assert.doesNotMatch(bundle, /from ["']@codemirror\//u);
  assert.match(bundle, /studio-shell/u);
  assert.match(css, /--color-ink/u);
  const index = await readFile(path.join(assets.publicRoot, 'index.html'), 'utf8');
  assert.ok(index.includes('__STUDIO_DATA__'));
});

test('client exposes a dedicated dual-fingerprint conflict-resolution API', () => {
  assert.match(
    indexSource,
    /resolveConflict:\s*\(input\)\s*=>\s*request\(['"]\/document\/resolve-conflict['"],\s*\{\s*method:\s*'PUT',\s*json:\s*input\s*\}\)/u,
  );
  assert.doesNotMatch(
    indexSource,
    /resolveConflict:\s*\(input\)\s*=>\s*request\(['"]\/document['"]/u,
  );
});

test('keep-browser conflict resolution sends stale and current fingerprints through the dedicated endpoint', () => {
  const block = uiSource.slice(uiSource.indexOf('resolveConflictKeepBrowser'));
  assert.match(block, /api\.resolveConflict\(/u);
  assert.match(block, /staleFingerprint:\s*conflict\.staleFingerprint/u);
  assert.match(block, /currentFingerprint:\s*conflict\.diskFingerprint/u);
  assert.match(block, /patch:\s*readFormMetadata\(\)/u);
  assert.match(block, /body:\s*currentBody\(\)/u);
  assert.doesNotMatch(block, /api\.saveDocument/u);
});
