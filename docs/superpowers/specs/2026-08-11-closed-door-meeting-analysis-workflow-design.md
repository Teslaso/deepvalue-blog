# Closed-Door Meeting Analysis and Publishing Workflow

Date: 2026-08-11

Status: Approved for implementation planning

## 1. Purpose

Build a local, one-command workflow that turns newly added overseas broker and
investment-bank meeting transcripts into individually published investment
research reports.

The user continues to add transcript Markdown files manually to:

```text
/Users/matt/Library/CloudStorage/OneDrive-个人/obsidian_trading/10_资料库/闭门会
```

Running one command must:

1. detect new or changed transcript files;
2. read the current analysis prompt from the same directory;
3. analyze each transcript independently with DeepSeek V4 Flash;
4. verify the generated report against the source transcript;
5. save the private generated report in Obsidian;
6. build an isolated preview of the exact new or changed public articles;
7. wait for explicit user confirmation before changing, committing, or pushing
   the blog repository.

The workflow does not clean or rewrite the source transcript. Transcripts remain
read-only inputs. Only the AI-produced investment analysis is eligible for public
publication.

## 2. Current Context

### 2.1 Source material

The source directory currently contains four transcripts of roughly 42–64 KB
each. A typical file contains an editor- or AI-produced Chinese interpretation
near the beginning, followed by a timestamped original transcript in Chinese or
English.

The source files may contain:

- speech-to-text errors;
- incorrect punctuation or sentence boundaries;
- incorrect English names and terms;
- malformed numbers such as “03次”;
- duplicated summaries and original transcript content;
- speaker labels and timestamps;
- client-only or closed-door disclaimers.

The authoritative prompt is:

```text
/Users/matt/Library/CloudStorage/OneDrive-个人/obsidian_trading/10_资料库/闭门会/海外券商闭门会逐字稿深度分析提示词.md
```

The prompt already defines the editorial and analytical requirements, including
original-transcript priority, information-value ranking, attribution boundaries,
transcription uncertainty, market-pricing analysis, causal chains, industry
mapping, and future verification criteria. The workflow must load this file at
runtime rather than copying its contents into source code.

### 2.2 Existing publisher

The repository already has a safe Obsidian Publisher with these relevant
properties:

- the Vault is a read-only publishing source;
- only notes with the YAML boolean `publish: true` are eligible;
- Markdown and supported assets are transformed in temporary staging;
- Astro is built before anything is applied;
- the browser preview displays the exact publication manifest;
- explicit confirmation is required;
- only exact publication targets are committed;
- unrelated working-tree changes are preserved;
- pushing is optional and push failure retains the local commit.

The new workflow must extend and reuse this transaction system. It must not write
directly to `src/content/entries` or create a second publishing implementation.

### 2.3 Model contract

All AI analysis, verification, and repair calls use the official model identifier:

```text
deepseek-v4-flash
```

The OpenAI-compatible base URL is `https://api.deepseek.com`. The model supports
the complete current input size without transcript chunking. The implementation
must use thinking mode for the analytical and verification calls and must not
silently fall back to another model.

Reference: <https://api-docs.deepseek.com/quick_start/pricing/>

## 3. Product Decisions

### 3.1 One transcript produces one report

Each source transcript maps to exactly one generated analysis report and one
stable public article identity. A batch may contain multiple reports, but reports
are not merged into a weekly digest.

### 3.2 No transcript-cleaning stage

The original transcript is analyzed directly. The model is instructed to treat
obvious transcription anomalies as uncertainties, use the original speaker text
as the primary source, and avoid unsupported corrections.

No cleaned transcript, fluent meeting minutes, or alternate rewritten transcript
is produced.

### 3.3 Private report before public copy

The generated analysis first becomes a Markdown note inside the Obsidian Vault.
It remains available there even if publication is canceled. The public blog copy
is created only through the existing Publisher after explicit confirmation.

### 3.4 Human confirmation is mandatory

The command may automate detection, AI generation, validation, staging, and
preview. It may not automate final publication. A browser preview must be shown
before applying changes, committing, or pushing.

