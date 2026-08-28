import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { INVESTMENT_SECTIONS } from '../publisher/lib/validate.mjs';

const repositoryRoot = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, repositoryRoot), 'utf8');
}

test('Investment section links use the publisher canonical section slugs', async () => {
  const investment = await source('src/pages/investment/index.astro');
  const sectionSlugs = [...investment.matchAll(/href:\s*'\/investment\/\?section=([^']+)'/g)]
    .map(match => match[1]);

  assert.deepEqual(sectionSlugs, INVESTMENT_SECTIONS);
});

test('publisher documentation names the same canonical investment section slugs', async () => {
  const publisherReadme = await source('publisher/README.md');

  for (const section of INVESTMENT_SECTIONS) {
    assert.match(publisherReadme, new RegExp(`\\b${section}\\b`, 'u'));
  }

  assert.doesNotMatch(
    publisherReadme,
    /one of `commodities`, `industries`, `companies`, `macro`, or\s+`trading`/u,
  );
});

test('homepage no longer depends on the old hero asset', async () => {
  const homepage = await source('src/pages/index.astro');

  assert.doesNotMatch(homepage, /commodities-macro-hero\.(?:avif|png)/u);
  assert.match(homepage, /class="homepage-index"/u);
});

test('homepage goes directly into the unified article list', async () => {
  const homepage = await source('src/pages/index.astro');
  const articleListPosition = homepage.indexOf('class="all-articles-section"');

  assert.ok(articleListPosition >= 0);
  assert.equal(homepage.indexOf('class="hero"'), -1);
  assert.doesNotMatch(homepage, /WHY COMMODITIES|我喜欢大宗商品，因为它离真实世界足够近。/u);
});

test('Base exposes only the personal brand and the two primary links', async () => {
  const layout = await source('src/layouts/Base.astro');

  assert.match(layout, /Deep Value/gu);
  assert.match(layout, /href: '\/blog\//u);
  assert.match(layout, /href: '\/about\//u);
  assert.doesNotMatch(layout, /href: '\/investment\//u);
  assert.doesNotMatch(layout, /href: '\/ai\//u);
  assert.doesNotMatch(layout, /href: '\/archive\//u);
  assert.doesNotMatch(layout, /language-switcher|data-locale-link|translationPayload|ENGLISH_TRANSLATIONS/u);
  assert.doesNotMatch(layout, /Deep Value Research|research publication|Investment · Commodities · AI/u);
});

test('public index and detail pages mark structural copy for translation', async () => {
  const pageMarkers = [
    ['src/pages/investment/index.astro', 'publication.investmentTitle'],
    ['src/pages/ai/index.astro', 'publication.aiTitle'],
    ['src/pages/archive/index.astro', 'publication.archiveTitle'],
    ['src/pages/projects/index.astro', 'publication.projectsTitle'],
    ['src/pages/beyond/index.astro', 'publication.beyondTitle'],
    ['src/pages/blog/index.astro', 'publication.blogTitle'],
    ['src/pages/research-log/index.astro', 'publication.logTitle'],
    ['src/pages/blog/[slug].astro', 'detail.articleInformation'],
    ['src/components/EntryList.astro', 'entry.readArticle'],
  ];

  for (const [path, key] of pageMarkers) {
    const page = await source(path);
    assert.ok(page.includes(key), `missing marker: ${path} / ${key}`);
  }
});

test('dark surfaces use an accessible copper semantic token for small text', async () => {
  const layout = await source('src/layouts/Base.astro');
  const homepage = await source('src/pages/index.astro');
  const blogIndex = await source('src/pages/blog/index.astro');

  assert.match(layout, /--color-copper-on-ink:\s*#[0-9a-f]{6}/iu);
  assert.match(layout, /\.footer-links a\s*\{[^}]*color:\s*var\(--color-copper-on-ink\)/su);
  assert.match(homepage, /\.homepage-index\s*\{[^}]*background:\s*var\(--surface-primary\)/su);
  assert.match(blogIndex, /\.domain-filter button\.is-active span\s*\{[^}]*color:\s*var\(--color-copper-on-ink\)/su);
});

test('Beyond provides a direct in-site entrance to the projects index', async () => {
  const beyond = await source('src/pages/beyond/index.astro');

  assert.match(beyond, /href="\/projects\/"/u);
});

test('EntryList renders grouped empty states and displays its effective date without redundant state labels', async () => {
  const entryList = await source('src/components/EntryList.astro');

  assert.match(entryList, /groupByFormat\s*\|\|\s*entries\.length\s*>\s*0/);
  assert.match(entryList, /effectiveEntryDate\(entry\)/);
  assert.doesNotMatch(entryList, /entry\.data\.updated_at\s*\?\s*'更新'\s*:\s*'发布'/);
});

test('Research Log sorts and labels entries by immutable published timestamp', async () => {
  const researchLog = await source('src/pages/research-log/index.astro');

  assert.match(researchLog, /sortEntriesByPublishedNewestFirst/);
  assert.match(researchLog, /PUBLISHED \/ 发布/);
  assert.match(researchLog, /entry\.data\.published_at\.toISOString\(\)/);
});

test('log detail retains timestamp precision and moves secondary metadata after the content', async () => {
  const detail = await source('src/pages/blog/[slug].astro');

  assert.match(detail, /dateTimeFormatter/);
  assert.match(detail, /isLog\s*\?\s*dateTimeFormatter/);
  assert.match(detail, /aria-label="文章补充信息"/);
  assert.ok(detail.indexOf('<Content />') < detail.indexOf('ARTICLE INFORMATION'));
});
