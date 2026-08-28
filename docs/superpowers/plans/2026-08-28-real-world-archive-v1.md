# MX / Real World Archive V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有个人博客重构为“一个现实世界观察者的私人档案馆”，完成 HOME、ARCHIVE、ARTICLE、FIELD、LAB、MACHINES、ABOUT 七个 V1 页面，并保留现有文章发布链路与永久链接。

**Architecture:** 继续使用 Astro 静态站点与现有 `entries` collection，不移动已经发布的文章，也不改变 `/blog/[slug]/` 永久链接。新增统一的 Archive 展示适配层，以及独立的 `field`、`lab`、`machines` 内容集合；首页只负责组合各集合的精选内容。视觉层拆成 Reality / Field 与 System / Archive 两套主题，但共享同一套字体、间距、可访问性和 SEO 基础设施。

**Tech Stack:** Astro 6、TypeScript、Astro Content Collections、Markdown/MDX、Astro Image、少量原生 JavaScript、CSS Variables、Node test runner。

**Spec:** `/Users/matt/.codex/attachments/8ff51f20-7b7c-45af-896b-127a09bcd342/pasted-text.txt`（《MX / REAL WORLD ARCHIVE 个人研究网站设计与开发规范 V1.0》）

## Global Constraints

- 品牌名称固定为 `MX / REAL WORLD ARCHIVE`，短标识使用 `MX` 或 `MX ARCHIVE`。
- 首页主文案固定为 `Researching things that exist outside the screen.`。
- 视觉冲突固定为 `Cold Digital Interface × Physical Reality`。
- Reality / Field 使用真实摄影、米白纸张、Serif；System / Archive 使用黑灰底、细线框、Monospace。
- 主色固定为 `#0B0C0D`、`#131517`、`#EEEAE1`、`#F6F3EC`、`#111111`、`#797979`，唯一主强调色为 `#FF5A36`；状态绿 `#8CE99A` 只用于状态点。
- 导航固定为 `ARCHIVE / FIELD / LAB / MACHINES / ABOUT`；移动端固定为 `MX / MENU`。
- 动效遵循 `90% Still / 10% Motion`；不使用 glitch、粒子、自定义光标、滚动劫持、背景音乐、WebGL 或动画库。
- V1 不加入 CMS、账号、评论、点赞、登录、实时行情、数据库、Newsletter、3D 或复杂后台。
- 所有真实摄影必须保留 `credit` 与 `sourceUrl`；未知地点与拍摄日期保持空值，禁止编造坐标。
- LAB 中的 AI 图片必须标记 `SYNTHETIC IMAGE`；FIELD 不得使用 AI 图片冒充真实记录。
- 首页首屏只加载被选中的 Hero、字体和必要导航；其他图片区块必须 lazy load。
- 所有图片必须有 alt，所有交互必须可键盘操作，所有非必要动画必须响应 `prefers-reduced-motion`。
- 现有 Obsidian Publisher、Writing Studio、6 篇已发布文章及 `/blog/[slug]/` URL 必须保持兼容。
- 实现过程中只提交本计划涉及的文件；当前工作区已有未提交改动，执行时使用独立 `codex/real-world-archive-v1` worktree 或先由用户确认基线。

## Current Baseline and Asset Decisions

### Existing content

- 已发布文章：6 篇，继续由 `src/content/entries/*.md` 管理。
- Machines 候选：`AI分析公司公号`、`CTA期货策略`、`商品期货主观基本面交易研究系统`。
- FIELD：当前没有可确认属于用户本人的现场照片与文字，V1 显示诚实空状态。
- LAB：当前没有 AI 图片素材，V1 显示诚实空状态，不拿图库图片填充。
- About：只使用规范中已经批准的定位文案，不虚构履历、机构、地点或研究经历。

### Hero source allocation

| Standardized id | Source file | Use | Credit | Source URL |
|---|---|---|---|---|
| `quarry-scale` | `lu-a8SSS6o-yZI-unsplash.jpg` | 默认 Hero；人与采石场形成尺度对比 | Lu | `https://unsplash.com/photos/a8SSS6o-yZI` |
| `open-pit-haul` | `miningwatch-portugal-YG0qc-e6hgg-unsplash.jpg` | 轮换 Hero；露天矿与矿卡 | MiningWatch Portugal | `https://unsplash.com/photos/YG0qc-e6hgg` |
| `harvest-grid` | `bence-balla-schottner-b1FS5jQrsLo-unsplash.jpg` | 轮换 Hero；农业与机器 | Bence Balla-Schottner | `https://unsplash.com/photos/b1FS5jQrsLo` |
| `excavator-rock` | `team-kiesel-RzwixD6C67s-unsplash.jpg` | 轮换 Hero；工程机械 | Team Kiesel | `https://unsplash.com/photos/RzwixD6C67s` |
| `refinery-silhouette` | `danny-burke-NShzzEoljvY-unsplash.jpg` | 轮换 Hero；炼化设施 | Danny Burke | `https://unsplash.com/photos/NShzzEoljvY` |
| `tanker-aerial` | `shaah-shahidh--subrrYxv8A-unsplash.jpg` | 轮换 Hero；油轮与海面 | Shaah Shahidh | `https://unsplash.com/photos/-subrrYxv8A` |

所有源图均为 JPEG、宽 2400px。默认 Hero 使用 `quarry-scale`，因为它最准确地表达“人类尺度 × 巨型现实设施”。方形的 `harvest-grid` 需要独立的 desktop/mobile `object-position`，不能直接套用其他图片的裁切值。

## Target File Map

### Shared foundation

- Create: `tests/helpers/site-build.mjs` — 为所有新页面测试提供 `source()` 与单进程缓存的 `built()`。
- Create: `src/styles/archive-tokens.css` — 唯一设计 token 来源。
- Create: `src/styles/archive-global.css` — Reset、排版、焦点、全局容器、Reality/System surface。
- Modify: `src/layouts/Base.astro` — SEO head、主导航、移动菜单、页脚与页面 mode。
- Create: `src/components/system/ArchiveHeader.astro` — 桌面导航和移动 `details` 菜单。
- Create: `src/components/system/SystemLabel.astro` — 编号、时间、状态等一致的元数据标签。

### Content and data

