import test from 'node:test';
import assert from 'node:assert/strict';

import { renderStudioPreview } from '../publisher/lib/studio-preview.mjs';

test('renders Markdown structures, callouts, resolved embeds, published links, footnotes, and a deterministic outline', async () => {
  const preview = await renderStudioPreview({
    body: [
      '# 总览',
      '',
      '## 炼化利润',
      '',
      '> [!WARNING]- 风险',
      '> 库存数据可能修订。',
      '',
      '- 供给',
      '- 需求',
      '',
      '| 指标 | 结论 |',
      '| --- | --- |',
      '| TC | 下行 |',
      '',
      '```js',
      'const margin = 1;',
      '```',
      '',
      '见 [[Copper Cycle|铜周期]] 和 ![[Charts/TC.png|加工费图]][^1]。',
      '',
      '[^1]: 来自行业数据。',
    ].join('\n'),
    metadata: { title: '炼化周报' },
    resolveAsset: (reference) => reference === 'Charts/TC.png'
      ? { src: '/media/tc.png', alt: 'TC 图' }
      : undefined,
    resolveWikiLink: (target) => target === 'Copper Cycle'
      ? { kind: 'published', href: '/blog/copper-cycle/', label: '铜周期' }
      : undefined,
  });

  assert.match(preview.html, /<h1 id="总览">总览<\/h1>/);
  assert.match(preview.html, /<h2 id="炼化利润">炼化利润<\/h2>/);
  assert.match(preview.html, /<blockquote>\s*<p><strong>Warning: 风险<\/strong>\s+库存数据可能修订。<\/p>\s*<\/blockquote>/);
  assert.match(preview.html, /<ul>\s*<li>供给<\/li>/);
  assert.match(preview.html, /<table>/);
  assert.match(preview.html, /<pre><code class="language-js">const margin = 1;\n<\/code><\/pre>/);
  assert.match(preview.html, /<a href="\/blog\/copper-cycle\/">铜周期<\/a>/);
  assert.match(preview.html, /<img src="\/media\/tc.png" alt="加工费图"\s*\/>/);
  assert.match(preview.html, /<section class="footnotes" data-footnotes>/);
  assert.match(preview.html, /id="footnote-1"/);
  assert.match(preview.html, /data-footnote-backref/);
  assert.deepEqual(preview.outline, [
    { depth: 1, text: '总览', id: '总览' },
    { depth: 2, text: '炼化利润', id: '炼化利润' },
  ]);
  assert.deepEqual(preview.diagnostics, []);
});

test('uses visible text for unpublished wiki links and reports unresolved embeds', async () => {
  const preview = await renderStudioPreview({
    body: '[[Private Note]]\n\n![[missing.png|图表]]',
    metadata: { title: '标题' },
    resolveWikiLink: () => ({ kind: 'plain-text', label: 'Private Note' }),
    resolveAsset: () => undefined,
  });

  assert.match(preview.html, /<p>Private Note<\/p>/);
  assert.doesNotMatch(preview.html, /href=.*Private Note/);
  assert.match(preview.html, /<p>图表<\/p>/);
  assert.deepEqual(preview.diagnostics, [
    {
      code: 'unresolved_embed',
      reference: 'missing.png',
      message: 'Could not resolve embedded asset "missing.png"',
    },
  ]);
});

test('removes active raw HTML, event handlers, and unsafe URL schemes', async () => {
  const preview = await renderStudioPreview({
    body: [
      '# 标题',
      '',
      '<script>alert(1)</script>',
      '<img src="javascript:alert(2)" onerror="alert(3)">',
      '[bad](javascript:alert(4))',
      '<svg onload="alert(5)"><circle></circle></svg>',
      '<iframe src="https://example.com"></iframe>',
      '',
      '[[Private Note]]',
    ].join('\n'),
    metadata: { title: '标题' },
    resolveWikiLink: () => ({ kind: 'plain-text', label: 'Private Note' }),
  });

  assert.doesNotMatch(preview.html, /script|alert|javascript:|onerror|onload|svg|iframe/i);
  assert.match(preview.html, />Private Note</);
});

test('suffixes repeated heading IDs deterministically after stripping inline markup', async () => {
  const preview = await renderStudioPreview({
    body: '## 炼化 *利润*\n\n## 炼化 利润\n\n## 炼化 利润',
    metadata: { title: '标题' },
  });

  assert.match(preview.html, /<h2 id="炼化-利润">炼化 <em>利润<\/em><\/h2>/);
  assert.match(preview.html, /<h2 id="炼化-利润-2">炼化 利润<\/h2>/);
  assert.match(preview.html, /<h2 id="炼化-利润-3">炼化 利润<\/h2>/);
  assert.deepEqual(preview.outline, [
    { depth: 2, text: '炼化 利润', id: '炼化-利润' },
    { depth: 2, text: '炼化 利润', id: '炼化-利润-2' },
    { depth: 2, text: '炼化 利润', id: '炼化-利润-3' },
  ]);
});
