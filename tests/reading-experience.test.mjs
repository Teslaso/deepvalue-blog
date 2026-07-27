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
