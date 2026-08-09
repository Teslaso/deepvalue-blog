# SpaceX 10GW Article Publication Design

Date: 2026-08-09
Status: Approved

## Goal

将 Obsidian 笔记《Semi Analysis 文章分析-SpaceX 2027 年 10GW 计划》作为一篇可长期复用的 AI 与技术研究文章发布到 Deep Value Research，并保留研究卡、证据边界、场景推演、证伪条件和跟踪面板。

## Editorial decision

文章采用 `article` 格式，归入 `ai` / `ai-industry`，主题为 `ai-infrastructure`。标题突出问题意识和核心矛盾，不直接复述来源文章的 500B ARR headline；摘要承担站点中的副标题职责，明确说明建设速度、电力、GPU 供应和微软承购需求是判断主线，并提示 ARR 估算依赖未独立验证的假设。

正文保持源笔记现有的二十五层结构，不做大规模删改。原因是该结构已包含作者判断、事实/估算/推论区分、反方观点、敏感变量、场景、催化剂、证伪条件和跟踪面板，符合站点对 durable research conclusion 的定位。

## Publication metadata

```yaml
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
companies: [SpaceX, Microsoft, Nvidia]
tickers: [MSFT, NVDA]
thesis: 真正值得跟踪的不是 5000 亿美元 ARR 这个 headline，而是 SpaceX 能否把建设速度、电力获取和 GPU 供应同时扩大到 10GW；目前关键假设尚未被独立验证。
confidence: low
```

`published_at` 由发布器在首次确认发布时生成；来源笔记中提到的 2026-08-08 是来源文章发布时间，不作为博客发布时间覆盖。

## Boundaries and verification

- 只修改指定 Obsidian 源笔记，并由发布器生成对应的 `src/content/entries` 文件。
- 不修改 Astro 页面、内容 schema 或现有文章。
- 不复制未被正文引用的外部图片；当前笔记没有需要同步的图片附件。
- 发布后必须通过发布器校验、项目测试和 `npm run build`。
- Git 操作只允许包含此次文章发布及本设计/计划文档，不纳入工作区中已有的无关改动。