- Modify: `src/content.config.ts` — 扩展文章字段并新增 `field`、`lab`、`machines` collections。
- Create: `src/lib/archive-model.mjs` — 统一文章展示模型、分类映射、统计与阅读时长。
- Create: `src/data/hero-images.ts` — Hero 图片 registry 与 credit。
- Create: `src/data/site.ts` — 站点名称、生产域名、社交链接与固定文案。
- Modify: `publisher/lib/frontmatter.mjs`, `publisher/lib/validate.mjs`, `publisher/lib/render-entry.mjs`, `publisher/lib/studio-frontmatter.mjs` — 新字段往返保存且不破坏旧笔记。

### Homepage

- Create: `src/components/home/CinematicHero.astro`。
- Create: `src/components/home/SystemTransition.astro`。
- Create: `src/components/home/LatestObservations.astro`。
- Create: `src/components/home/FieldNotePreview.astro`。
- Create: `src/components/home/SyntheticArchivePreview.astro`。
- Create: `src/components/home/MachinesPreview.astro`。
- Rewrite: `src/pages/index.astro`。

### Section and detail pages

- Rewrite: `src/pages/archive/index.astro`。
- Keep and rewrite: `src/pages/blog/[slug].astro` — 保留永久链接。
- Create: `src/layouts/ArticleLayout.astro`, `src/layouts/FieldLayout.astro`, `src/layouts/LabLayout.astro`。
- Create: `src/pages/field/index.astro`, `src/pages/field/[slug].astro`。
- Create: `src/pages/lab/index.astro`, `src/pages/lab/[slug].astro`。
- Create: `src/pages/machines/index.astro`。
- Rewrite: `src/pages/about/index.astro`。
- Convert: `src/pages/blog/index.astro` 为 `/archive/` 的兼容跳转页面，生产环境同时添加 301 redirect。
- Convert: `src/pages/projects/index.astro` 为 `/machines/` 的兼容跳转页面，生产环境同时添加 301 redirect。

### Article primitives

- Create: `src/components/article/FieldImage.astro`。
- Create: `src/components/article/Observation.astro`。
- Create: `src/components/article/DataBlock.astro`。
- Create: `src/components/article/Quote.astro`。
- Create: `src/components/article/Timeline.astro`。
- Create: `src/components/article/Map.astro` — 静态地图/图片容器，不接地图 SDK。
- Create: `src/components/article/Interactive.astro` — 有标题与 fallback 的 island 容器。
- Create: `src/components/article/ArchiveReference.astro`。
- Create: `src/components/article/PhotoGrid.astro`。
- Create: `src/components/article/mdx-components.ts` — MDX 组件白名单。

### Test convention

Every new `.test.mjs` file imports `test` from `node:test`, `assert` from `node:assert/strict`, and the required `source`/`built` helpers from `./helpers/site-build.mjs`. Focused commands run one build-producing test file at a time; the final suite always uses `--test-concurrency=1` to avoid the repository's known Astro/Vite cache race.

---

### Task 1: Freeze the New Brand Contract and Shared Shell

**Files:**
- Create: `tests/helpers/site-build.mjs`
- Create: `tests/real-world-archive-contract.test.mjs`
- Create: `src/styles/archive-tokens.css`
- Create: `src/styles/archive-global.css`
- Create: `src/data/site.ts`
- Create: `src/components/system/ArchiveHeader.astro`
- Create: `src/components/system/SystemLabel.astro`
- Modify: `src/layouts/Base.astro`

**Interfaces:**
- Produces: `source(relativePath): Promise<string>` and `built(relativePath): Promise<string>` from `tests/helpers/site-build.mjs`.
- Produces: `SITE`, `NAV_ITEMS`, `SOCIAL_LINKS` constants from `src/data/site.ts`.
- Produces: `<Base title description image mode>` where `mode` is `'reality' | 'system' | 'paper'`.
- Produces: `<ArchiveHeader homeOverlay={boolean}>`.

- [ ] **Step 1: Add the shared source/build test helper**

```js
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
let hasBuilt = false;

export function source(relativePath) {
  return readFile(new URL(relativePath, root), 'utf8');
}

export async function built(relativePath) {
  if (!hasBuilt) {
    execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });
    hasBuilt = true;
  }
  return readFile(new URL(`dist/${relativePath}`, root), 'utf8');
}
```

- [ ] **Step 2: Write the failing shell contract test**

```js
import { source } from './helpers/site-build.mjs';

test('shared shell exposes the MX archive identity and only five primary destinations', async () => {
  const layout = await source('src/layouts/Base.astro');
  const site = await source('src/data/site.ts');
  assert.match(site, /MX \/ REAL WORLD ARCHIVE/);
  for (const route of ['/archive/', '/field/', '/lab/', '/machines/', '/about/']) {
    assert.match(site, new RegExp(route.replaceAll('/', '\\/')));
  }
  assert.doesNotMatch(layout, /Deep Value|color-teal|color-coral/);
});
```

- [ ] **Step 3: Run the test and verify it fails on the current Deep Value shell**

Run: `node --test tests/real-world-archive-contract.test.mjs`

Expected: FAIL because `src/data/site.ts` does not exist and `Base.astro` still exposes the previous identity.

- [ ] **Step 4: Add the exact design tokens and stable site metadata**

```css
:root {
  --system-black: #0b0c0d;
  --system-dark: #131517;
  --paper: #eeeae1;
  --paper-light: #f6f3ec;
  --text-black: #111111;
  --text-gray: #797979;
  --industrial-orange: #ff5a36;
  --status-green: #8ce99a;
  --font-editorial: "Songti SC", "STSong", "Noto Serif CJK SC", Georgia, serif;
  --font-system: "Space Mono", "SFMono-Regular", Consolas, monospace;
}
```

```ts
export const SITE = {
  name: 'MX / REAL WORLD ARCHIVE',
  shortName: 'MX',
  url: 'https://depuyliu.com',
  slogan: 'Researching things that exist outside the screen.',
  description: 'A private archive of research, field observations, synthetic images, and small machines.',
};

export const NAV_ITEMS = [
  { href: '/archive/', label: 'ARCHIVE' },
  { href: '/field/', label: 'FIELD' },
  { href: '/lab/', label: 'LAB' },
  { href: '/machines/', label: 'MACHINES' },
  { href: '/about/', label: 'ABOUT' },
];
```

- [ ] **Step 5: Move global CSS out of `Base.astro` and implement the shared header**

`ArchiveHeader.astro` must use a normal `<nav>` on desktop and a native `<details>` menu on mobile. Each link has a 44px minimum target, active state uses the orange rule, and the mobile summary text is exactly `MENU`.

- [ ] **Step 6: Run shell tests and the existing build**

