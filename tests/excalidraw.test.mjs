import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { decodeExcalidrawMarkdown } from '../src/lib/excalidraw.mjs';

const SOURCE_PATH = '/Users/matt/Library/CloudStorage/OneDrive-个人/obsidian_trading/Excalidraw/铝.md';

test('decodes the Aluminum Obsidian drawing into an Excalidraw scene', async () => {
  const markdown = await readFile(SOURCE_PATH, 'utf8');
  const scene = decodeExcalidrawMarkdown(markdown);

  assert.equal(scene.type, 'excalidraw');
  assert.ok(scene.elements.length > 0);
  assert.ok(scene.elements.some((element) => element.text?.includes('铝')));
  assert.equal(typeof scene.appState, 'object');
});

test('rejects Markdown without a compressed Excalidraw drawing', () => {
  assert.throws(
    () => decodeExcalidrawMarkdown('# not a drawing'),
    /compressed-json/i,
  );
});
