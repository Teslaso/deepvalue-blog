# SpaceX 10GW Article Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the approved SpaceX 10GW AI-compute analysis as a durable AI research article in Deep Value Research.

**Architecture:** Keep the Obsidian vault note as the authored source, add only the publisher-recognized YAML metadata to that note, and let the existing publisher transform it into `src/content/entries`. Do not modify Astro routes, schemas, or unrelated working-tree files.

**Tech Stack:** Obsidian Markdown, YAML frontmatter, Node.js publisher, Astro 6, Node test runner.

## Global Constraints

- The note is eligible only when it contains the YAML boolean `publish: true`.
- The stable public identity is `spacex-10gw-ai-compute-2027`.
- The article uses `domain: ai`, `section: ai-industry`, `topic: ai-infrastructure`, and `format: article`.
- The source is classified as `source_type: mixed` and the confidence is `low` because the ARR and scale assumptions are not independently verifiable.
- The publisher owns `published_at`; the source article date remains in the body and source metadata, not as the blog publication timestamp.
- Publication runs with `--yes --no-push`; no remote push is authorized by this plan.

### Task 1: Add publication metadata to the source note

**Files:**
- Modify: `/Users/matt/Library/CloudStorage/OneDrive-个人/obsidian_trading/Semi Analysis 文章分析-SpaceX 2027 年 10GW 计划.md`

**Interfaces:**
- Consumes: the approved metadata in `docs/superpowers/specs/2026-08-09-spacex-10gw-article-publication-design.md`.
- Produces: a publish-eligible source note with an immutable `publish_id` and an unchanged research body.

- [ ] **Step 1: Add the exact YAML frontmatter before the existing first heading**

```yaml
---
publish: true
publish_id: spacex-10gw-ai-compute-2027
domain: ai
section: ai-industry
topic: ai-infrastructure
format: article
source_type: mixed
title: SpaceX 能否在 2027 年建成 10GW AI 算力？速度、电力与微软的算力缺口
summary: SemiAnalysis 对 SpaceX 2027 年 10GW AI 算力计划的拆解：建设速度、电力与 GPU 供给如何决定算力租金，以及微软是否会成为最大承购商；文中 3000–5000 亿美元 ARR 估算的关键假设也需要单独审视。
source_title: SpaceX 10GW in 2027 – Why It’s Real, Will Drive $500B ARR for SpaceX, and Why Microsoft Will Be the Largest Offtaker
tags: [SpaceX, AI 算力, 数据中心, AI 推理, 微软, Nvidia]
commodities: []
companies: [SpaceX, Microsoft, Nvidia]
tickers: [MSFT, NVDA]
thesis: 真正值得跟踪的不是 5000 亿美元 ARR 这个 headline，而是 SpaceX 能否把建设速度、电力获取和 GPU 供应同时扩大到 10GW；目前关键假设尚未被独立验证。
confidence: low
---
```

- [ ] **Step 2: Verify the source note still contains all original body text after the frontmatter**

Run: `wc -l '/Users/matt/Library/CloudStorage/OneDrive-个人/obsidian_trading/Semi Analysis 文章分析-SpaceX 2027 年 10GW 计划.md'` and `sed -n '1,28p' '/Users/matt/Library/CloudStorage/OneDrive-个人/obsidian_trading/Semi Analysis 文章分析-SpaceX 2027 年 10GW 计划.md'`

Expected: The first non-frontmatter line is `## 第一层：文章研究卡`, and the original research sections remain present.

### Task 2: Publish the current note through the repository publisher

**Files:**
- Create or update: `src/content/entries/spacex-10gw-ai-compute-2027.md`
- Update: `.publish-state.json` if the publisher records the confirmed publication state

**Interfaces:**
- Consumes: the publish-eligible source note and `publish.config.local.json`.
- Produces: a published Astro entry with `status: published`, generated `published_at`, the stable public route `/blog/spacex-10gw-ai-compute-2027/`, and no remote push.

- [ ] **Step 1: Run the publisher non-interactively without pushing**

Run: `npm run publish:current -- --source '/Users/matt/Library/CloudStorage/OneDrive-个人/obsidian_trading/Semi Analysis 文章分析-SpaceX 2027 年 10GW 计划.md' --yes --no-push`

Expected: The publisher validates the note, applies only the exact article manifest, and reports `without push`.

- [ ] **Step 2: Inspect the generated frontmatter and route identity**

Run: `sed -n '1,34p' src/content/entries/spacex-10gw-ai-compute-2027.md && rg -n 'spacex-10gw-ai-compute-2027|SpaceX 能否|status: published|domain: ai|format: article' src/content/entries/spacex-10gw-ai-compute-2027.md .publish-state.json`

Expected: The generated entry has the approved title and metadata, `status: published`, an ISO `published_at`, and the same 25-layer body.

- [ ] **Step 3: Confirm the change set contains no unrelated files**

Run: `git status --short`

Expected: Only the generated article and publisher state are new/modified in addition to the already-known unrelated files and the already-committed design/plan documents.

### Task 3: Verify the publication

**Files:**
- Test: repository test suite and Astro build output

**Interfaces:**
- Consumes: the generated published entry.
- Produces: evidence that content schema, publisher contracts, and static generation all pass.

- [ ] **Step 1: Run the publisher tests**

Run: `npm run publish:test`

Expected: PASS with zero failed tests.

- [ ] **Step 2: Run the full project tests**

Run: `npm test`

Expected: PASS with zero failed tests.

- [ ] **Step 3: Build the Astro site**

Run: `npm run build`

Expected: Astro completes successfully and generates the new `/blog/spacex-10gw-ai-compute-2027/` route.

- [ ] **Step 4: Inspect the final diff**

Run: `git diff --stat && git diff -- src/content/entries/spacex-10gw-ai-compute-2027.md`

Expected: The diff is limited to the approved article publication metadata/body copy and publisher state; no page or schema changes appear.