Run: `node --test tests/real-world-archive-contract.test.mjs tests/editorial-contracts.test.mjs`

Run: `npm run build`

Expected: PASS; existing pages render under the new shell even before their page-specific redesign.

- [ ] **Step 7: Commit the foundation**

```bash
git add tests/helpers/site-build.mjs tests/real-world-archive-contract.test.mjs src/styles/archive-tokens.css src/styles/archive-global.css src/data/site.ts src/components/system/ArchiveHeader.astro src/components/system/SystemLabel.astro src/layouts/Base.astro
git commit -m "feat: establish MX archive design foundation"
```

### Task 2: Extend Content Models Without Breaking Publisher Compatibility

**Files:**
- Create: `tests/archive-content-model.test.mjs`
- Modify: `src/content.config.ts`
- Create: `src/lib/archive-model.mjs`
- Modify: `publisher/lib/frontmatter.mjs`
- Modify: `publisher/lib/validate.mjs`
- Modify: `publisher/lib/render-entry.mjs`
- Modify: `publisher/lib/studio-frontmatter.mjs`
- Modify: `tests/publisher-core.test.mjs`
- Modify: `tests/studio-frontmatter.test.mjs`

**Interfaces:**
- Adds optional entry fields: `subtitle`, `document_type`, `object_label`, `research_status`, `hero`, `hero_alt`, `hero_position`, `reading_minutes`, `location`, `related`, `featured`.
- Produces: `toArchiveDocument(entry)`, `archiveCategory(entry)`, `computeReadingMinutes(body)`, `archiveStats(entries, fieldLogs, labs, machines)`.
- Keeps current `status: draft | published | archived` as publication state; research progress uses `research_status` so the two meanings cannot collide.

- [ ] **Step 1: Write failing schema and publisher round-trip tests**

```js
test('archive metadata survives publisher normalization and render', () => {
  const input = normalizeFrontmatter({
    publish: true,
    domain: 'beyond',
    format: 'article',
    title: 'Sample',
    summary: 'Summary',
    section: 'people',
    document_type: 'profile',
    object_label: 'People',
    research_status: 'completed',
    reading_minutes: 12,
    featured: true,
    related: ['field-research-investment-method'],
  });
  assert.equal(input.document_type, 'profile');
  assert.equal(input.reading_minutes, 12);
  assert.deepEqual(input.related, ['field-research-investment-method']);
});
```

- [ ] **Step 2: Run focused tests and verify the new fields are currently dropped**

Run: `node --test tests/archive-content-model.test.mjs tests/publisher-core.test.mjs tests/studio-frontmatter.test.mjs`

Expected: FAIL on missing normalized fields and schema definitions.

- [ ] **Step 3: Add the exact entry metadata schema**

```ts
const documentType = z.enum(['research-essay', 'research-note', 'profile', 'reading-note', 'field-essay', 'tool-note']);
const researchStatus = z.enum(['completed', 'developing', 'ongoing']);

subtitle: z.string().optional(),
document_type: documentType.optional(),
object_label: z.string().optional(),
research_status: researchStatus.default('completed'),
hero: z.string().optional(),
hero_alt: z.string().optional(),
hero_position: z.object({ desktop: z.string(), mobile: z.string() }).optional(),
reading_minutes: z.number().int().positive().optional(),
location: z.string().optional(),
related: z.array(z.string()).default([]),
featured: z.boolean().default(false),
```

- [ ] **Step 4: Add independent `field`, `lab`, and `machines` schemas**

`field` requires `title`, `date`, `location`, `category`, `image`, `alt`, `credit`, `status` and optional `sourceUrl`/body; user-owned photos can credit `MX` without inventing an external URL. `lab` requires `title`, `date`, `medium`, `images`, `status`, `synthetic: true`. `machines` requires `title`, `description`, `problem`, `status`, `built`, `tech` and optional `github`, `demo`, `screenshot`.

- [ ] **Step 5: Extend Publisher and Studio known-field lists**

String fields are trimmed; `related` remains a string array; `reading_minutes` remains a positive integer; `featured` remains a boolean; `hero_position` remains a two-key object. Validation must reject a non-boolean `featured`, non-integer reading time, unknown research status, or a related ID containing whitespace.

- [ ] **Step 6: Implement the display adapter without rewriting old frontmatter**

```js
export function toArchiveDocument(entry) {
  return {
    id: entry.data.publish_id,
    href: `/blog/${entry.id}/`,
    title: entry.data.title,
    summary: entry.data.summary ?? '',
    object: entry.data.object_label ?? entry.data.topic ?? 'Observation',
    type: entry.data.document_type ?? (entry.data.format === 'log' ? 'research-note' : 'research-essay'),
    researchStatus: entry.data.research_status ?? 'completed',
    publishedAt: entry.data.published_at,
    readingMinutes: entry.data.reading_minutes,
    hero: entry.data.hero,
  };
}
```

- [ ] **Step 7: Run content, Publisher, and Studio tests**

Run: `node --test tests/archive-content-model.test.mjs tests/publisher-core.test.mjs tests/studio-frontmatter.test.mjs`

Expected: PASS, including old-note fixtures that contain none of the new fields.

- [ ] **Step 8: Commit the compatible schema extension**

```bash
git add src/content.config.ts src/lib/archive-model.mjs publisher/lib/frontmatter.mjs publisher/lib/validate.mjs publisher/lib/render-entry.mjs publisher/lib/studio-frontmatter.mjs tests/archive-content-model.test.mjs tests/publisher-core.test.mjs tests/studio-frontmatter.test.mjs
git commit -m "feat: add real world archive content models"
```

### Task 3: Import, Credit, and Optimize the Six Hero Photographs

**Files:**
- Create: `tests/hero-images.test.mjs`
- Create: `src/assets/hero/quarry-scale.jpg`
- Create: `src/assets/hero/open-pit-haul.jpg`
- Create: `src/assets/hero/harvest-grid.jpg`
- Create: `src/assets/hero/excavator-rock.jpg`
- Create: `src/assets/hero/refinery-silhouette.jpg`
- Create: `src/assets/hero/tanker-aerial.jpg`
- Create: `src/data/hero-images.ts`

**Interfaces:**
- Produces: `HeroImage` and `HERO_IMAGES`.
- `HeroImage` contains `id`, `src`, `title`, `credit`, `sourceUrl`, `alt`, `acquiredAt`, nullable `location`/`capturedAt`, and desktop/mobile object positions.

- [ ] **Step 1: Write the failing registry test**

