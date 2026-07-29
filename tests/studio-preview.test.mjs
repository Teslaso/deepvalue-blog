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

test('uses visible text for unpublished wiki links and reports unresolved embeds without Vault paths', async () => {
  const preview = await renderStudioPreview({
    body: '[[Private/Private Note]]\n\n![[Attachments/Confidential/missing.png|图表]]',
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
      reference: '图表',
      message: 'Could not resolve embedded asset',
    },
  ]);
  assert.doesNotMatch(JSON.stringify(preview.diagnostics), /Attachments|Confidential|missing\.png/);
});

test('redacts private resolver targets from unresolved and unsafe diagnostics', async () => {
  const preview = await renderStudioPreview({
    body: '[[Private/Board/Strategy]] ![[Attachments/Secret/Plan.png]]',
    metadata: { title: '标题' },
    resolveWikiLink: () => ({ kind: 'published', href: 'javascript:alert(1)', label: '公开标签' }),
    resolveAsset: () => ({ src: 'javascript:alert(1)', alt: '公开图片' }),
  });

  assert.deepEqual(preview.diagnostics, [
    {
      code: 'unsafe_wiki_link',
      reference: '公开标签',
      message: 'Wiki link resolved to an unsafe URL',
    },
    {
      code: 'unsafe_embed_url',
      reference: '公开图片',
      message: 'Embedded asset resolved to an unsafe URL',
    },
  ]);
  assert.doesNotMatch(JSON.stringify(preview.diagnostics), /Private|Board|Strategy|Attachments|Secret|Plan/);
});

test('does not resolve Obsidian syntax inside fenced, inline, multiline, or indented code', async () => {
  const calls = [];
  const preview = await renderStudioPreview({
    body: [
      '[[Live]]',
      '',
      '```md',
      '[[Fenced]] ![[Fenced.png]]',
      '```',
      '',
      '`[[Inline]] ![[Inline.png]]`',
      '',
      '`starts',
      '[[Multiline]] ![[Multiline.png]]',
      'ends`',
      '',
      '    [[Indented]] ![[Indented.png]]',
    ].join('\n'),
    metadata: { title: '标题' },
    resolveWikiLink: (target) => {
      calls.push(`wiki:${target}`);
      return { kind: 'plain-text', label: target };
    },
    resolveAsset: (target) => {
      calls.push(`asset:${target}`);
      return { src: `/media/${target}` };
    },
  });

  assert.deepEqual(calls, ['wiki:Live']);
  assert.match(preview.html, /\[\[Fenced\]\] !\[\[Fenced\.png\]\]/);
  assert.match(preview.html, /\[\[Inline\]\] !\[\[Inline\.png\]\]/);
  assert.match(preview.html, /\[\[Multiline\]\] !\[\[Multiline\.png\]\]/);
  assert.match(preview.html, /\[\[Indented\]\] !\[\[Indented\.png\]\]/);
});

test('treats every Marked indented-code form as protected and resumes after a multiline code span closes in indentation', async () => {
  const calls = [];
  await renderStudioPreview({
    body: [
      '    - [[Four-space list]]',
      ' \t[[Mixed whitespace]]',
      '`open',
      '    close`',
      '[[After close]]',
    ].join('\n'),
    metadata: { title: '标题' },
    resolveWikiLink: (target) => {
      calls.push(target);
      return { kind: 'plain-text', label: target };
    },
  });

  assert.deepEqual(calls, ['After close']);
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

test('reserves generated footnote IDs and decodes outline text without duplicate document IDs', async () => {
  const preview = await renderStudioPreview({
    body: '# Footnote 1\n\n# AT&amp;T\n\n引用[^1]\n\n[^1]: 注释。',
    metadata: { title: '标题' },
  });
  const ids = [...preview.html.matchAll(/\bid="([^"]+)"/gu)].map((match) => match[1]);

  assert.equal(new Set(ids).size, ids.length);
  assert.match(preview.html, /<h1 id="footnote-1-2">Footnote 1<\/h1>/);
  assert.match(preview.html, /<li id="footnote-1">/);
  assert.match(preview.html, /href="#footnote-1" data-footnote-ref/);
  assert.deepEqual(preview.outline, [
    { depth: 1, text: 'Footnote 1', id: 'footnote-1-2' },
    { depth: 1, text: 'AT&T', id: 'at-t' },
  ]);
});

test('reserves blockquote footnotes without reserving fenced pseudo-footnotes', async () => {
  const preview = await renderStudioPreview({
    body: [
      '# Footnote 1',
      '',
      '> [^1]: 引用脚注。',
      '',
      '引用[^1]',
      '',
      '```md',
      '[^fake]: 这只是代码。',
      '```',
      '',
      '# Footnote fake',
    ].join('\n'),
    metadata: { title: '标题' },
  });
  const ids = [...preview.html.matchAll(/\bid="([^"]+)"/gu)].map((match) => match[1]);

  assert.equal(new Set(ids).size, ids.length);
  assert.match(preview.html, /<h1 id="footnote-1-2">Footnote 1<\/h1>/);
  assert.match(preview.html, /<li id="footnote-1">/);
  assert.match(preview.html, /href="#footnote-1" data-footnote-ref/);
  assert.match(preview.html, /<h1 id="footnote-fake">Footnote fake<\/h1>/);
});

test('decodes all HTML entities in outline text and replaces invalid numeric surrogate entities', async () => {
  const preview = await renderStudioPreview({
    body: '# A&copy;B\n\n# Bad &#xD800;',
    metadata: { title: '标题' },
  });

  assert.deepEqual(preview.outline, [
    { depth: 1, text: 'A©B', id: 'a-b' },
    { depth: 1, text: 'Bad �', id: 'bad' },
  ]);
  assert.equal([...preview.outline[1].text].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint >= 0xd800 && codePoint <= 0xdfff;
  }), false);
});
