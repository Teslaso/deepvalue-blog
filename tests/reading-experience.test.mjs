import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test, before } from 'node:test';

const repositoryRoot = new URL('../', import.meta.url);

before(() => {
  execFileSync('npm', ['run', 'build'], {
    cwd: repositoryRoot,
    stdio: 'pipe',
  });
});

test('homepage proceeds from the hero to the article list without a featured-research module', () => {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /FEATURED RESEARCH|重点研究|Published research/);
  assert.match(html, /INVESTMENT RESEARCH/);
});

test('homepage presents three distinct practices and the approved introduction', () => {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

  assert.match(
    html,
    /hero-title-line[^>]*>产业研究<\/span>.*hero-title-line[^>]*>交易<\/span>.*hero-title-line[^>]*>AI 应用<\/span>/s,
  );
  assert.match(
    html,
    /关注周期行业与商品期货，记录产业研究、交易实践，以及 AI 对研究方法与日常生活的改变。/,
  );
});

test('public navigation and homepage omit dormant journal, boundary, and editorial-method surfaces', () => {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /href="\/research-log\/"/);
  assert.doesNotMatch(html, /href="\/beyond\/"/);
  assert.doesNotMatch(html, /RESEARCH LOG|研究日志/);
  assert.doesNotMatch(html, /BEYOND THE BOUNDARY|边界之外/);
  assert.doesNotMatch(html, /Editorial method|把判断放回证据/);
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