```js
test('hero registry contains six credited real photographs', async () => {
  const source = await readFile(new URL('../src/data/hero-images.ts', import.meta.url), 'utf8');
  assert.equal([...source.matchAll(/sourceUrl:/g)].length, 6);
  assert.equal([...source.matchAll(/alt:/g)].length, 6);
  assert.match(source, /location: null/);
  assert.doesNotMatch(source, /SYNTHETIC IMAGE/);
});
```

- [ ] **Step 2: Run the test and verify it fails because the registry does not exist**

Run: `node --test tests/hero-images.test.mjs`

- [ ] **Step 3: Copy the six exact source files using standardized names**

Copy only from `/Users/matt/Documents/blog-pic/`; preserve source JPEG bytes. Do not edit or delete the originals. Add the six sources to `src/assets/hero/` so Astro owns responsive derivative generation.

- [ ] **Step 4: Create the typed registry with honest metadata**

```ts
export interface HeroImage {
  id: string;
  src: ImageMetadata;
  title: string;
  credit: string;
  sourceUrl: string;
  alt: string;
  acquiredAt: '2026.08';
  location: string | null;
  capturedAt: string | null;
  objectPosition: { desktop: string; mobile: string };
}
```

Set all unknown `location` and `capturedAt` values to `null`. The UI displays `SOURCE / UNSPLASH` and `ACQUIRED / 2026.08` when coordinates or capture date are absent.

- [ ] **Step 5: Run registry tests and verify dimensions**

Run: `node --test tests/hero-images.test.mjs`

Run: `for f in src/assets/hero/*.jpg; do sips -g pixelWidth -g pixelHeight "$f"; done`

Expected: six files, each exactly 2400px wide.

- [ ] **Step 6: Commit the source asset registry**

```bash
git add tests/hero-images.test.mjs src/assets/hero src/data/hero-images.ts
git commit -m "feat: add credited real-world hero archive"
```

### Task 4: Build the Cinematic Opening and Hero-to-System Transition

**Files:**
- Create: `tests/home-hero.test.mjs`
- Create: `src/components/home/CinematicHero.astro`
- Create: `src/components/home/SystemTransition.astro`
- Rewrite: `src/pages/index.astro`

**Interfaces:**
- `<CinematicHero images={HERO_IMAGES}>` generates optimized URLs and chooses one image per browser session under key `mx-real-world-hero`.
- `<SystemTransition stats lastUpdated>` renders computed archive status; it never accepts hand-written counts.

- [ ] **Step 1: Write failing HTML contract tests**

```js
test('home opens with a full-height real photograph and no article list', async () => {
  const home = await source('src/pages/index.astro');
  const hero = await source('src/components/home/CinematicHero.astro');
  assert.match(home, /<CinematicHero/);
  assert.match(hero, /Researching things that exist outside the screen\./);
  assert.match(hero, /sessionStorage/);
  assert.match(hero, /fetchpriority="high"/);
  assert.doesNotMatch(home, /VisualModule|module-grid|WRITING \/ 写作/);
});
```

- [ ] **Step 2: Run the test and verify the current two-column homepage fails**

Run: `node --test tests/home-hero.test.mjs`

- [ ] **Step 3: Generate responsive hero derivatives at build time**

Use Astro `getImage()` for widths `640`, `960`, `1280`, `1920`, and `2400`, with AVIF as primary and WebP as fallback. Serialize only derivative URLs and metadata into the page; do not serialize source image bytes.

- [ ] **Step 4: Implement session-stable selection with a no-JS fallback**

The inline script reads `mx-real-world-hero`; if absent, it selects one index with `crypto.getRandomValues`, stores the id, then assigns only that image's `srcset`. `<noscript>` renders `quarry-scale`. Width and height attributes reserve the correct viewport area before the selected image arrives.

- [ ] **Step 5: Implement restrained motion and scroll transition**

Hero image moves from scale `1` to `1.035` over 10 seconds. A small `requestAnimationFrame` scroll handler sets `--hero-progress` from `0` to `1` over the first viewport; the black overlay uses that value. The handler is passive, never modifies scroll position, and is disabled when reduced motion is requested.

- [ ] **Step 6: Render exact Hero metadata and affordance**

Left: `MX / FIELD ARCHIVE`. Center/lower: slogan and `Companies / Machines / Commodities / People`. Right: verified coordinate/date when present, otherwise `SOURCE / UNSPLASH` and `ACQUIRED / 2026.08`. Bottom right: `ENTER ARCHIVE ↓` linking to `#system-status`.

- [ ] **Step 7: Build and run the Hero tests**

Run: `node --test tests/home-hero.test.mjs`

Run: `npm run build`

Expected: PASS; `dist/index.html` contains the no-JS default, the session selector, fixed dimensions, and the System transition anchor.

- [ ] **Step 8: Commit the opening sequence**

```bash
git add tests/home-hero.test.mjs src/components/home/CinematicHero.astro src/components/home/SystemTransition.astro src/pages/index.astro
git commit -m "feat: add cinematic reality to system opening"
```

### Task 5: Build System Status and Latest Observations from Real Content

**Files:**
- Create: `tests/home-archive-sections.test.mjs`
- Create: `src/components/archive/ArchiveList.astro`
- Create: `src/components/home/LatestObservations.astro`
- Modify: `src/components/home/SystemTransition.astro`
- Modify: `src/pages/index.astro`
- Deprecate from homepage: `src/components/EntryList.astro`, `src/components/VisualModule.astro`, `src/components/CornerSketch.astro`

**Interfaces:**
- `<ArchiveList documents limit showPreview>` receives `ArchiveDocument[]` sorted by publication date.
- `archiveStats()` returns `{ articles, notes, fieldLogs, experiments, machines, lastUpdated }`.

- [ ] **Step 1: Write failing computed-count and ordering tests**

```js
test('system status and latest observations are derived from published collections', async () => {
  const html = await built('index.html');
  assert.match(html, /SYSTEM STATUS/);
  assert.match(html, /ARTICLES/);
  assert.match(html, /LATEST OBSERVATIONS/);
  assert.ok(html.indexOf('孙宇晨其人') < html.indexOf('月薪到底是不是一种脆弱性'));
  assert.doesNotMatch(html, /探索路径|视觉实验/);
});
```

- [ ] **Step 2: Run the test and verify the sections are absent**

Run: `node --test tests/home-archive-sections.test.mjs`

- [ ] **Step 3: Implement status as a restrained system readout**

Render live collection counts and the maximum `published_at`/content date. Do not add charts. Optional count-up animates once from zero in 400ms only when reduced motion is not requested; the final value is present in the server HTML.

