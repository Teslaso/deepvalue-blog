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

test('homepage proceeds from the hero to the article list without a featured-research module', () => {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const visible = visibleHtml(html);

  assert.doesNotMatch(visible, /FEATURED RESEARCH|重点研究|Published research/);
  assert.match(visible, /INVESTMENT RESEARCH/);
});

test('homepage presents three distinct practices and the concise introduction', () => {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

  assert.match(
    html,
    /hero-title-line[^>]*>产业研究<\/span>.*hero-title-line[^>]*>交易<\/span>.*hero-title-line[^>]*>AI 应用<\/span>/s,
  );
  assert.match(
    html,
    /记录产业研究、交易实践与 AI 应用。/,
  );
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
    new URL('../dist/blog/china-refining-capital-cycle/index.html', import.meta.url),
    'utf8',
  );
  const titlePosition = html.indexOf('从“有没有油”到“炼多少才赚钱”');
  const imagePosition = html.indexOf('/media/china-refining-capital-cycle/');
  const thesisPosition = html.indexOf('THESIS / 核心判断');
  const metadataPosition = html.indexOf('ARTICLE INFORMATION');

  assert.ok(titlePosition >= 0);
  assert.ok(imagePosition > titlePosition);
  assert.ok(thesisPosition > imagePosition);
  assert.ok(metadataPosition > imagePosition);
});

test('article lists omit redundant publication-state labels and tag chips', () => {
  const html = readFileSync(new URL('../dist/investment/index.html', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /class="entry-tag"/);
  assert.doesNotMatch(html, />发布</);
  assert.doesNotMatch(html, />更新</);
});