### 3.5 Changes are hash-driven

A report is regenerated when any of the following changes:

- the source transcript SHA-256;
- the analysis prompt SHA-256;
- the configured model or generation-contract version.

Unchanged reports do not cause another AI request. A generated but unconfirmed
report remains pending for publication and must be previewable without another AI
request.

## 4. Files and Boundaries

### 4.1 Vault layout

The target Vault layout is:

```text
10_资料库/闭门会/
├── 海外券商闭门会逐字稿深度分析提示词.md
├── <source transcript>.md
└── AI分析报告/
    └── <stable generated report>.md
```

The source scanner reads Markdown files directly inside `闭门会/`; it does not
recurse into subdirectories. It explicitly excludes the prompt file, hidden
files, temporary files, and generated output.

Generated report writes are atomic: write a temporary file in `AI分析报告/`,
flush it, and rename it to the target filename. The workflow never opens a source
transcript for writing.

### 4.2 Repository module layout

The implementation should use a focused module directory:

```text
meeting-workflow/
├── scanner.mjs
├── deepseek.mjs
├── generator.mjs
├── validator.mjs
├── state.mjs
└── workflow.mjs
```

Responsibilities:

- `scanner.mjs`: discover source transcripts and compute source/prompt hashes;
- `deepseek.mjs`: own the DeepSeek HTTP boundary, retries, timeouts, and response
  normalization;
- `generator.mjs`: assemble the runtime prompt, generate reports, run model-based
  verification, and perform one repair attempt;
- `validator.mjs`: enforce deterministic frontmatter, structure, privacy, and
  publication checks;
- `state.mjs`: read, validate, and atomically write private incremental state;
- `workflow.mjs`: coordinate locking, candidate selection, generation, exact
  publication preparation, preview, and reporting.

The exact filenames may change during implementation if repository conventions
make another small decomposition clearer, but the boundaries must remain
separate and independently testable.

### 4.3 Local configuration and secrets

The existing Git-ignored `publish.config.local.json` remains the source of the
Vault root. Meeting-workflow configuration should add relative paths and fixed
behavior without committing personal absolute paths. Required logical settings
are:

- transcript directory: `10_资料库/闭门会`;
- prompt filename: `海外券商闭门会逐字稿深度分析提示词.md`;
- generated report directory: `10_资料库/闭门会/AI分析报告`;
- model: `deepseek-v4-flash`;
- request timeout and retry policy;
- generation-contract version.

`DEEPSEEK_API_KEY` is read only from the process environment. The key must never
be written to the Vault, configuration files, state, logs, test snapshots, Git,
or error objects shown in the UI.

### 4.4 Private incremental state

The Git-ignored repository file `.meeting-analysis-state.json` records only the
operational metadata needed for deterministic incremental processing:

```json
{
  "version": 1,
  "entries": {
    "stable-source-id": {
      "sourceRelativePath": "10_资料库/闭门会/example.md",
      "sourceSha256": "<sha256>",
      "promptSha256": "<sha256>",
      "model": "deepseek-v4-flash",
      "contractVersion": 1,
      "outputRelativePath": "10_资料库/闭门会/AI分析报告/example.md",
      "outputSha256": "<sha256>",
      "publishId": "stable-public-id",
      "generationStatus": "validated",
      "generatedAt": "<ISO-8601 timestamp>"
    }
  }
}
```

Exact JSON field names may be refined during planning, but the state must be
versioned, schema-validated, atomically written, and free of transcript or report
bodies.

The existing `.publish-state.json` remains authoritative for confirmed public
publication. Analysis state and publication state must not be conflated.

## 5. Source Identity and Change Detection

### 5.1 Stable identity

The first successful analysis assigns a stable source ID and `publish_id`. The
identity is persisted in private analysis state and reused on every later run.
Changing a filename or title must not change the public URL when the workflow can
reliably match the source.

### 5.2 Rename handling

When a previously known path disappears and exactly one new source file has the
same full content hash, the workflow migrates the existing identity to the new
path.

When a rename and content edit happen together and identity cannot be established
unambiguously, the workflow stops that source and reports the ambiguity. It must
not create a duplicate public article automatically.