- [ ] **Step 4: Implement the archive row anatomy**

Each row renders sequence number, rule, object, type, research status, publication date, title, summary, and `OPEN FILE →`. The row uses borders and grid columns, no rounded card, shadow, pill, or tag cloud.

- [ ] **Step 5: Add optional hover preview without inventing images**

Rows with `hero` reveal the real associated image in the preview rail. Rows without `hero` reveal a text-only file sheet. Mobile and coarse-pointer devices never render the hover preview rail.

- [ ] **Step 6: Run tests and build**

Run: `node --test tests/home-archive-sections.test.mjs tests/reading-experience.test.mjs`

Run: `npm run build`

- [ ] **Step 7: Commit the system index**

```bash
git add tests/home-archive-sections.test.mjs src/components/archive/ArchiveList.astro src/components/home/LatestObservations.astro src/components/home/SystemTransition.astro src/pages/index.astro
git commit -m "feat: add live archive status and observations"
```

### Task 6: Replace the Blog Index with the Archive Database View

**Files:**
- Create: `tests/archive-page.test.mjs`
- Rewrite: `src/pages/archive/index.astro`
- Rewrite: `src/pages/blog/index.astro`
- Modify: `vercel.json`
- Modify: `src/lib/archive-model.mjs`

**Interfaces:**
- Query parameter: `/archive/?category=all|industry|investing|people|history|places|thinking`.
- Category mapping is centralized in `archiveCategory(entry)` and never duplicated in page markup.

- [ ] **Step 1: Write failing archive route and category tests**

```js
test('archive renders all six retained documents and exposes seven filters', async () => {
  const retainedTitles = [
    '孙宇晨其人',
    '月薪到底是不是一种脆弱性',
    '反应慢是不是一种劣势',
    'AI Agent 到底是什么',
    '瑞士为什么这么特别',
    '田野调查到底是什么',
  ];
  const html = await built('archive/index.html');
  for (const title of retainedTitles) assert.match(html, new RegExp(title));
  for (const category of ['ALL', 'INDUSTRY', 'INVESTING', 'PEOPLE', 'HISTORY', 'PLACES', 'THINKING']) {
    assert.match(html, new RegExp(category));
  }
});
```

- [ ] **Step 2: Run the test and verify the current archive presentation fails**

Run: `node --test tests/archive-page.test.mjs`

- [ ] **Step 3: Implement the database-style Archive header and list**

Header displays real document count and real year range. Filters are normal links so the index works without client JavaScript. Rows use the shared `ArchiveList`; desktop preview is optional and mobile remains single-column.

- [ ] **Step 4: Preserve URLs and define compatibility redirects**

`/blog/[slug]/` remains unchanged. `/blog/` renders an immediate accessible link and canonical to `/archive/`; `vercel.json` adds exact 301 `/blog` → `/archive`. Old `/investment/`, `/ai/`, and `/beyond/` routes remain reachable during V1 but receive canonical links to their corresponding Archive filter until a separate deletion decision is approved.

- [ ] **Step 5: Run route and legacy redirect tests**

Run: `node --test tests/archive-page.test.mjs tests/vercel-redirects.test.mjs`

Run: `npm run build`

- [ ] **Step 6: Commit the Archive index**

```bash
git add tests/archive-page.test.mjs src/pages/archive/index.astro src/pages/blog/index.astro src/lib/archive-model.mjs vercel.json tests/vercel-redirects.test.mjs
git commit -m "feat: turn article index into archive database"
```

### Task 7: Rebuild Article Pages and Add the MDX Research Primitives

**Files:**
- Create: `tests/article-archive-layout.test.mjs`
- Create: `src/layouts/ArticleLayout.astro`
- Create: `src/components/article/FieldImage.astro`
- Create: `src/components/article/Observation.astro`
- Create: `src/components/article/DataBlock.astro`
- Create: `src/components/article/Quote.astro`
- Create: `src/components/article/Timeline.astro`
- Create: `src/components/article/Map.astro`
- Create: `src/components/article/Interactive.astro`
- Create: `src/components/article/ArchiveReference.astro`
- Create: `src/components/article/PhotoGrid.astro`
- Create: `src/components/article/mdx-components.ts`
- Modify: `src/pages/blog/[slug].astro`
- Modify: `src/content.config.ts`
- Modify: `astro.config.mjs`
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- `<ArticleLayout entry document><slot /></ArticleLayout>`.
- MDX component registry exports exact names: `FieldImage`, `Observation`, `DataBlock`, `Quote`, `Timeline`, `Map`, `Interactive`, `ArchiveReference`, `PhotoGrid`.
- `Interactive` requires `title` and `fallback`; it never mounts JavaScript by itself.

- [ ] **Step 1: Write failing article hierarchy and MDX registry tests**

```js
test('article detail starts with archive metadata and keeps a readable paper body', async () => {
  const html = await built('blog/field-research-investment-method/index.html');
  assert.match(html, /ARCHIVE FILE/);
  assert.match(html, /RESEARCH METHODS/);
  assert.match(html, /class="article-paper"/);
  assert.match(html, /class="article-prose"/);
});
```

- [ ] **Step 2: Install the official Astro MDX integration**

Run: `npm install @astrojs/mdx`

Modify `astro.config.mjs` to use `integrations: [react(), mdx()]`, and change the entries glob to accept both `.md` and `.mdx`.

- [ ] **Step 3: Implement ArticleLayout with optional Hero**

When `hero` exists, render a responsive full-width image and archive metadata above the paper body. When it does not, render the same metadata on the black system surface without an empty image frame. Article prose remains `680–760px` wide.

- [ ] **Step 4: Implement nine static, accessible research primitives**

Each component uses semantic HTML, square borders, captions, and slots. `Map` is a figure accepting a static image; `Interactive` is an accessible boundary for a future island; `ArchiveReference` resolves only explicit archive IDs and shows a broken-reference message in development if the id is absent.

- [ ] **Step 5: Pass the MDX whitelist into rendered content**

```astro
<Content components={mdxComponents} />
```

Existing Markdown articles continue rendering without changes.

- [ ] **Step 6: Run article, content, and full build tests**

Run: `node --test tests/article-archive-layout.test.mjs tests/reading-experience.test.mjs tests/publisher-transform.test.mjs`

Run: `npm run build`

- [ ] **Step 7: Commit the article system**

