import assert from 'node:assert/strict';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';

import {
  parseStudioDocument,
  publicationFormSchema,
  serializeStudioDocument,
} from '../publisher/lib/studio-frontmatter.mjs';
import { FrontmatterParseError } from '../publisher/lib/frontmatter.mjs';

function note(data) {
  return `---\n${Object.entries(data).map(([key, value]) => `${key}: ${value}`).join('\n')}\n---\n`;
}

function parseYamlFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  assert.ok(match, 'expected YAML frontmatter');
  return {
    data: parseYaml(match[1]),
    content: source.slice(match[0].length),
  };
}

test('form updates preserve unknown YAML fields and body bytes', () => {
  const trailingSpaces = '  ';
  const source = `---
publish: false
title: 旧标题
custom_private_flag: keep-me
tags: [铜, 炼化]
---

正文${trailingSpaces}
`;
  const output = serializeStudioDocument({
    source,
    patch: { title: '新标题', publish: true },
    body: '\n正文  \n',
  });
  const parsed = parseYamlFrontmatter(output);
  assert.equal(parsed.data.custom_private_flag, 'keep-me');
  assert.equal(parsed.data.title, '新标题');
  assert.equal(parsed.data.publish, true);
  assert.equal(parsed.content, '\n正文  \n');
});

test('changing title never changes an existing publish_id', () => {
  const output = serializeStudioDocument({
    source: note({ publish_id: 'stable-url', title: '旧标题' }),
    patch: { title: '新标题' },
  });
  assert.equal(parseYamlFrontmatter(output).data.publish_id, 'stable-url');
});

test('parseStudioDocument separates normalized known fields from unknown YAML without changing the body', () => {
  const trailingSpaces = '  ';
  const source = `---
title:  铜矿供给${trailingSpaces}
custom_private_flag: keep-me
tags: 铜
---

正文${trailingSpaces}
`;

  const parsed = parseStudioDocument(source, { filename: '研究/铜.md' });

  assert.equal(parsed.data.custom_private_flag, 'keep-me');
  assert.equal(parsed.known.title, '铜矿供给');
  assert.deepEqual(parsed.known.tags, ['铜']);
  assert.deepEqual(parsed.unknown, { custom_private_flag: 'keep-me' });
  assert.equal(parsed.body, '\n正文  \n');
  assert.equal(parsed.rawFrontmatter, 'title:  铜矿供给  \ncustom_private_flag: keep-me\ntags: 铜');
});

test('parseStudioDocument rejects duplicate YAML keys and malformed frontmatter', () => {
  assert.throws(
    () => parseStudioDocument('---\ntitle: one\ntitle: two\n---\nbody', { filename: '重复.md' }),
    (error) => error instanceof FrontmatterParseError && error.diagnostics[0].filename === '重复.md',
  );
  assert.throws(
    () => parseStudioDocument('---\ntitle: [unterminated\n---\nbody', { filename: '损坏.md' }),
    (error) => error instanceof FrontmatterParseError && error.diagnostics[0].filename === '损坏.md',
  );
});

test('publicationFormSchema returns the publication form contract', () => {
  assert.deepEqual(publicationFormSchema({ domain: 'ai', format: 'log' }), [
    { name: 'publish', type: 'boolean', label: '允许发布' },
    { name: 'publish_id', type: 'slug', label: '固定网址', lockedWhenPresent: true },
    { name: 'domain', type: 'select', options: ['investment', 'ai', 'beyond'] },
    { name: 'section', type: 'select', visibleWhen: { domain: 'investment' } },
    { name: 'format', type: 'select', options: ['article', 'log'] },
    { name: 'title', type: 'text', requiredWhen: { format: 'article' } },
    { name: 'summary', type: 'textarea', requiredWhen: { format: 'article' } },
    { name: 'topic', type: 'text' },
    { name: 'source_type', type: 'select', options: ['original', 'book', 'podcast', 'report', 'news', 'mixed'] },
    { name: 'tags', type: 'string-list' },
    { name: 'commodities', type: 'string-list' },
    { name: 'companies', type: 'string-list' },
    { name: 'tickers', type: 'string-list' },
    { name: 'thesis', type: 'textarea' },
    { name: 'confidence', type: 'select', options: ['', 'low', 'medium', 'high'] },
  ]);
});
