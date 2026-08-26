import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ENGLISH_DESCRIPTIONS,
  ENGLISH_TITLES,
  ENGLISH_TRANSLATIONS,
} from '../src/lib/i18n.mjs';

test('English translations no longer include the removed commodity manifesto', () => {
  for (const key of ['home.manifestoLabel', 'home.manifestoTitle', 'home.manifestoP1', 'home.manifestoP2', 'home.manifestoP3', 'home.manifestoP4']) {
    assert.equal(ENGLISH_TRANSLATIONS[key], undefined);
  }
});

test('Every public page title and description has an English counterpart', () => {
  const titles = [
    'Deep Value Research',
    '投资研究 - Deep Value Research',
    'AI 与技术 - Deep Value Research',
    '档案 - Deep Value Research',
    '关于 - Deep Value Research',
    '项目 - Deep Value Research',
    '研究文章 - Deep Value Research',
    '研究日志 - Deep Value Research',
  ];
  const descriptions = [
    '关注周期行业与商品期货，记录产业研究、交易实践，以及 AI 对研究方法与日常生活的改变。',
    '大宗商品、产业、宏观、市场与交易研究',
    'AI 应用、技术产业与研究工作流探索',
    'Deep Value Research 已发布文章与研究日志的时间档案',
    '关于 Deep Value Research 的定位、研究范围与内容形式',
    '投资分析工具、交易研究系统与 AI 应用项目',
    'Deep Value Research 已发布研究文章索引',
    '跨领域、按时间保留的研究观察与判断更新',
  ];

  for (const title of titles) assert.ok(ENGLISH_TITLES[title], `missing title: ${title}`);
  for (const description of descriptions) {
    assert.ok(ENGLISH_DESCRIPTIONS[description], `missing description: ${description}`);
  }
});

test('Literal translation markers reference dictionary entries', async () => {
  const files = [
    'src/layouts/Base.astro',
    'src/pages/index.astro',
    'src/pages/about/index.astro',
    'src/pages/investment/index.astro',
    'src/pages/ai/index.astro',
    'src/pages/archive/index.astro',
    'src/pages/projects/index.astro',
    'src/pages/beyond/index.astro',
    'src/pages/blog/index.astro',
    'src/pages/research-log/index.astro',
    'src/pages/blog/[slug].astro',
    'src/components/EntryList.astro',
  ];

  for (const file of files) {
    const content = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const match of content.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/gu)) {
      assert.ok(ENGLISH_TRANSLATIONS[match[1]], `missing translation key: ${match[1]} in ${file}`);
    }
  }
});