### 5.3 Prompt and model changes

Any prompt-content change invalidates all existing analysis outputs because the
prompt is part of the report-generation contract. A model or contract-version
change has the same effect.

Regeneration changes the existing report and previews an update to the same
public article; it never creates a second `publish_id`.

## 6. AI Generation Pipeline

### 6.1 Complete-context input

Each analysis call receives:

1. a small, versioned execution contract;
2. the current prompt file contents without editorial rewriting;
3. source filename metadata;
4. the complete transcript body.

The current source sizes fit inside the model context. The first version does not
chunk transcripts. If a later source exceeds an explicit safe request budget, the
workflow stops with a size diagnostic rather than silently switching to a lower
quality chunking strategy.

### 6.2 Execution contract

The versioned technical wrapper may add only requirements needed to integrate the
user's editorial prompt safely:

- output one complete Markdown document;
- emit valid YAML frontmatter with injected stable fields;
- do not reveal absolute paths or private source links;
- do not reproduce long verbatim passages;
- preserve the prompt's distinctions among institution views, analysis, and
  further inference;
- mark unresolved transcription uncertainty instead of inventing a correction;
- do not add externally sourced facts;
- do not describe the generation process in the article.

The wrapper must not replace, summarize, or weaken the user-maintained prompt.

### 6.3 Required public frontmatter

Each generated report is a Publisher-eligible Obsidian note:

```yaml
---
publish: true
publish_id: 2026-08-08-goldman-weekend-macro
title: 高盛周末宏观闭门会分析：AI资本开支、信用供给与亚洲配置窗口
domain: investment
section: macro-cycles
format: article
source_type: report
source_title: 高盛周末宏观闭门会
summary: 一句话概括最重要的信息增量。
tags: [美联储, AI资本开支, 信用市场, 亚洲权益]
commodities: []
companies: []
tickers: []
thesis: 报告最核心的可验证判断。
confidence: medium
---
```

Rules:

- `publish_id` is supplied by the workflow, not freely regenerated by the model;
- `domain` is `investment` for this first-version workflow;
- `section` must be one of the existing investment sections and reflect the
  primary subject;
- `format` is `article`;
- `source_type` is `report`;
- `source_url` is omitted so a private Feishu or subscription URL cannot leak;
- arrays must always be valid YAML arrays;
- the generated body must not contain local paths or private source URLs.

The model proposes title, summary, section, tags, entities, thesis, and confidence.
Deterministic validation decides whether they are publishable.

### 6.4 Report structure

The user-maintained prompt remains authoritative. The deterministic validator
does not require all eighteen possible analytical sections because absent topics
must not be invented. It does require the report to contain recognizable coverage
of these core functions:

- a 30-second conclusion;
- the highest-value new information;
- the institution's worldview or the main causal chains;
- market pricing and expectation gaps;
- contradictions and uncertainty;
- a future verification checklist;
- a final investment-research conclusion.

Industry, company, commodity, regional, and asset-class sections appear only when
the source provides meaningful material.

### 6.5 Model-based verification

After generation, a second `deepseek-v4-flash` call receives the complete source
transcript and generated report. It returns structured diagnostics rather than a
second report.

The verifier checks:

- whether every important number, unit, and time horizon is supported;
- whether fact, forecast, institution view, analytical synthesis, and further
  inference are distinguished;
- whether speaker or institution attribution is correct;
- whether the opening AI summary displaced the original transcript as the primary
  source;
- whether likely transcription errors were silently repaired without support;
- whether companies, recommendations, market consensus, or causal claims were
  invented;
- whether a mere mention was promoted to a recommendation;
- whether a short-term trade and a long-term fundamental view were conflated;
- whether private paths, private URLs, or lengthy source wording leaked.

Blocking diagnostics trigger one repair call using the transcript, draft, and
diagnostics. The repaired report runs through deterministic and model-based
validation again. A report that still has blocking diagnostics is marked failed
and excluded from publication preparation.

All analysis, verification, and repair calls use `deepseek-v4-flash`. There is no
fallback model.