```bash
git add tests/article-archive-layout.test.mjs src/layouts/ArticleLayout.astro src/components/article src/pages/blog/'[slug]'.astro src/content.config.ts astro.config.mjs package.json package-lock.json
git commit -m "feat: add archive article layout and research primitives"
```

### Task 8: Add FIELD as an Honest Reality Archive

**Files:**
- Create: `tests/field-pages.test.mjs`
- Create: `src/content/field/.gitkeep`
- Create: `src/layouts/FieldLayout.astro`
- Create: `src/pages/field/index.astro`
- Create: `src/pages/field/[slug].astro`
- Create: `src/components/home/FieldNotePreview.astro`
- Modify: `src/pages/index.astro`

**Interfaces:**
- Field index consumes only the `field` collection.
- Homepage preview receives the newest published field entry or `null`.

- [ ] **Step 1: Write failing empty-state and source-integrity tests**

```js
test('field distinguishes personal documented reality from licensed hero photography', async () => {
  const html = await built('field/index.html');
  assert.match(html, /FIELD LOG/);
  assert.match(html, /No field logs published yet\./);
  assert.doesNotMatch(html, /SYNTHETIC IMAGE/);
});
```

- [ ] **Step 2: Run the test and verify `/field/` is missing**

Run: `node --test tests/field-pages.test.mjs`

- [ ] **Step 3: Implement FIELD index and detail layouts**

Index rows show number, location, category, date, and one documentary image. Detail pages emphasize one large photo and brief text. Every image renders `credit` and source link. The collection contains no fabricated first entry.

- [ ] **Step 4: Implement the homepage paper-mode empty state**

Exact copy: `FIELD NOTE / No personal field record has been published yet.` The section still performs the black-to-paper visual transition, but contains no stock photo or invented observation.

- [ ] **Step 5: Run tests and build**

Run: `node --test tests/field-pages.test.mjs`

Run: `npm run build`

- [ ] **Step 6: Commit FIELD**

```bash
git add tests/field-pages.test.mjs src/content/field/.gitkeep src/layouts/FieldLayout.astro src/pages/field src/components/home/FieldNotePreview.astro src/pages/index.astro
git commit -m "feat: add documented reality field archive"
```

### Task 9: Add LAB with an Explicit Synthetic-Reality Boundary

**Files:**
- Create: `tests/lab-pages.test.mjs`
- Create: `src/content/lab/.gitkeep`
- Create: `src/layouts/LabLayout.astro`
- Create: `src/pages/lab/index.astro`
- Create: `src/pages/lab/[slug].astro`
- Create: `src/components/home/SyntheticArchivePreview.astro`
- Modify: `src/pages/index.astro`

**Interfaces:**
- Every lab entry has `synthetic: true` enforced by schema.
- Every rendered lab image displays `SYNTHETIC IMAGE` adjacent to its caption.

- [ ] **Step 1: Write failing synthetic-label tests**

```js
test('lab never presents synthetic work as field evidence', async () => {
  const html = await built('lab/index.html');
  assert.match(html, /LAB \/ SYNTHETIC ARCHIVE/);
  assert.match(html, /Images that never happened\./);
  assert.match(html, /No synthetic experiments published yet\./);
});
```

- [ ] **Step 2: Run the test and verify `/lab/` is missing**

Run: `node --test tests/lab-pages.test.mjs`

- [ ] **Step 3: Implement black-grid LAB index and image-series detail layout**

Index supports 3–6 image tiles when entries exist. Detail supports image series, prompt notes, process notes, medium, and year. Real Hero photography is never imported into the LAB collection.

- [ ] **Step 4: Implement the homepage LAB empty state**

Exact copy: `SYNTHETIC ARCHIVE / No synthetic experiments published yet.` Keep the empty state compact; do not render fake line-art thumbnails.

- [ ] **Step 5: Run tests and build**

Run: `node --test tests/lab-pages.test.mjs`

Run: `npm run build`

- [ ] **Step 6: Commit LAB**

```bash
git add tests/lab-pages.test.mjs src/content/lab/.gitkeep src/layouts/LabLayout.astro src/pages/lab src/components/home/SyntheticArchivePreview.astro src/pages/index.astro
git commit -m "feat: add labeled synthetic archive lab"
```

### Task 10: Convert Projects into MACHINES

**Files:**
- Create: `tests/machines-page.test.mjs`
- Move: `src/content/projects/AI分析公司公号.md` → `src/content/machines/ai-company-analysis.md`
- Move: `src/content/projects/CTA期货策略.md` → `src/content/machines/cta-futures-strategy.md`
- Move: `src/content/projects/期货分析系统.md` → `src/content/machines/futures-research-system.md`
- Modify: `src/content.config.ts` — remove the superseded `projects` collection after migration.
- Create: `src/pages/machines/index.astro`
- Create: `src/components/home/MachinesPreview.astro`
- Rewrite: `src/pages/projects/index.astro`
- Modify: `vercel.json`

**Interfaces:**
- Machines display fields: `title`, `description`, `problem`, `status`, `built`, `tech`, optional `github`, `demo`, `screenshot`.
- Existing project descriptions are reused; exact `problem` copy explains the real-world problem rather than résumé claims.

- [ ] **Step 1: Write failing machine-count and copy tests**

```js
test('machines presents the three existing tools as thinking instruments', async () => {
  const html = await built('machines/index.html');
  assert.match(html, /Small machines I built to think with\./);
  assert.match(html, /AI分析公司公号/);
  assert.match(html, /CTA期货策略/);
  assert.match(html, /商品期货主观基本面交易研究系统/);
});
```

- [ ] **Step 2: Run the test and verify `/machines/` is missing**

Run: `node --test tests/machines-page.test.mjs`

- [ ] **Step 3: Migrate the three existing project records**

Preserve title, description, status, link, and tech. Add `built: 2026`. Set `problem` to the first concrete problem already described in each project body; do not claim adoption, returns, users, or performance.

- [ ] **Step 4: Implement the MACHINES index and homepage preview**

Use black system surface, thin rules, one restrained terminal-style status line, and external links only when the existing content provides them. Missing GitHub/demo links render `PRIVATE / NO PUBLIC ENDPOINT` rather than dead buttons.

- [ ] **Step 5: Add `/projects` compatibility route**

Create exact 301 `/projects` → `/machines` in `vercel.json`; retain an HTML compatibility page for local static preview.

- [ ] **Step 6: Run tests and build**

Run: `node --test tests/machines-page.test.mjs tests/vercel-redirects.test.mjs`

Run: `npm run build`

- [ ] **Step 7: Commit MACHINES**

