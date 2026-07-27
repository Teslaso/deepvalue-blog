# Homepage Positioning and Article Thumbnails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the homepage to present “产业研究、交易与 AI 应用” as its three-part positioning and add automatic first-image previews to the homepage investment article list.

**Architecture:** Add one pure Markdown helper that extracts the first standard image without touching the filesystem. The homepage will map published investment articles to `{ entry, preview }` rows at build time, render an optional linked 4:3 thumbnail, and use responsive CSS to preserve the existing editorial layout. Hero copy remains static and is protected by editorial contract tests.

**Tech Stack:** Astro 6, TypeScript in `.astro` frontmatter, ESM JavaScript helpers, Node.js 22 built-in test runner, CSS Grid.

## Global Constraints

- English eyebrow: `INDUSTRY RESEARCH · TRADING · APPLIED AI`.
- Chinese title: `产业研究、交易与 AI 应用`.
- Introduction: `从大宗商品与周期行业出发，研究产业演化、供需变化与资本周期，同时记录交易方法和 AI 在研究工作流中的实际应用。`
- Hero index: `01 产业研究`, `02 市场与交易`, `03 AI 应用`.
- Remove the old `Investment · Trading · Commodities` wording and the fourth hero index row.
- Show thumbnails only in the homepage investment article list, not in Featured Research or shared entry lists.
- Use only the first standard Markdown image already present in the public article body.
- Articles without a body image must keep a text-only row with no empty image placeholder.
- Desktop thumbnails use a 4:3 ratio at approximately 220–320px wide.
- At 820px and below, the thumbnail moves below the text and fills the article content column.
- Existing `.DS_Store` and `.claude/settings.local.json` modifications must never be staged or committed.

---

## File Structure

- `src/lib/entry-utils.mjs`: Owns the pure `extractLeadImage(markdown)` helper alongside existing entry-selection helpers.
- `tests/entry-utils.test.mjs`: Verifies first-image extraction, fallback behavior, and first-image precedence.
- `src/pages/index.astro`: Owns confirmed hero copy, homepage-only preview row preparation, thumbnail markup, and responsive presentation.
- `tests/editorial-contracts.test.mjs`: Protects the confirmed hero text and homepage thumbnail integration contract.

### Task 1: First-image extraction helper

**Files:**
- Modify: `tests/entry-utils.test.mjs`
- Modify: `src/lib/entry-utils.mjs`

**Interfaces:**
- Consumes: A Markdown body string or a non-string/empty value.
- Produces: `extractLeadImage(markdown): { src: string, alt: string } | undefined`.

- [ ] **Step 1: Write failing helper tests**

Add `extractLeadImage` to the existing import and append:

```js
test('extractLeadImage returns the first standard Markdown image', () => {
  const markdown = [
    '开场文字。',
    '![炼化周期](/media/refining/hero.webp)',
    '![第二张图](/media/refining/chart.webp)',
  ].join('\n\n');

  assert.deepEqual(extractLeadImage(markdown), {
    src: '/media/refining/hero.webp',
    alt: '炼化周期',
  });
});

test('extractLeadImage preserves empty alt text and ignores ordinary links', () => {
  const markdown = [
    '[行业资料](/media/refining/report.pdf)',
    '![](/media/refining/hero.webp)',
  ].join('\n\n');

  assert.deepEqual(extractLeadImage(markdown), {
    src: '/media/refining/hero.webp',
    alt: '',
  });
});

test('extractLeadImage returns undefined when no standard image exists', () => {
  assert.equal(extractLeadImage('只有正文和[普通链接](/about/)。'), undefined);
  assert.equal(extractLeadImage(''), undefined);
  assert.equal(extractLeadImage(undefined), undefined);
});
```

- [ ] **Step 2: Run the helper tests and verify RED**

Run:

```bash
node --test tests/entry-utils.test.mjs
```

Expected: FAIL because `extractLeadImage` is not exported by `src/lib/entry-utils.mjs`.

- [ ] **Step 3: Add the minimal pure helper**

Append to `src/lib/entry-utils.mjs`:

```js
export function extractLeadImage(markdown) {
  if (typeof markdown !== 'string' || markdown === '') return undefined;

  const match = markdown.match(/!\[([^\]]*)\]\(\s*(<?[^)\s>]+>?)\s*\)/u);
  if (!match) return undefined;

  return {
    alt: match[1],
    src: match[2].replace(/^<|>$/gu, ''),
  };
}
```

- [ ] **Step 4: Run the helper tests and verify GREEN**

Run:

```bash
node --test tests/entry-utils.test.mjs
```

Expected: all tests in `tests/entry-utils.test.mjs` PASS with zero failures.

- [ ] **Step 5: Commit the helper**

```bash
git add src/lib/entry-utils.mjs tests/entry-utils.test.mjs
git commit -m "feat: extract article lead images"
```

### Task 2: Confirmed homepage positioning copy

**Files:**
- Modify: `tests/editorial-contracts.test.mjs`
- Modify: `src/pages/index.astro`