## 7. Deterministic Validation

Before a report can enter the Publisher, it must pass:

1. UTF-8 and non-empty output checks;
2. YAML parse and existing Publisher frontmatter validation;
3. immutable `publish_id` matching;
4. allowed domain, section, format, source type, and confidence checks;
5. required core report-function checks;
6. forbidden private URL and absolute-path checks;
7. obvious model-process preamble and incomplete-output checks;
8. duplicate public identity checks;
9. generated target containment checks;
10. a final source/output hash consistency check before preview.

Validation errors are actionable and name the source, stage, and recovery action.
Diagnostics must not include the API key or transcript body.

## 8. End-to-End Command Flow

The primary command is:

```bash
npm run meetings:publish
```

The command performs these steps:

1. acquire a workflow lock so two runs cannot overlap;
2. load and validate local Publisher and meeting-workflow configuration;
3. read and hash the analysis prompt;
4. scan and hash source transcripts;
5. reconcile known identities and safe renames;
6. select new or invalidated analysis candidates;
7. when at least one candidate requires AI work, verify that
   `DEEPSEEK_API_KEY` exists without printing it;
8. generate, verify, repair when necessary, and atomically save each private
   Obsidian report;
9. record successful analysis state atomically;
10. collect every validated report that is new or changed relative to confirmed
    Publisher state;
11. prepare one exact multi-note Publisher transaction for those report paths
    only;
12. build Astro in isolated staging;
13. open one batch preview and wait for user action;
14. on confirmation, reuse the existing exact apply, rebuild, commit, state
    update, and optional push behavior;
15. on cancellation, remove temporary publication staging and leave the
    repository unchanged.

The workflow must prepare an exact list of generated report paths. It must not use
an unrestricted whole-Vault pending scan that could accidentally include unrelated
`publish: true` notes.

## 9. Preview and Confirmation

The batch preview extends the existing Publisher manifest with analysis context.
For each article, it shows:

- create or update status;
- source transcript basename;
- public title, summary, and target URL;
- analysis and verification status;
- generated report path relative to the Vault;
- exact repository targets and before/after hashes.

It does not display or serve the source transcript body.

The existing actions remain:

- Confirm & Push;
- Confirm without Push;
- Cancel.

Canceling publication does not delete the generated Obsidian reports or successful
analysis state. On the next run, the reports remain pending and the workflow opens
their preview without another model call.

Every public report ends with this standard disclosure:

> 本文基于机构会议材料进行二次研究分析；文中的【进一步推演】不代表原机构观点，不构成投资建议。

The workflow adds the disclosure deterministically if it is missing and prevents
duplicate copies.

## 10. Failure and Recovery

### 10.1 Per-report isolation

A generation, verification, repair, or validation failure affects only that
source. Other reports continue through analysis. Failed reports are clearly
listed and excluded from the publication manifest.

Validated successes may still be previewed and confirmed by the user. The preview
must make partial-batch status prominent so the user cannot mistake a partial
batch for complete success.

### 10.2 API failures

- Missing key or authentication failure stops all API work before sending any
  transcript.
- Rate limits and transient server failures use bounded exponential backoff with
  jitter.
- Timeouts and interrupted responses are retried only within the bounded policy.
- Permanent failures remain eligible for a later run.
- The client must not log request bodies or authorization headers.

### 10.3 Output failures

Malformed frontmatter or a repairable structural error may use the single repair
attempt. Truncated, unsupported, or still-invalid output is not saved as a
validated final report and never enters publication.

### 10.4 Publication failures

- Preview or Astro build failure leaves the live repository unchanged.
- A changed target or overlapping repository edit stops exact application.
- An apply or final-build failure uses the existing transaction rollback.
- A Git commit failure leaves unrelated work untouched and reports exact recovery.
- A push failure retains the scoped local commit for a later push.

### 10.5 Logging

Operational logs may contain:

- source basenames;
- hashes;
- model ID and contract version;
- token counts and elapsed time;
- retry count;
- validation codes and concise diagnostics;
- transaction and commit identifiers.

Logs must not contain transcript bodies, full generated reports, private URLs,
absolute Vault paths, request authorization headers, or API keys.