```bash
git add tests/machines-page.test.mjs src/content.config.ts src/content/projects/AI分析公司公号.md src/content/projects/CTA期货策略.md src/content/projects/期货分析系统.md src/content/machines/ai-company-analysis.md src/content/machines/cta-futures-strategy.md src/content/machines/futures-research-system.md src/pages/machines/index.astro src/components/home/MachinesPreview.astro src/pages/projects/index.astro src/pages/index.astro vercel.json tests/vercel-redirects.test.mjs
git commit -m "feat: recast projects as thinking machines"
```

### Task 11: Rewrite ABOUT Around Curiosity, Method, and Making

**Files:**
- Create: `tests/about-mx.test.mjs`
- Rewrite: `src/pages/about/index.astro`
- Modify: `src/layouts/Base.astro`
- Remove obsolete use from public pages: `src/lib/i18n.mjs`
- Modify: `tests/i18n.test.mjs`

**Interfaces:**
- About sections are exactly `What I study`, `How I research`, `What I build`, `What I'm curious about`.
- Social links continue to come from `src/data/site.ts`.

- [ ] **Step 1: Write the failing identity test**

```js
test('about describes MX without the old investment-publication positioning', async () => {
  const html = await built('about/index.html');
  assert.match(html, /ABOUT MX/);
  assert.match(html, /I research companies, machines, commodities and people\./);
  assert.doesNotMatch(html, /Deep Value|投资、交易与大宗商品研究为核心/);
});
```

- [ ] **Step 2: Run the test and verify the old positioning fails it**

Run: `node --test tests/about-mx.test.mjs`

- [ ] **Step 3: Implement exact, evidence-safe About copy**

Use the approved opening sentence. Describe study scope as companies, machines, commodities, people, places, and history. Describe method as moving between documents, first-hand observation, and tools. Describe building as small systems that help organize evidence and judgment. Describe curiosity as open-ended and avoid employer, credential, location, or authority claims.

- [ ] **Step 4: Retire dormant translation infrastructure from public markup**

The visible language switcher is already absent. Remove obsolete `data-i18n` markers and dictionaries only after tests prove no runtime consumer remains; do not remove Publisher localization strings.

- [ ] **Step 5: Run About and translation tests**

Run: `node --test tests/about-mx.test.mjs tests/i18n.test.mjs`

Run: `npm run build`

- [ ] **Step 6: Commit About**

```bash
git add tests/about-mx.test.mjs src/pages/about/index.astro src/layouts/Base.astro src/lib/i18n.mjs tests/i18n.test.mjs
git commit -m "feat: rewrite about page for MX archive"
```

### Task 12: Complete Responsive, Motion, and Accessibility Behavior

**Files:**
- Create: `tests/archive-accessibility.test.mjs`
- Modify: `src/styles/archive-global.css`
- Modify: `src/components/system/ArchiveHeader.astro`
- Modify: `src/components/home/CinematicHero.astro`
- Modify: all new index and layout components from Tasks 4–11

**Interfaces:**
- Breakpoints: mobile `< 720px`, compact desktop `720–1099px`, full desktop `>= 1100px`.
- Interactive target minimum: 44px.

- [ ] **Step 1: Write failing static accessibility contracts**

```js
test('archive surfaces expose reduced motion, alt text, landmarks, and mobile menu semantics', async () => {
  const css = await source('src/styles/archive-global.css');
  const header = await source('src/components/system/ArchiveHeader.astro');
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(header, /<nav/);
  assert.match(header, /<details/);
});
```

- [ ] **Step 2: Run the test and record missing contracts**

Run: `node --test tests/archive-accessibility.test.mjs`

- [ ] **Step 3: Implement mobile-specific composition**

Collapse archive metadata to number/date/title, hide hover previews, preserve Hero with independent mobile object positions, and keep article body at full available width with 20px side padding. Do not introduce horizontal scrolling.

- [ ] **Step 4: Implement reduced-motion mode**

Stop Hero zoom, count-up, reveal transforms, image zoom, and scroll-progress updates. Preserve color and opacity changes required for legibility, but set their duration to `0.01ms`.

- [ ] **Step 5: Verify keyboard and screen-reader structure in browser**

Tab through skip link, desktop nav, mobile menu, Archive filters, each file link, external source credits, and footer. Confirm visible focus at each step and a logical heading hierarchy with one H1 per page.

- [ ] **Step 6: Run accessibility tests and build**

Run: `node --test tests/archive-accessibility.test.mjs`

Run: `npm run build`

- [ ] **Step 7: Commit responsive and accessibility behavior**

```bash
git add tests/archive-accessibility.test.mjs src/styles/archive-global.css src/components/system/ArchiveHeader.astro src/components/home/CinematicHero.astro src/components/home/SystemTransition.astro src/components/home/LatestObservations.astro src/components/home/FieldNotePreview.astro src/components/home/SyntheticArchivePreview.astro src/components/home/MachinesPreview.astro src/components/archive/ArchiveList.astro src/layouts/ArticleLayout.astro src/layouts/FieldLayout.astro src/layouts/LabLayout.astro src/pages/index.astro src/pages/archive/index.astro src/pages/blog/'[slug]'.astro src/pages/field/index.astro src/pages/field/'[slug]'.astro src/pages/lab/index.astro src/pages/lab/'[slug]'.astro src/pages/machines/index.astro src/pages/about/index.astro
git commit -m "feat: finish responsive and accessible archive behavior"
```

### Task 13: Add Canonical SEO, Open Graph, Sitemap, RSS, and Robots

**Files:**
- Create: `tests/archive-seo.test.mjs`
- Modify: `astro.config.mjs`
- Modify: `package.json`, `package-lock.json`
- Modify: `src/layouts/Base.astro`
- Create: `src/pages/rss.xml.js`
- Create: `public/robots.txt`
- Modify: article and section pages to pass title, description, image, and type.

**Interfaces:**
- Production site URL: `https://depuyliu.com`.
- `<Base>` computes canonical from `Astro.site` and `Astro.url.pathname`.
- RSS contains published `article` entries only, ordered by immutable `published_at`.

- [ ] **Step 1: Write failing SEO output tests**

```js
test('article output includes canonical, Open Graph, and article metadata', async () => {
  const html = await built('blog/field-research-investment-method/index.html');
  assert.match(html, /rel="canonical" href="https:\/\/depuyliu\.com\/blog\/field-research-investment-method\/"/);
  assert.match(html, /property="og:type" content="article"/);
  assert.match(html, /property="article:published_time"/);
});
```