**Interfaces:**
- Consumes: The confirmed static copy in Global Constraints.
- Produces: One hero eyebrow, one H1, one introduction, and exactly three hero-index rows.

- [ ] **Step 1: Write the failing editorial contract**

Append to `tests/editorial-contracts.test.mjs`:

```js
test('homepage hero presents industry research, trading, and applied AI', async () => {
  const homepage = await source('src/pages/index.astro');

  assert.match(homepage, /INDUSTRY RESEARCH · TRADING · APPLIED AI/u);
  assert.match(homepage, /产业研究、交易与 AI 应用/u);
  assert.match(
    homepage,
    /从大宗商品与周期行业出发，研究产业演化、供需变化与资本周期，同时记录交易方法和 AI 在研究工作流中的实际应用。/u,
  );
  assert.match(homepage, /<span>01<\/span><span>产业研究<\/span>/u);
  assert.match(homepage, /<span>02<\/span><span>市场与交易<\/span>/u);
  assert.match(homepage, /<span>03<\/span><span>AI 应用<\/span>/u);
  assert.doesNotMatch(homepage, /Investment · Trading · Commodities/u);
  assert.doesNotMatch(homepage, /<span>04<\/span>/u);
});
```

- [ ] **Step 2: Run the editorial contract and verify RED**

Run:

```bash
node --test tests/editorial-contracts.test.mjs
```

Expected: FAIL because the homepage still contains the old eyebrow, title, introduction, and four-row index.

- [ ] **Step 3: Replace the hero and page-description copy**

In `src/pages/index.astro`, update `<Base description>`, `.eyebrow`, `#hero-title`, `.hero-intro`, and `.hero-index` to:

```astro
<Base
  title="Deep Value Research"
  description="从大宗商品与周期行业出发，研究产业演化、供需变化与资本周期，同时记录交易方法和 AI 在研究工作流中的实际应用。"
>
  <section class="hero" aria-labelledby="hero-title">
    <div class="hero-grid">
      <div class="hero-copy">
        <p class="eyebrow">INDUSTRY RESEARCH · TRADING · APPLIED AI</p>
        <h1 id="hero-title">产业研究、交易与 AI 应用</h1>
        <p class="hero-intro">
          从大宗商品与周期行业出发，研究产业演化、供需变化与资本周期，同时记录交易方法和 AI 在研究工作流中的实际应用。
        </p>
        <div class="hero-actions">
          <a class="text-link" href="/investment/">进入投资研究</a>
          <a class="text-link" href="/research-log/">查看研究日志</a>
        </div>
      </div>
      <aside class="hero-index" aria-label="研究范围">
        <div class="hero-index-row"><span>01</span><span>产业研究</span></div>
        <div class="hero-index-row"><span>02</span><span>市场与交易</span></div>
        <div class="hero-index-row"><span>03</span><span>AI 应用</span></div>
      </aside>
    </div>
  </section>
```

- [ ] **Step 4: Run the editorial contract and verify GREEN**

Run:

```bash
node --test tests/editorial-contracts.test.mjs
```

Expected: all editorial contract tests PASS with zero failures.

- [ ] **Step 5: Commit the homepage positioning**

```bash
git add src/pages/index.astro tests/editorial-contracts.test.mjs
git commit -m "feat: sharpen homepage positioning"
```

### Task 3: Homepage investment thumbnail rows

**Files:**
- Modify: `tests/editorial-contracts.test.mjs`
- Modify: `src/pages/index.astro`

**Interfaces:**
- Consumes: `extractLeadImage(markdown)` from Task 1 and each Astro content entry’s `body` string.
- Produces: `investmentRows: Array<{ entry, preview: { src: string, alt: string } | undefined }>` and optional linked `.entry-preview` markup.

- [ ] **Step 1: Write the failing homepage thumbnail contract**

Append to `tests/editorial-contracts.test.mjs`:

```js
test('homepage investment rows render optional linked lead-image previews', async () => {
  const homepage = await source('src/pages/index.astro');

  assert.match(homepage, /import\s*\{\s*extractLeadImage\s*\}\s*from\s*'\.\.\/lib\/entry-utils\.mjs'/u);
  assert.match(homepage, /preview:\s*extractLeadImage\(entry\.body\)/u);
  assert.match(homepage, /class="entry-preview"/u);
  assert.match(homepage, /loading="lazy"/u);
  assert.match(homepage, /decoding="async"/u);
  assert.match(homepage, /aspect-ratio:\s*4\s*\/\s*3/u);
  assert.match(
    homepage,
    /class:list=\{\['investment-row', \{ 'has-preview': Boolean\(preview\) \}\]\}/u,
  );
});
```

- [ ] **Step 2: Run the editorial contract and verify RED**

Run:

```bash
node --test tests/editorial-contracts.test.mjs
```

Expected: FAIL because the homepage does not import the helper or render preview images.

- [ ] **Step 3: Prepare preview row data**

