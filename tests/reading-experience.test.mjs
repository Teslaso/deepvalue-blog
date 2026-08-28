import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test, before } from 'node:test';

const repositoryRoot = new URL('../', import.meta.url);

function visibleHtml(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, '');
}

before(() => {
  execFileSync('npm', ['run', 'build'], {
    cwd: repositoryRoot,
    stdio: 'pipe',
  });
});

test('homepage presents one chronological list of all retained published articles', () => {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const visible = visibleHtml(html);

  assert.doesNotMatch(visible, /FEATURED RESEARCH|重点研究|Published research/);
  assert.match(visible, /全部文章/);
  assert.doesNotMatch(visible, /INVESTMENT RESEARCH|AI &amp; TECHNOLOGY/);

  const homepage = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
  assert.match(homepage, /sortEntriesByPublishedNewestFirst/);
  assert.match(homepage, /dateMode="published"/);

  const articleRoutes = [
    '/blog/sun-yuchen-person-research/',
    '/blog/work-salary-antifragility-taleb-inamori-career/',
    '/blog/fast-slow-thinking-cognitive-rhythm/',
    '/blog/ai-agent-chatbot-harness-mcp-skills/',
    '/blog/switzerland-antifragile-institutions-research-method/',
    '/blog/field-research-investment-method/',
  ];
  const positions = articleRoutes.map(route => html.indexOf(route));

  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);

  for (const route of [
    '/blog/spacex-10gw-ai-compute-2027/',
    '/blog/china-refining-capital-cycle/',
    '/blog/hog-price-cycle/',
    '/blog/滨化股份-g5-级电子级氢氟酸真业务小体量与第二曲线验证/',
  ]) {
    assert.equal(html.indexOf(route), -1, `removed route still appears: ${route}`);
  }
});

test('homepage starts with the article list and omits the old professional positioning', () => {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /class="hero"/u);
  assert.doesNotMatch(html, /commodities-macro-hero/u);
  assert.doesNotMatch(html, /INDUSTRY RESEARCH · TRADING · APPLIED AI/u);
  assert.doesNotMatch(html, /记录产业研究、交易实践与 AI 应用。/u);
  assert.match(html, /ARTICLE INDEX/u);
  assert.match(html, /全部文章/u);

  const homepage = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
  assert.match(homepage, /class="homepage-index"/u);
  assert.match(homepage, /sortEntriesByPublishedNewestFirst/u);
  assert.match(homepage, /dateMode="published"/u);
});

test('homepage removes the commodity manifesto while About keeps structural translation markers', () => {
  const homepage = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
  const about = readFileSync(new URL('../src/pages/about/index.astro', import.meta.url), 'utf8');

  assert.doesNotMatch(homepage, /home\.manifesto/u);
  assert.match(about, /data-i18n="about.positioningTitle"/u);
  assert.match(about, /data-i18n="about.formatNote"/u);
});

test('public navigation and homepage omit dormant journal, boundary, and editorial-method surfaces', () => {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const visible = visibleHtml(html);

  assert.doesNotMatch(visible, /href="\/research-log\/"/);
  assert.doesNotMatch(visible, /href="\/beyond\/"/);
  assert.doesNotMatch(visible, /RESEARCH LOG|研究日志/);
  assert.doesNotMatch(visible, /BEYOND THE BOUNDARY|边界之外/);
  assert.doesNotMatch(visible, /Editorial method|把判断放回证据/);
});

test('article pages put the title before secondary research metadata and move notes after the body', () => {
  const html = readFileSync(
    new URL('../dist/blog/field-research-investment-method/index.html', import.meta.url),
    'utf8',
  );
  const titlePosition = html.indexOf('田野调查到底是什么');
  const thesisPosition = html.indexOf('THESIS / 核心判断');
  const metadataPosition = html.indexOf('ARTICLE INFORMATION');

  assert.ok(titlePosition >= 0);
  assert.ok(thesisPosition > titlePosition);
  assert.ok(metadataPosition > thesisPosition);
});

test('article lists omit redundant publication-state labels and tag chips', () => {
  const html = readFileSync(new URL('../dist/investment/index.html', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /class="entry-tag"/);
  assert.doesNotMatch(html, />发布</);
  assert.doesNotMatch(html, />更新</);
});
