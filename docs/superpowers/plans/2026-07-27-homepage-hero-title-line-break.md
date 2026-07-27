# Homepage Hero Title Line Break Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the homepage hero title as two intentional lines at a calmer scale.

**Architecture:** Keep the change local to `src/pages/index.astro`. Split the title into two semantic spans, use block layout to guarantee the approved line break, and tune the existing responsive CSS without changing the surrounding hero composition.

**Tech Stack:** Astro, scoped CSS, Node test runner, Astro static build

## Global Constraints

- The title lines are exactly `产业研究` and `交易与 AI 应用`.
- Preserve the Deep Value Editorial font, weight, color, and hero artwork.
- Do not change the eyebrow, introduction, navigation, or downstream modules.
- A 390-pixel viewport must not overflow horizontally.

---

### Task 1: Implement and verify the two-line hero title

**Files:**
- Modify: `src/pages/index.astro`

**Interfaces:**
- Consumes: the existing `#hero-title` heading and scoped homepage styles.
- Produces: two `.hero-title-line` elements whose text and order are stable across responsive breakpoints.

- [ ] **Step 1: Capture the current rendered behavior**

At desktop width, inspect `#hero-title` and confirm the browser currently wraps the single text node into more than two visual lines. At 390 pixels, record `document.documentElement.scrollWidth` and `window.innerWidth`.

- [ ] **Step 2: Add explicit title lines**

Replace the single text node with:

```astro
<h1 id="hero-title">
  <span class="hero-title-line">产业研究</span>
  <span class="hero-title-line">交易与 AI 应用</span>
</h1>
```

Add:

```css
.hero-title-line {
  display: block;
  white-space: nowrap;
}
```

- [ ] **Step 3: Reduce and constrain the title scale**

Replace the homepage hero heading size with a local responsive scale that is approximately 15% smaller on desktop:

```css
.hero h1 {
  font-size: clamp(3.8rem, 6.4vw, 7.2rem);
}
```

At the existing narrow breakpoint, override the size so `交易与 AI 应用` fits within the available width:

```css
.hero h1 {
  font-size: clamp(2.25rem, 10.5vw, 3.25rem);
}
```

- [ ] **Step 4: Verify rendered layout**

At desktop width, verify the title has exactly two `.hero-title-line` elements and their vertical positions differ. At 390 pixels, verify:

```js
document.documentElement.scrollWidth <= window.innerWidth
```

Also verify both line bounding rectangles remain inside the viewport.

- [ ] **Step 5: Run automated verification**

Run:

```bash
npm test
npm run build
git diff --check
```

Expected: 121 tests pass, 12 static pages build, and the diff check exits successfully.

- [ ] **Step 6: Commit**

```bash
git add src/pages/index.astro
git commit -m "style: refine homepage hero title"
```