At the top of `src/pages/index.astro`, add:

```astro
import { extractLeadImage } from '../lib/entry-utils.mjs';
```

After `investmentArticles` is defined, add:

```astro
const investmentRows = investmentArticles.map(entry => ({
  entry,
  preview: extractLeadImage(entry.body),
}));
```

- [ ] **Step 4: Render the optional linked preview**

Replace the investment list mapping with:

```astro
{investmentRows.map(({ entry, preview }, index) => (
  <li class:list={['investment-row', { 'has-preview': Boolean(preview) }]}>
    <span class="entry-index">{String(index + 1).padStart(2, '0')}</span>
    <div class="entry-copy">
      <p class="entry-meta">
        <span>{entry.data.topic || entry.data.section || 'investment'}</span>
        <time datetime={dateTime(entry.data.published_at)}>
          {formatDate(entry.data.published_at)}
        </time>
      </p>
      <h3>
        <a href={`/blog/${entry.data.publish_id}`}>{entry.data.title}</a>
      </h3>
      {entry.data.summary && <p class="entry-summary">{entry.data.summary}</p>}
    </div>
    {preview && (
      <a
        class="entry-preview"
        href={`/blog/${entry.data.publish_id}`}
        aria-label={`查看文章：${entry.data.title}`}
      >
        <img
          src={preview.src}
          alt={preview.alt}
          width="640"
          height="480"
          loading="lazy"
          decoding="async"
        />
      </a>
    )}
    <a
      class="row-link"
      href={`/blog/${entry.data.publish_id}`}
      aria-label={`阅读全文：${entry.data.title}`}
    >
      阅读全文
    </a>
  </li>
))}
```

- [ ] **Step 5: Add desktop and responsive thumbnail CSS**

Replace the base investment-row grid rule and add preview styles:

```css
.investment-list li {
  display: grid;
  grid-template-columns: 4.5rem minmax(0, 1fr) auto;
  gap: 1.5rem;
  align-items: start;
  min-height: 270px;
  padding: 2.5rem 1.5rem;
  border-bottom: 1px solid var(--border-subtle);
}
.investment-list li.has-preview {
  grid-template-columns: 4.5rem minmax(0, 1fr) clamp(220px, 23vw, 320px) auto;
}
.entry-preview {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  background: var(--surface-secondary);
}
.entry-preview img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform var(--duration-base) var(--ease-editorial);
}
.entry-preview:hover img {
  transform: scale(1.015);
}
```

At `max-width: 980px`, preserve a compact three-column preview row:

```css
.investment-list li.has-preview {
  grid-template-columns: 3rem minmax(0, 1fr) minmax(200px, 28vw, 280px);
}
.investment-list li.has-preview .entry-preview {
  grid-column: 3;
  grid-row: 1 / span 2;
}
```

At `max-width: 820px`, move the preview below the text:

```css
.investment-list li,
.investment-list li.has-preview {
  grid-template-columns: 3rem minmax(0, 1fr);
}
.investment-list li.has-preview .entry-preview {
  grid-column: 2;
  grid-row: auto;
  max-width: none;
}
.row-link {
  grid-column: 2;
  justify-self: start;
}
```

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
node --test tests/entry-utils.test.mjs tests/editorial-contracts.test.mjs
```

Expected: both test files PASS with zero failures.

- [ ] **Step 7: Commit the thumbnail feature**

```bash
git add src/pages/index.astro tests/editorial-contracts.test.mjs
git commit -m "feat: preview article images on homepage"
```

### Task 4: Full verification and browser acceptance

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Consumes: The completed homepage from Tasks 1–3.
- Produces: Test, build, desktop, mobile, and repository-state evidence suitable for pushing `main`.

- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
npm test
```

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Run the production build**

Run:

```bash
npm run build
```

Expected: Astro builds all routes, including `/`, with exit code 0.

- [ ] **Step 3: Inspect the desktop homepage**

Open `http://127.0.0.1:4321/` and verify:

- Eyebrow, title, introduction, and three hero-index rows match Global Constraints.
- The refining and hog-cycle articles each display their own image.
- Each image has a non-empty accessible `alt`, is loaded, and links to the correct article.
- Text, image, and “阅读全文” do not overlap.
- The page has no horizontal overflow or browser console warnings/errors.

- [ ] **Step 4: Inspect the 390×844 homepage**

Set the test viewport to `390×844` and verify:

- The hero title and introduction remain readable.
- Each article preview moves below its text and stays within the content column.
- The page has no horizontal overflow.
- Reset the viewport after verification.

- [ ] **Step 5: Confirm exact repository scope**

Run:

```bash
git status --short --branch
git diff --check origin/main...HEAD
```

Expected: only the planned documentation, helper, test, and homepage commits are ahead of `origin/main`; `.DS_Store` and `.claude/settings.local.json` remain modified but uncommitted.

- [ ] **Step 6: Push the verified branch**

Run:

```bash
git push origin main
```

Expected: `origin/main` advances to the verified local `HEAD`.