## 11. Testing Strategy

Tests use synthetic transcripts and prompts. Real subscribed transcripts must not
be copied into the repository, snapshots, fixtures, or CI logs.

### 11.1 Scanner and identity tests

- exclude the prompt, output directory, hidden files, temporary files, and
  non-Markdown files;
- detect every source on the first run;
- make zero model calls on an unchanged second run;
- invalidate only one report after one source edit;
- invalidate all reports after a prompt or contract change;
- preserve `publish_id` across ordinary source edits;
- migrate identity for an unambiguous same-content rename;
- stop an ambiguous rename instead of duplicating an article.

### 11.2 DeepSeek client tests

- send the exact model ID `deepseek-v4-flash`;
- enable the configured thinking mode;
- never substitute another model;
- fail safely for missing credentials and authentication errors;
- retry only retryable 429, timeout, connection, and server failures;
- redact headers and bodies from logged errors;
- reject incomplete or invalid responses.

Default automated tests use a fake HTTP client. A live API smoke test is explicit,
manual, and excluded from the normal test suite.

### 11.3 Generation and validation tests

- combine the current prompt with the complete source without chunking;
- preserve the workflow-supplied stable identity;
- accept optional topic-specific sections only when present;
- reject missing core report functions;
- reject private Feishu links and absolute paths;
- reject invalid frontmatter and private source URLs;
- identify unsupported numbers and attribution errors from verifier diagnostics;
- repair at most once;
- exclude a report that remains invalid;
- append exactly one standard disclosure.

### 11.4 State tests

- validate state schema and version;
- write state atomically;
- recover from a missing state file;
- fail safely on corrupt state without overwriting it;
- keep analysis state separate from confirmed publication state;
- retain pending reports after preview cancellation.

### 11.5 Publisher integration tests

- prepare only the exact generated report paths;
- build a multi-report isolated preview;
- leave all tracked repository content and every non-workflow file unchanged
  after cancellation; the Git-ignored analysis state may retain successful
  generation metadata;
- commit only manifest targets after confirmation;
- preserve unrelated tracked, untracked, and staged user changes;
- block changed targets and duplicate identities;
- retain a scoped local commit after push failure.

### 11.6 End-to-end acceptance

With the current four source transcripts and a valid API key:

1. the first run generates four private reports and opens one batch preview;
2. canceling and rerunning makes no DeepSeek calls and reopens the four pending
   reports;
3. confirmation creates one exact publication commit and pushes it when selected;
4. changing one source regenerates and previews only its existing public article;
5. changing the prompt regenerates and previews all four existing articles;
6. a single failed report is excluded and visibly reported without contaminating
   the successful reports;
7. repository tests and the production Astro build pass before completion is
   claimed.

## 12. First-Version Non-Goals

The first version does not:

- clean, correct, or rewrite transcript source files;
- generate a cleaned private transcript;
- generate cross-institution weekly digests;
- run on a timer or background daemon;
- publish without human confirmation;
- create an Obsidian plugin or new authoring UI;
- use web search or external market data to supplement a report;
- publish source transcripts, speaker-by-speaker text, private links, or local
  paths;
- fall back to a different AI model;
- add a general-purpose AI workflow framework unrelated to this source directory.

## 13. Implementation Constraints

- Use Node.js and the repository's existing ESM conventions.
- Reuse the existing Publisher transaction, validation, transformation, preview,
  Git, and state patterns where they fit.
- Preserve the separate Vault/repository privacy boundary.
- Do not mutate source transcripts or the user-maintained prompt.
- Do not stage or commit unrelated working-tree changes.
- Keep model and filesystem boundaries injectable for deterministic tests.
- Prefer explicit typed validation at every external boundary.
- Keep the command safe to rerun after interruption at any stage.

## 14. Success Definition

The workflow is successful when the user can add transcript Markdown files, run
one command, review individually generated DeepSeek V4 Flash investment reports in
one isolated blog preview, and explicitly publish them without cleaning source
transcripts, duplicating work, leaking private source material, or risking
unrelated repository changes.
