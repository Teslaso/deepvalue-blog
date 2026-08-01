import assert from 'node:assert/strict';
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildStudioAssets } from '../publisher/build-studio.mjs';
import {
  applyMarkdownCommand,
  createChangeNotifier,
  dispatchStudioSave,
  extractMarkdownOutline,
  handleTransfer,
  startImageTransfer,
} from '../publisher/studio/client/editor.js';

test('buildStudioAssets emits self-contained browser assets into a temporary directory', async (t) => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'deep-value-studio-build-test-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const physicalOutputDir = await realpath(outputDir);

  const result = await buildStudioAssets({ outputDir });
  const javascript = await readFile(result.jsPath, 'utf8');
  const css = await readFile(result.cssPath, 'utf8');

  assert.equal(path.dirname(result.jsPath), physicalOutputDir);
  assert.equal(path.dirname(result.cssPath), physicalOutputDir);
  assert.ok(javascript.length > 0);
  assert.ok(css.length > 0);
  assert.doesNotMatch(javascript, /from ["']@codemirror\//u);

  for (const forbidden of ['dist', 'public', path.join('publisher', 'studio', 'client')]) {
    assert.equal(result.jsPath.includes(`${path.sep}${forbidden}${path.sep}`), false);
    assert.equal(result.cssPath.includes(`${path.sep}${forbidden}${path.sep}`), false);
  }
});

test('buildStudioAssets rejects a tracked-source destination without creating it', async (t) => {
  const forbidden = path.resolve('.test-studio-assets-never-create');
  await rm(forbidden, { recursive: true, force: true });
  t.after(() => rm(forbidden, { recursive: true, force: true }));

  await assert.rejects(
    buildStudioAssets({ outputDir: forbidden }),
    /operating-system temporary directory/u,
  );
  await assert.rejects(access(forbidden), { code: 'ENOENT' });
});

test('buildStudioAssets enables source maps in development and omits them in production', async (t) => {
  const previousEnvironment = process.env.NODE_ENV;
  t.after(() => {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  });

  const developmentDir = await mkdtemp(path.join(os.tmpdir(), 'deep-value-studio-dev-'));
  const productionDir = await mkdtemp(path.join(os.tmpdir(), 'deep-value-studio-prod-'));
  t.after(() => Promise.all([
    rm(developmentDir, { recursive: true, force: true }),
    rm(productionDir, { recursive: true, force: true }),
  ]));

  process.env.NODE_ENV = 'development';
  await buildStudioAssets({ outputDir: developmentDir });
  assert.deepEqual((await readdir(developmentDir)).sort(), [
    'studio.css',
    'studio.css.map',
    'studio.js',
    'studio.js.map',
  ]);

  process.env.NODE_ENV = 'production';
  await buildStudioAssets({ outputDir: productionDir });
  assert.deepEqual((await readdir(productionDir)).sort(), [
    'studio.css',
    'studio.js',
  ]);
});

test('buildStudioAssets creates an isolated output directory by default', async (t) => {
  const result = await buildStudioAssets();
  const outputDir = path.dirname(result.jsPath);
  t.after(() => rm(outputDir, { recursive: true, force: true }));

  assert.equal(
    path.relative(await realpath(os.tmpdir()), outputDir).startsWith('deep-value-studio-'),
    true,
  );
  assert.equal(path.dirname(result.cssPath), outputDir);
});

test('extractMarkdownOutline returns ATX headings and ignores fenced code', () => {
  const source = [
    '# 产业研究',
    'intro',
    '```md',
    '## 围栏中的伪标题',
    '```',
    '### 炼化利润 ###',
    '~~~',
    '# another fake heading',
    '~~~',
    '    # indented code',
    '## 交易',
  ].join('\n');

  assert.deepEqual(extractMarkdownOutline(source), [
    { depth: 1, text: '产业研究', line: 1 },
    { depth: 3, text: '炼化利润', line: 6 },
    { depth: 2, text: '交易', line: 11 },
  ]);
});

test('applyMarkdownCommand preserves selected text and selects cursor placeholders', () => {
  assert.deepEqual(
    applyMarkdownCommand({
      command: 'bold',
      value: 'alpha beta',
      selectionStart: 6,
      selectionEnd: 10,
    }),
    {
      value: 'alpha **beta**',
      selectionStart: 8,
      selectionEnd: 12,
    },
  );

  assert.deepEqual(
    applyMarkdownCommand({
      command: 'link',
      value: 'alpha ',
      selectionStart: 6,
      selectionEnd: 6,
    }),
    {
      value: 'alpha [链接文字](https://)',
      selectionStart: 7,
      selectionEnd: 11,
    },
  );

  assert.deepEqual(
    applyMarkdownCommand({
      command: 'image',
      value: '',
      selectionStart: 0,
      selectionEnd: 0,
    }),
    {
      value: '![图片说明](图片地址)',
      selectionStart: 2,
      selectionEnd: 6,
    },
  );
});

test('applyMarkdownCommand toggles heading and quote prefixes at line boundaries', () => {
  assert.deepEqual(
    applyMarkdownCommand({
      command: 'heading',
      value: 'before\ncycle\n',
      selectionStart: 7,
      selectionEnd: 12,
    }),
    {
      value: 'before\n## cycle\n',
      selectionStart: 7,
      selectionEnd: 15,
    },
  );
  assert.deepEqual(
    applyMarkdownCommand({
      command: 'heading',
      value: '## cycle',
      selectionStart: 3,
      selectionEnd: 8,
    }),
    {
      value: 'cycle',
      selectionStart: 0,
      selectionEnd: 5,
    },
  );
  assert.deepEqual(
    applyMarkdownCommand({
      command: 'quote',
      value: 'first\nsecond',
      selectionStart: 0,
      selectionEnd: 12,
    }),
    {
      value: '> first\n> second',
      selectionStart: 0,
      selectionEnd: 16,
    },
  );
});

test('startImageTransfer intercepts only images and inserts successful callback results', async () => {
  const image = { name: 'chart.png', type: 'image/png' };
  const event = {
    clipboardData: { files: [image] },
    preventDefaultCalled: false,
    preventDefault() {
      this.preventDefaultCalled = true;
    },
  };
  const inserted = [];
  const callbackFiles = [];

  const transfer = startImageTransfer({
    event,
    onPasteImage: async (file) => {
      callbackFiles.push(file);
      return { embed: '![[Attachments/Studio/chart.png|利润图]]' };
    },
    insertText: (value) => inserted.push(value),
  });

  assert.equal(transfer.handled, true);
  assert.equal(event.preventDefaultCalled, true);
  assert.deepEqual(await transfer.completion, { inserted: 1, errors: [] });
  assert.deepEqual(callbackFiles, [image]);
  assert.deepEqual(inserted, ['![[Attachments/Studio/chart.png|利润图]]']);

  const textEvent = {
    clipboardData: { files: [{ name: 'notes.txt', type: 'text/plain' }] },
    preventDefault: () => assert.fail('non-image paste must keep browser default'),
  };
  const textTransfer = startImageTransfer({
    event: textEvent,
    onPasteImage: async () => assert.fail('non-image paste must not upload'),
    insertText: () => assert.fail('non-image paste must not insert'),
  });
  assert.equal(textTransfer.handled, false);
  assert.deepEqual(await textTransfer.completion, { inserted: 0, errors: [] });
});

test('startImageTransfer reports upload failures without inserting missing embeds', async () => {
  const failure = new Error('upload failed');
  const event = {
    dataTransfer: {
      files: [
        { name: 'bad.png', type: 'image/png' },
        { name: 'good.webp', type: 'image/webp' },
      ],
    },
    preventDefault() {},
  };
  const inserted = [];
  const transfer = startImageTransfer({
    event,
    onPasteImage: async (file) => {
      if (file.name === 'bad.png') throw failure;
      return '![[Attachments/Studio/good.webp]]';
    },
    insertText: (value) => inserted.push(value),
  });

  assert.deepEqual(await transfer.completion, { inserted: 1, errors: [failure] });
  assert.deepEqual(inserted, ['![[Attachments/Studio/good.webp]]']);
});

test('createChangeNotifier debounces the latest change and cancels after destroy', async () => {
  const changes = [];
  const notifier = createChangeNotifier((value) => changes.push(value), 20);
  notifier.schedule('first');
  notifier.schedule('second');
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.deepEqual(changes, ['second']);

  notifier.schedule('after');
  notifier.destroy();
  await new Promise((resolve) => setTimeout(resolve, 35));
  notifier.schedule('ignored');
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.deepEqual(changes, ['second']);
});

test('handleTransfer never dispatches into a destroyed editor after upload completes', async () => {
  const event = {
    type: 'paste',
    clipboardData: { files: [{ name: 'chart.png', type: 'image/png' }] },
    preventDefault() {},
  };
  const view = {
    dom: {
      isConnected: false,
      ownerDocument: {
        defaultView: {
          CustomEvent: class {
            constructor(type, options) {
              this.type = type;
              Object.assign(this, options);
            }
          },
        },
        dispatchEvent: () => true,
      },
    },
    state: { selection: { main: { from: 0, to: 0 } } },
    dispatch: () => assert.fail('destroyed editor must not receive dispatches'),
  };

  const handled = handleTransfer(view, event, async () => '![[Attachments/Studio/chart.png]]');
  assert.equal(handled, true);
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test('dispatchStudioSave emits a catchable bubbling client event', () => {
  const dispatched = [];
  class FakeCustomEvent {
    constructor(type, options) {
      this.type = type;
      Object.assign(this, options);
    }
  }
  const view = {
    dom: {
      ownerDocument: { defaultView: { CustomEvent: FakeCustomEvent } },
      dispatchEvent(event) {
        dispatched.push(event);
        return true;
      },
    },
  };

  assert.equal(dispatchStudioSave(view), true);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, 'studio:save');
  assert.equal(dispatched[0].bubbles, true);
  assert.equal(dispatched[0].cancelable, true);
});