- [ ] **Step 2: Run the test and verify canonical/OG output is absent**

Run: `node --test tests/archive-seo.test.mjs`

- [ ] **Step 3: Add official Sitemap and RSS support**

Run: `npm install @astrojs/sitemap @astrojs/rss`

Set `site: 'https://depuyliu.com'` and add `sitemap()` to integrations. RSS title is `MX / REAL WORLD ARCHIVE`; description uses the site description; items link to existing `/blog/[slug]/` routes.

- [ ] **Step 4: Add complete Base head metadata**

Include canonical, description, `og:title`, `og:description`, `og:url`, `og:type`, optional `og:image`, Twitter summary card, and JSON-LD `BlogPosting` on article pages. Never set an `og:image` to a file that does not exist.

- [ ] **Step 5: Add robots and verify generated endpoints**

`public/robots.txt` allows crawling and points to `https://depuyliu.com/sitemap-index.xml`. Verify `dist/rss.xml`, sitemap output, and canonical URLs after build.

- [ ] **Step 6: Run SEO tests and build**

Run: `node --test tests/archive-seo.test.mjs`

Run: `npm run build`

- [ ] **Step 7: Commit SEO infrastructure**

```bash
git add tests/archive-seo.test.mjs astro.config.mjs package.json package-lock.json src/layouts/Base.astro src/pages/rss.xml.js public/robots.txt src/pages/index.astro src/pages/archive/index.astro src/pages/blog/'[slug]'.astro src/pages/field/index.astro src/pages/field/'[slug]'.astro src/pages/lab/index.astro src/pages/lab/'[slug]'.astro src/pages/machines/index.astro src/pages/about/index.astro src/layouts/ArticleLayout.astro src/layouts/FieldLayout.astro src/layouts/LabLayout.astro
git commit -m "feat: add archive seo and feeds"
```

### Task 14: Performance, Visual QA, Regression Suite, and Release

**Files:**
- Create: `tests/home-performance-contract.test.mjs`
- Modify only files with verified failures from this task.
- Update: `README.md` with content directories, image credit requirements, and local commands.

**Interfaces:**
- No new runtime dependency beyond official Astro MDX, Sitemap, and RSS integrations.
- Home LCP asset is the selected Hero; all section imagery below the fold uses `loading="lazy"`.

- [ ] **Step 1: Write the homepage loading contract**

```js
test('home eagerly loads only the selected hero and lazily loads lower imagery', async () => {
  const html = await built('index.html');
  assert.equal((html.match(/fetchpriority="high"/g) ?? []).length, 1);
  assert.match(html, /loading="lazy"/);
  assert.doesNotMatch(html, /gsap|three\.js|webgl/iu);
});
```

- [ ] **Step 2: Run the complete test suite in single-concurrency mode**

Run: `node --test --test-concurrency=1 tests/*.test.mjs`

Expected: all existing Publisher, Studio, content, route, accessibility, and new archive tests pass.

- [ ] **Step 3: Run a clean production build**

Run: `npm run build`

Expected: HOME, ARCHIVE, six ARTICLE pages, FIELD, LAB, MACHINES, ABOUT, RSS, robots, and sitemap build successfully.

- [ ] **Step 4: Perform desktop visual QA at 1440×1000**

Check Hero crop for all six session ids, Hero-to-System transition, Latest Observations preview behavior, Reality/System surface changes, Archive filter states, article measure, FIELD/LAB empty states, Machines links, and About hierarchy.

- [ ] **Step 5: Perform mobile visual QA at 390×844**

Check `MX / MENU`, no horizontal overflow, Hero subject crop, no hover-only information, 44px targets, article readability, visible source credits, and reduced metadata density.

- [ ] **Step 6: Verify reduced motion and keyboard operation**

Enable reduced motion, reload, and confirm Hero scale/count/reveal motion stops. Navigate the complete site with keyboard and verify focus visibility and menu closure behavior.

- [ ] **Step 7: Inspect network requests on first load**

Confirm only one Hero image family is requested before scrolling. Confirm LAB, FIELD, Machines screenshots, and article preview images are not requested until near the viewport. Confirm no 404 fonts, images, JS chunks, canonical URLs, RSS links, or sitemap links.

- [ ] **Step 8: Update documentation and rerun final verification**

Document `src/content/field`, `src/content/lab`, `src/content/machines`, `src/assets/hero`, mandatory credit fields, `npm run dev`, `npm run build`, and single-concurrency test command.

Run: `git diff --check`

Run: `node --test --test-concurrency=1 tests/*.test.mjs`

Run: `npm run build`

- [ ] **Step 9: Commit verified release state**

```bash
git add README.md tests/home-performance-contract.test.mjs
git commit -m "docs: document and verify real world archive v1"
```

- [ ] **Step 10: Review the branch before publishing**

Run: `git status --short`

Run: `git log --oneline --decorate origin/main..HEAD`

Review the exact branch diff. Push only after the user approves the local desktop and mobile previews; then verify the deployment commit equals the pushed commit and check `https://depuyliu.com/`, `/archive/`, one article, `/field/`, `/lab/`, `/machines/`, `/about/`, `/rss.xml`, and the sitemap.

## V1 Acceptance Checklist

- [ ] The first 3 seconds communicate reality, industry, research, archive, personal authorship, and a digital system.
- [ ] The homepage does not look like a generic blog, Portfolio grid, SaaS landing page, or terminal theme.
- [ ] The six supplied photographs are credited, responsive, and session-stable; unknown coordinates are not fabricated.
- [ ] System status and all counts are computed from real collections.
- [ ] Archive shows all six retained articles in immutable publication order.
- [ ] Article URLs remain stable and Publisher/Studio regression suites pass.
- [ ] FIELD and LAB clearly distinguish documented from synthetic reality and use honest empty states until content exists.
- [ ] MACHINES explains real problems rather than presenting a résumé.
- [ ] Desktop, mobile, keyboard, reduced-motion, SEO, image loading, and full production build checks pass.
- [ ] No V2/V3 features or unrelated refactors enter the V1 branch.

## Explicitly Deferred to V2/V3

- Full-text search, backlinks, related-content graph, research map, interactive charts, live data APIs, 3D scenes, fleet/mining simulations, commodity explorer, and account/community features are outside this plan.
- A personal FIELD entry is added only after the user supplies a real photo, location/date boundary, and observation text.
- LAB image entries are added only after the user supplies selected AI works and confirms their titles, labels, and process notes.
