# Closed-Door Meeting Analysis Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one safe local command that detects new or changed closed-door meeting transcripts, creates one DeepSeek V4 Flash investment report per transcript, verifies each report, and opens an exact multi-article Publisher preview for explicit confirmation.

**Architecture:** Add a focused `meeting-workflow/` layer in front of the existing Obsidian Publisher. The new layer owns source scanning, private incremental state, the DeepSeek HTTP boundary, prompt assembly, two-pass verification, and atomic Vault output; the existing Publisher continues to own transformation, isolated Astro builds, exact repository application, Git commits, and pushes.

**Tech Stack:** Node.js 22.12+ ESM, built-in `fetch`, `node:test`, `node:crypto`, `node:fs`, existing `gray-matter`/`yaml` parsing, existing Astro 6 Publisher transaction and loopback preview server.

## Global Constraints

- Source transcripts and `海外券商闭门会逐字稿深度分析提示词.md` are read-only inputs and must never be opened for writing.
- Scan only direct Markdown children of `10_资料库/闭门会`; do not recurse into `AI分析报告/`.
- One transcript maps to one private generated report and one stable public `publish_id`.
- All analysis, verification, and repair requests use exactly `deepseek-v4-flash`; never fall back to another model.
- Every DeepSeek request sets `thinking: { type: "enabled" }`; analysis, verification, and repair use `reasoning_effort: "max"`.
- Send each current transcript as one complete input. Reject inputs above `600000` Unicode characters instead of introducing chunking in V1.
- Use `max_tokens: 64000` for report generation/repair and `max_tokens: 8000` with JSON output for verification.
- Use `temperature: 0.2`, a `600000` ms request timeout, and at most `3` retries for transient failures.
- Read the secret only from `DEEPSEEK_API_KEY`; never serialize or log it.
- Do not send a transcript to DeepSeek when no analysis candidate exists; pending generated reports must be previewable without an API key.
- Do not log transcript bodies, generated report bodies, authorization headers, private Feishu URLs, or absolute Vault paths.
- Generated reports are machine-managed. If an existing output hash differs from analysis state, fail that report with `output_conflict` rather than overwriting or publishing an unverified manual edit.
- Generated public frontmatter uses `domain: investment`, `format: article`, `source_type: report`, and one of the existing investment sections.
- Public output must omit `source_url`, private source links, local paths, long verbatim transcript passages, and raw transcript content.
- Publication always requires the loopback preview confirmation UI; the meeting command does not expose a non-interactive `--yes` option.
- Cancellation retains validated Obsidian reports and private analysis state but changes no tracked repository content.
- The exact multi-note Publisher path list must not include unrelated Vault notes with `publish: true`.
- Preserve all unrelated tracked, untracked, and staged working-tree changes.
- Automated tests use synthetic transcripts only; real subscribed materials never enter repository fixtures, snapshots, or logs.

Reference design: `docs/superpowers/specs/2026-08-11-closed-door-meeting-analysis-workflow-design.md`

DeepSeek API contract: <https://api-docs.deepseek.com/api/create-chat-completion/>

---

## File Structure

### New production files

- `meeting-workflow/scanner.mjs` — safely reads the configured prompt and direct transcript files.
- `meeting-workflow/state.mjs` — validates/atomically stores analysis state, reconciles identities and renames, and owns the process lock.
- `meeting-workflow/deepseek.mjs` — sends redacted, retryable DeepSeek Chat Completions requests.
- `meeting-workflow/prompts.mjs` — builds versioned analysis, verification, and repair messages.
- `meeting-workflow/validator.mjs` — validates generated frontmatter, report structure, verifier JSON, and privacy constraints.
- `meeting-workflow/generator.mjs` — runs generation → validation → verification → one repair attempt.
- `meeting-workflow/output.mjs` — atomically writes machine-managed generated reports with hash conflict checks.
- `meeting-workflow/preview.mjs` — adds safe analysis metadata to the local-only display manifest.
- `meeting-workflow/workflow.mjs` — orchestrates scanning, incremental generation, exact pending selection, and preview/confirmation.
- `meeting-workflow/cli.mjs` — parses safe meeting-command options and maps results/errors to terminal output and exit codes.

### New tests

- `tests/meeting-config.test.mjs`
- `tests/meeting-scanner.test.mjs`
- `tests/meeting-state.test.mjs`
- `tests/meeting-deepseek.test.mjs`
- `tests/meeting-validator.test.mjs`
- `tests/meeting-generator.test.mjs`
- `tests/meeting-output.test.mjs`
- `tests/meeting-preview.test.mjs`
- `tests/meeting-workflow.test.mjs`
- `tests/meeting-e2e.test.mjs`
- `tests/publisher-prepare-batch.test.mjs`

### Existing files modified

- `publisher/lib/config.mjs` — normalize optional `meetingWorkflow` configuration.
- `publisher/lib/publish-note.mjs` — add exact multi-note preparation while preserving the single-note API.
- `publisher/public/index.html` — add a local-only partial-batch/analysis status container.
- `publisher/public/app.js` — render safe meeting-analysis annotations when present.
- `publisher/public/styles.css` — style analysis status and partial-batch warnings.
- `publish.config.example.json` — document relative meeting-workflow configuration.
- `.gitignore` — ignore analysis state, lock, corrupt backups, and temporary state files.
- `package.json` — add `meetings:publish` and `meetings:test` scripts.
- `README.md` — document the daily command and safe preview behavior.
- `publisher/README.md` — document setup, privacy, recovery, and generated-note behavior.

---

### Task 1: Normalize meeting configuration and scan direct transcript inputs

**Files:**
- Modify: `publisher/lib/config.mjs`
- Modify: `publish.config.example.json`
- Create: `meeting-workflow/scanner.mjs`
- Create: `tests/meeting-config.test.mjs`
- Create: `tests/meeting-scanner.test.mjs`

**Interfaces:**
- Consumes: `validatePublishConfig(rawConfig, { filename, repoRoot })` and the existing normalized `vaultRoot`.
- Produces: `config.meetingWorkflow` with absolute contained paths plus portable relative paths.
- Produces: `scanMeetingInputs({ vaultRoot, meetingWorkflow }): Promise<{ prompt, sources }>`.
- `prompt` shape: `{ relativePath: string, text: string, sha256: string }`.
- `sources[]` shape: `{ relativePath: string, basename: string, text: string, sha256: string, sizeBytes: number, characterCount: number }`.

- [ ] **Step 1: Add failing configuration tests**

Add cases that prove the existing Publisher still works when `meetingWorkflow` is absent and that the optional block normalizes exact safe values:

```js
const raw = {
  ...validConfig(fixture.vaultRoot),
  meetingWorkflow: {
    transcriptDir: '10_资料库/闭门会',
    promptFile: '海外券商闭门会逐字稿深度分析提示词.md',
    outputDir: '10_资料库/闭门会/AI分析报告',
    model: 'deepseek-v4-flash',
    reasoningEffort: 'max',
    timeoutMs: 600000,
    maxRetries: 3,
    maxInputCharacters: 600000,
    contractVersion: 1,
  },
};

const config = await validatePublishConfig(raw, {
  filename: 'publish.config.local.json',
  repoRoot: fixture.repoRoot,
});

assert.equal(config.meetingWorkflow.transcriptDirRelative, '10_资料库/闭门会');
assert.equal(config.meetingWorkflow.promptRelativePath,
  '10_资料库/闭门会/海外券商闭门会逐字稿深度分析提示词.md');
assert.equal(config.meetingWorkflow.outputDirRelativePath,
  '10_资料库/闭门会/AI分析报告');
assert.equal(config.meetingWorkflow.model, 'deepseek-v4-flash');
```

Add rejection cases for absolute meeting-relative fields, `..` traversal, a transcript directory or prompt symlink escaping the Vault, missing prompt, output inside the repository, any model other than `deepseek-v4-flash`, non-`max` reasoning effort, and invalid integer bounds.

- [ ] **Step 2: Run the configuration test and verify red**

Run: `node --test tests/meeting-config.test.mjs`

Expected: FAIL because `validatePublishConfig` does not expose `meetingWorkflow`.

- [ ] **Step 3: Implement optional meeting configuration normalization**

Add constants and a focused normalizer inside `publisher/lib/config.mjs`:

```js
const MEETING_MODEL = 'deepseek-v4-flash';
const MEETING_REASONING_EFFORT = 'max';

async function validateMeetingWorkflowConfig({
  config,
  normalizedVaultRoot,
  normalizedRepoRoot,
  filename,
  diagnostics,
}) {
  if (config.meetingWorkflow === undefined) return {};
  const raw = config.meetingWorkflow;
  const transcriptDirRelative = normalizeVaultRelative(raw.transcriptDir, 'meetingWorkflow.transcriptDir');
  const promptFileRelative = normalizeVaultRelative(raw.promptFile, 'meetingWorkflow.promptFile');
  const outputDirRelativePath = normalizeVaultRelative(raw.outputDir, 'meetingWorkflow.outputDir');
  const transcriptDir = await resolveExistingVaultDirectory(normalizedVaultRoot, transcriptDirRelative);
  const promptPath = await resolveExistingVaultFile(
    normalizedVaultRoot,
    path.posix.join(transcriptDirRelative, promptFileRelative),
  );
  const outputDir = await resolveMissingVaultDirectory(normalizedVaultRoot, outputDirRelativePath);
  return {
    meetingWorkflow: {
      transcriptDir,
      transcriptDirRelative,
      promptPath,
      promptRelativePath: path.posix.join(transcriptDirRelative, promptFileRelative),
      outputDir,
      outputDirRelativePath,
      model: MEETING_MODEL,
      reasoningEffort: MEETING_REASONING_EFFORT,
      timeoutMs: raw.timeoutMs ?? 600000,
      maxRetries: raw.maxRetries ?? 3,
      maxInputCharacters: raw.maxInputCharacters ?? 600000,
      contractVersion: raw.contractVersion ?? 1,
    },
  };
}
```

Implement the four named path helpers in the same module using the existing `resolveContainedPath`, `realpathAllowMissing`, `stat`, and containment rules. They add diagnostics rather than returning an escaped path; `resolveExistingVaultFile` also rejects symlinks and non-files. Reject `outputDir === transcriptDir`, an output outside the Vault, or any meeting path overlapping `normalizedRepoRoot`. Call this normalizer from `validatePublishConfig` and spread its result into the normalized return object. Keep `meetingWorkflow` optional so current publisher-only tests and configurations remain compatible.

Add this committed example block to `publish.config.example.json`:

```json
"meetingWorkflow": {
  "transcriptDir": "10_资料库/闭门会",
  "promptFile": "海外券商闭门会逐字稿深度分析提示词.md",
  "outputDir": "10_资料库/闭门会/AI分析报告",
  "model": "deepseek-v4-flash",
  "reasoningEffort": "max",
  "timeoutMs": 600000,
  "maxRetries": 3,
  "maxInputCharacters": 600000,
  "contractVersion": 1
}
```

- [ ] **Step 4: Run configuration tests and the existing core tests**

Run: `node --test tests/meeting-config.test.mjs tests/publisher-core.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 5: Add failing scanner tests**

Create a temporary Vault fixture containing the prompt, two root transcripts, `AI分析报告/generated.md`, a nested transcript, a hidden Markdown file, a temporary Markdown file, a text file, and a symlink. Assert the scanner returns only the two root transcripts in stable path order:

```js
const result = await scanMeetingInputs({
  vaultRoot: fixture.vaultRoot,
  meetingWorkflow: fixture.meetingWorkflow,
});

assert.equal(result.prompt.relativePath,
  '10_资料库/闭门会/海外券商闭门会逐字稿深度分析提示词.md');
assert.deepEqual(result.sources.map(({ basename }) => basename), [
  '20260808高盛闭门会.md',
  '20260809摩根大通闭门会.md',
]);
assert.match(result.prompt.sha256, /^[a-f0-9]{64}$/u);
assert.equal(result.sources[0].text, firstTranscript);
```

Add separate cases for fatal invalid UTF-8, prompt identity changing during read, prompt/source replacement with a symlink, and a source larger than `maxInputCharacters`.

- [ ] **Step 6: Run the scanner test and verify red**

Run: `node --test tests/meeting-scanner.test.mjs`

Expected: FAIL with module-not-found for `meeting-workflow/scanner.mjs`.

- [ ] **Step 7: Implement the contained, non-recursive scanner**

Use `realpath`, `lstat`, `open` with `O_RDONLY | O_NOFOLLOW`, `TextDecoder('utf-8', { fatal: true })`, and SHA-256 over the original bytes. The direct-entry filter is exact:

```js
function isCandidateEntry(entry, promptBasename) {
  if (!entry.isFile() || entry.isSymbolicLink()) return false;
  if (path.extname(entry.name).toLowerCase() !== '.md') return false;
  if (entry.name === promptBasename) return false;
  if (entry.name.startsWith('.') || entry.name.startsWith('~$')) return false;
  if (/\.(?:tmp|partial|download)\.md$/iu.test(entry.name)) return false;
  return true;
}
```

Read every accepted file through the already-open descriptor, verify device/inode identity before retaining bytes, and return only Vault-relative portable paths. Error diagnostics may use basenames and relative paths but never `vaultRoot`.

- [ ] **Step 8: Run scanner and configuration tests**

Run: `node --test tests/meeting-config.test.mjs tests/meeting-scanner.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 9: Commit Task 1**

```bash
git add publisher/lib/config.mjs publish.config.example.json meeting-workflow/scanner.mjs tests/meeting-config.test.mjs tests/meeting-scanner.test.mjs
git commit -m "feat: scan meeting transcript inputs"
```

---

### Task 2: Add stable analysis state, rename reconciliation, and a recoverable process lock

**Files:**
- Create: `meeting-workflow/state.mjs`
- Create: `tests/meeting-state.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: scanner `sources[]`, `promptSha256`, model, and contract version.
- Produces: `createMeetingStateStore({ repoRoot, statePath? })` returning `{ readState, writeState }`.
- Produces: `reconcileMeetingSources({ sources, state, promptSha256, model, contractVersion, outputDirRelativePath })`.
- Reconciliation result: `{ state, candidates, unchanged, migrations, ambiguities }`.
- Candidate shape: `{ reason, source, sourceId, publishId, outputRelativePath, previousEntry? }`.
- Produces: `withMeetingWorkflowLock({ repoRoot, run, now?, processIsAlive? })`.

- [ ] **Step 1: Add failing state-schema and atomic-write tests**

Cover missing state, valid round-trip, invalid version, unsafe paths, invalid hashes, invalid timestamps, corrupt JSON remaining byte-for-byte unchanged, symlink state targets, and serialized concurrent writes. Use the exact state shape:

```js
{
  version: 1,
  entries: {
    'meeting-entry-id': {
      sourceRelativePath: '10_资料库/闭门会/source.md',
      sourceSha256: 'a'.repeat(64),
      promptSha256: 'b'.repeat(64),
      model: 'deepseek-v4-flash',
      contractVersion: 1,
      outputRelativePath: '10_资料库/闭门会/AI分析报告/report.md',
      outputSha256: 'c'.repeat(64),
      publishId: 'report-id',
      generationStatus: 'validated',
      generatedAt: '2026-08-11T03:00:00.000Z',
    },
  },
}
```

- [ ] **Step 2: Run the state test and verify red**

Run: `node --test tests/meeting-state.test.mjs`

Expected: FAIL because `meeting-workflow/state.mjs` does not exist.

- [ ] **Step 3: Implement the state store**

Mirror the containment, `O_NOFOLLOW`, same-parent temporary file, `fsync`, and atomic rename patterns in `publisher/lib/state-store.mjs`, but enforce the meeting-specific schema above. Use `.meeting-analysis-state.json` by default. A corrupt file raises `MeetingStateError` without renaming or replacing it.

```js
export function createMeetingStateStore({ repoRoot = process.cwd(), statePath } = {}) {
  const target = path.resolve(statePath ?? path.join(repoRoot, '.meeting-analysis-state.json'));
  return {
    readState: () => readMeetingState(target, { repoRoot }),
    writeState: (nextState) => enqueueStateWrite(target, () =>
      writeMeetingStateAtomically(target, sanitizeMeetingState(nextState), { repoRoot })),
  };
}
```

- [ ] **Step 4: Add failing identity and rename tests**

Cover first assignment, unchanged inputs, source edit, prompt change invalidating every entry, contract/model change, same-hash rename migration, ambiguous same-hash rename, and missing output metadata. Assert a source edit keeps the same `publishId`:

```js
const reconciled = reconcileMeetingSources({
  sources: [{ ...source, sha256: 'd'.repeat(64) }],
  state: previousState,
  promptSha256: previousPromptHash,
  model: 'deepseek-v4-flash',
  contractVersion: 1,
  outputDirRelativePath: '10_资料库/闭门会/AI分析报告',
});

assert.equal(reconciled.candidates[0].reason, 'source_changed');
assert.equal(reconciled.candidates[0].publishId, previousPublishId);
```

- [ ] **Step 5: Implement deterministic identity and reconciliation**

For first assignment, call the existing `resolvePublishIdentity({ data: {}, sourcePath })` and return the deterministic identity with the candidate. Persist a new entry only after a validated report is written. Match a rename only when one missing known entry and one new source share the same full source hash. Return an ambiguity and no candidate when either side has multiple possible matches.

Candidate reasons are the closed set:

```js
const REASONS = new Set([
  'new_source',
  'source_changed',
  'prompt_changed',
  'model_changed',
  'contract_changed',
  'missing_output',
]);
```

- [ ] **Step 6: Add failing lock tests**

Test exclusive acquisition, live-owner rejection, dead-owner recovery, lock cleanup after success, and lock cleanup after `run` throws. The lock body contains only PID and canonical start time.

- [ ] **Step 7: Implement `withMeetingWorkflowLock`**

Create `.meeting-analysis.lock` with `open(..., 'wx', 0o600)`. On collision, parse the existing file and call injected `processIsAlive(pid)`. If alive, throw `MeetingStateError` with `workflow_locked`. If dead, verify the lock file identity has not changed, unlink it, and retry once. Always remove the owned lock in `finally` after verifying its inode still matches.

- [ ] **Step 8: Ignore private workflow artifacts**

Add exact patterns to `.gitignore`:

```gitignore
.meeting-analysis-state.json
.meeting-analysis-state.json.*
.meeting-analysis.lock
```

- [ ] **Step 9: Run state tests**

Run: `node --test tests/meeting-state.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 10: Commit Task 2**

```bash
git add .gitignore meeting-workflow/state.mjs tests/meeting-state.test.mjs
git commit -m "feat: track meeting analysis state"
```

---

### Task 3: Implement the DeepSeek V4 Flash HTTP boundary

**Files:**
- Create: `meeting-workflow/deepseek.mjs`
- Create: `tests/meeting-deepseek.test.mjs`

**Interfaces:**
- Produces: `createDeepSeekClient({ apiKey, fetchImpl?, sleep?, random?, timeoutMs, maxRetries })`.
- Client method: `complete({ messages, responseFormat, maxTokens }): Promise<{ content, usage, model, finishReason }>`.
- Produces: `DeepSeekRequestError` with `{ code, status?, retryable, attemptCount }` and no request body/header fields.

- [ ] **Step 1: Add failing request-contract tests**

Use an injected fake `fetchImpl` to capture the request and assert the exact endpoint, headers, and JSON body:

```js
assert.equal(url, 'https://api.deepseek.com/chat/completions');
assert.equal(options.headers.Authorization, 'Bearer test-key');
assert.deepEqual(JSON.parse(options.body), {
  model: 'deepseek-v4-flash',
  messages,
  thinking: { type: 'enabled' },
  reasoning_effort: 'max',
  temperature: 0.2,
  max_tokens: 64000,
  stream: false,
  response_format: { type: 'text' },
});
```

Assert the returned value uses `choices[0].message.content`, records `usage`, and never returns `reasoning_content`.

- [ ] **Step 2: Add failing failure/redaction tests**

Cover missing/blank key, 401 without retry, 429 retry with deterministic injected delays, 500/502/503/504 retry, network failure retry, timeout abort, malformed JSON, empty content, `finish_reason: length`, `content_filter`, `insufficient_system_resource`, and a response model other than `deepseek-v4-flash`.

Verify serialized errors do not include `test-key`, prompt text, transcript text, `Authorization`, or request-body fields.

- [ ] **Step 3: Run the DeepSeek test and verify red**

Run: `node --test tests/meeting-deepseek.test.mjs`

Expected: FAIL because `meeting-workflow/deepseek.mjs` does not exist.

- [ ] **Step 4: Implement the non-streaming client and bounded retry policy**

Use `AbortSignal.timeout(timeoutMs)` and retry only statuses `429`, `500`, `502`, `503`, `504`, timeout errors, and network errors. Backoff is:

```js
const delayMs = Math.min(30000, 1000 * (2 ** attempt)) * (0.75 + random() * 0.5);
```

Validate `response.ok`, parsed response shape, exact returned model, `finish_reason === 'stop'`, and non-empty `message.content`. JSON verification requests pass `{ type: 'json_object' }`; text requests pass `{ type: 'text' }`.

- [ ] **Step 5: Run DeepSeek tests**

Run: `node --test tests/meeting-deepseek.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 6: Commit Task 3**

```bash
git add meeting-workflow/deepseek.mjs tests/meeting-deepseek.test.mjs
git commit -m "feat: add DeepSeek V4 Flash client"
```

---

### Task 4: Build the versioned prompt contract and deterministic report validator

**Files:**
- Create: `meeting-workflow/prompts.mjs`
- Create: `meeting-workflow/validator.mjs`
- Create: `tests/meeting-validator.test.mjs`

**Interfaces:**
- Produces: `ANALYSIS_CONTRACT_VERSION = 1`.
- Produces: `buildAnalysisMessages({ promptText, source, identity })`.
- Produces: `buildVerificationMessages({ transcriptText, reportMarkdown, sourceBasename })`.
- Produces: `buildRepairMessages({ promptText, source, identity, reportMarkdown, diagnostics })`.
- Produces: `ensureStandardDisclosure(markdown): string`.
- Produces: `validateGeneratedMeetingReport({ markdown, expectedPublishId, sourceBasename, vaultRoot }): { data, body }`.
- Produces: `parseVerificationResult(content): { passed, diagnostics }`.
- Produces: `MeetingReportValidationError` with structured, body-free diagnostics.

- [ ] **Step 1: Add failing prompt-contract tests**

Assert the user-maintained prompt appears byte-for-byte inside the system message, the full transcript appears once in the user message, and the wrapper injects stable publication fields without rewriting the editorial prompt:

```js
const messages = buildAnalysisMessages({ promptText, source, identity });
assert.equal(messages[0].role, 'system');
assert.ok(messages[0].content.includes(promptText));
assert.equal(messages[1].role, 'user');
assert.ok(messages[1].content.includes(source.text));
assert.ok(messages[0].content.includes(`publish_id: ${identity.publishId}`));
assert.ok(messages[0].content.includes('不要输出本地路径、飞书私有链接或大段原文'));
```

Assert verification requests explicitly demand one JSON object with this schema:

```json
{
  "passed": false,
  "diagnostics": [
    {
      "code": "unsupported_number",
      "severity": "blocking",
      "section": "十、关键数字卡",
      "message": "该数字无法由逐字稿支持"
    }
  ]
}
```

- [ ] **Step 2: Add failing deterministic validation tests**

Build a valid synthetic report fixture and one mutation per rejection case:

- missing or mismatched `publish_id`;
- non-investment domain, invalid section, non-article format, or non-report source type;
- non-array entity fields;
- any `source_url`;
- missing 30-second conclusion;
- missing worldview/core logic;
- missing market pricing/expectation gap;
- missing contradiction/uncertainty;
- missing future verification checklist;
- missing final investment conclusion;
- absolute `/Users/...` or Windows drive path;
- `file://` or `my.feishu.cn` URL;
- model-process preamble such as “下面是生成的报告”;
- missing closing content or a report ending mid-table;
- duplicate or absent standard disclosure.

Also test verifier JSON rejection for unknown severity, missing code/message, non-array diagnostics, and `passed: true` with a blocking diagnostic.

- [ ] **Step 3: Run validator tests and verify red**

Run: `node --test tests/meeting-validator.test.mjs`

Expected: FAIL because the prompt and validator modules do not exist.

- [ ] **Step 4: Implement exact prompt builders**

Use three explicit message builders. The analysis/repair response is plain Markdown; verification is JSON. The technical wrapper must include:

```js
export const ANALYSIS_CONTRACT_VERSION = 1;

const TECHNICAL_CONTRACT = `
输出一份完整 Markdown 文档，顶部必须是合法 YAML frontmatter。
publish_id 只能使用调用方给出的固定值。
不要联网补充事实；不要输出本地路径、飞书私有链接或大段原文。
转写疑点必须标记为不确定，不得擅自纠正。
【进一步推演】不得伪装成机构原话。
不要介绍生成过程，直接输出报告。
`;
```

Delimiter labels must not interpolate absolute paths. Use the source basename and content only.

- [ ] **Step 5: Implement deterministic validation and disclosure insertion**

Parse with `parseNoteMarkdown`, validate with `validatePublicationNote`, then enforce meeting-specific fixed fields and body-function regexes. Strip neither content nor fields silently; reject invalid output with structured codes. Add the standard disclosure exactly once at the end:

```js
const DISCLOSURE = '本文基于机构会议材料进行二次研究分析；文中的【进一步推演】不代表原机构观点，不构成投资建议。';

export function ensureStandardDisclosure(markdown) {
  const withoutDuplicates = markdown.replaceAll(DISCLOSURE, '').trimEnd();
  return `${withoutDuplicates}\n\n> ${DISCLOSURE}\n`;
}
```

Use `parseVerificationResult` to validate the JSON object and normalize only the closed severity set `blocking | warning`.

- [ ] **Step 6: Run validator tests**

Run: `node --test tests/meeting-validator.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 7: Commit Task 4**

```bash
git add meeting-workflow/prompts.mjs meeting-workflow/validator.mjs tests/meeting-validator.test.mjs
git commit -m "feat: validate generated meeting reports"
```

---

### Task 5: Run two-pass generation and write reports atomically

**Files:**
- Create: `meeting-workflow/generator.mjs`
- Create: `meeting-workflow/output.mjs`
- Create: `tests/meeting-generator.test.mjs`
- Create: `tests/meeting-output.test.mjs`

**Interfaces:**
- Consumes: Task 3 client and Task 4 prompt/validator exports.
- Produces: `generateMeetingReport({ client, promptText, source, identity, vaultRoot })`.
- Generation result: `{ markdown, data, body, verification, repaired, usage }`.
- Produces: `writeMeetingReport({ vaultRoot, outputRelativePath, markdown, expectedExistingSha256 }): Promise<{ sha256, relativePath }>`.
- Produces: `inspectMeetingReport({ vaultRoot, outputRelativePath }): Promise<{ exists, sha256? }>`.

- [ ] **Step 1: Add failing generation-sequence tests**

Use a scripted fake client and assert these exact paths:

1. valid draft → verifier passes → two calls, no repair;
2. deterministic draft error → one repair → verifier passes → three calls;
3. verifier blocking error → one repair → second verifier passes → four calls;
4. repaired report still deterministic-invalid → fail without a second repair;
5. second verifier still blocking → fail;
6. warnings only → return success with warnings;
7. usage totals aggregate prompt/completion/total token counts without retaining reasoning text.

```js
const result = await generateMeetingReport({
  client: scriptedClient([draftResponse, verifierPass]),
  promptText,
  source,
  identity,
  vaultRoot: fixture.vaultRoot,
});

assert.equal(result.repaired, false);
assert.equal(result.verification.passed, true);
assert.equal(result.markdown.match(/不构成投资建议/gu).length, 1);
```

- [ ] **Step 2: Run generator tests and verify red**

Run: `node --test tests/meeting-generator.test.mjs`

Expected: FAIL because `meeting-workflow/generator.mjs` does not exist.

- [ ] **Step 3: Implement the bounded generation state machine**

Use one helper that returns deterministic diagnostics instead of throwing away them. The state machine is:

```js
let draft = await requestAnalysis();
let repaired = false;

let deterministic = validateOrDiagnostics(ensureStandardDisclosure(draft));
let verification = deterministic.ok
  ? await requestVerification(deterministic.markdown)
  : { passed: false, diagnostics: deterministic.diagnostics };

if (hasBlocking(verification)) {
  draft = await requestRepair({ draft, diagnostics: verification.diagnostics });
  repaired = true;
  deterministic = validateOrDiagnostics(ensureStandardDisclosure(draft));
  if (!deterministic.ok) throw finalValidationError(deterministic.diagnostics);
  verification = await requestVerification(deterministic.markdown);
}

if (hasBlocking(verification)) throw finalValidationError(verification.diagnostics);
return buildGenerationResult({ deterministic, verification, repaired, usage });
```

Every model call goes through the injected client. Do not catch and stringify request contents.

- [ ] **Step 4: Add failing atomic-output tests**

Cover first write, inspection of missing/existing outputs, validated overwrite when the current hash equals `expectedExistingSha256`, conflict when the hash differs, missing expected target, symlink output target, output-directory symlink escape, concurrent replacement during write, and cleanup of temporary files after failure. Assert the source transcript bytes never change.

- [ ] **Step 5: Run output tests and verify red**

Run: `node --test tests/meeting-output.test.mjs`

Expected: FAIL because `meeting-workflow/output.mjs` does not exist.

- [ ] **Step 6: Implement contained atomic output writes**

Resolve `outputRelativePath` beneath the physical Vault root, require its parent to equal the configured physical output directory, create the output directory without following symlinks, and write with `O_CREAT | O_EXCL | O_NOFOLLOW` to a same-parent temporary file. `inspectMeetingReport` uses the same containment and no-follow checks and returns only existence plus SHA-256. Before rename, compare the existing target hash to `expectedExistingSha256`:

```js
if (currentSha256 !== expectedExistingSha256) {
  throw new MeetingOutputError('Generated report changed outside the workflow', {
    code: 'output_conflict',
  });
}
```

Call `handle.sync()`, close, recheck parent/target identity, then rename. Return only the portable relative path and SHA-256.

- [ ] **Step 7: Run generator and output tests**

Run: `node --test tests/meeting-generator.test.mjs tests/meeting-output.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 8: Commit Task 5**

```bash
git add meeting-workflow/generator.mjs meeting-workflow/output.mjs tests/meeting-generator.test.mjs tests/meeting-output.test.mjs
git commit -m "feat: generate verified meeting reports"
```

---

### Task 6: Extend Publisher preparation to an exact multi-note API

**Files:**
- Modify: `publisher/lib/publish-note.mjs`
- Create: `tests/publisher-prepare-batch.test.mjs`
- Test: `tests/studio-publish.test.mjs`
- Test: `tests/publisher-cli.test.mjs`

**Interfaces:**
- Produces: `prepareNotePublications({ config, sourcePaths, expectedSourceHashes?, allowPush? }, overrides?)`, where `expectedSourceHashes` is `Map<string, string>` keyed by normalized absolute source path.
- Preserves: `prepareNotePublication({ config, sourcePath, expectedSourceHash?, allowPush? }, overrides?)`.
- Preserves: `confirmPreparedPublication(prepared, { push })` and `cancelPreparedPublication(prepared)`.

- [ ] **Step 1: Add failing exact-batch tests**

Create a Vault with two requested generated reports and one unrelated eligible note. Assert the new API scans/transforms/stages only the two requested absolute paths, builds the Vault/asset indexes once, includes both IDs in `publicPublishIds`, and returns one prepared transaction:

```js
const prepared = await prepareNotePublications({
  config,
  sourcePaths: [reportAPath, reportBPath],
  expectedSourceHashes: new Map([
    [reportAPath, hashA],
    [reportBPath, hashB],
  ]),
  allowPush: true,
}, overrides);

assert.deepEqual(
  prepared.manifest.publications.map(({ publishId }) => publishId),
  ['report-a', 'report-b'],
);
assert.equal(JSON.stringify(prepared.manifest).includes('unrelated-note'), false);
```

Add rejection tests for an empty list, duplicate path, relative path, outside-Vault path, ineligible note, changed expected hash, duplicate `publish_id`, and one invalid note causing no transaction.

- [ ] **Step 2: Run the batch test and verify red**

Run: `node --test tests/publisher-prepare-batch.test.mjs`

Expected: FAIL because `prepareNotePublications` is not exported.

- [ ] **Step 3: Refactor preparation around the batch primitive**

Extract the body of `prepareNotePublication` into the new batch function. Normalize and sort unique absolute paths, scan each with `scanCurrentNote`, validate every expected hash before transformation, build one Vault index and one asset index, and create one transaction with all transformed notes.

```js
export async function prepareNotePublication(input = {}, overrides = {}) {
  const expectedSourceHashes = input.expectedSourceHash === undefined
    ? undefined
    : new Map([[path.resolve(input.sourcePath), input.expectedSourceHash]]);
  return prepareNotePublications({
    config: input.config,
    sourcePaths: [input.sourcePath],
    expectedSourceHashes,
    allowPush: input.allowPush,
  }, overrides);
}
```

Keep the existing WeakMap context, confirmation, cancellation, cleanup, and display-manifest behavior unchanged. Use the first sorted note as the initial preview route.

- [ ] **Step 4: Run batch and compatibility tests**

Run: `node --test tests/publisher-prepare-batch.test.mjs tests/studio-publish.test.mjs tests/publisher-cli.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 5: Run the full Publisher suite**

Run: `npm run publish:test`

Expected: PASS with zero failures.

- [ ] **Step 6: Commit Task 6**

```bash
git add publisher/lib/publish-note.mjs tests/publisher-prepare-batch.test.mjs
git commit -m "feat: prepare exact multi-note publications"
```

---

### Task 7: Orchestrate one-command incremental analysis and publication preview

**Files:**
- Create: `meeting-workflow/workflow.mjs`
- Create: `meeting-workflow/cli.mjs`
- Create: `tests/meeting-workflow.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes every Task 1–6 production interface plus existing `startPublisherServer`, `confirmPreparedPublication`, and `cancelPreparedPublication`.
- Produces: `runMeetingWorkflow({ open = true, push = true }, overrides = {})`.
- Produces: `parseMeetingCliArguments(argv)` accepting only `--no-open` and `--no-push`.
- Produces result actions: `none | cancel | confirm`, with `{ generated, pending, failures }` summary.

- [ ] **Step 1: Add failing workflow tests for incremental selection and API gating**

Use injected dependencies and prove:

- first run generates every candidate sequentially;
- unchanged second run makes zero DeepSeek calls;
- prompt change regenerates every report;
- one source change regenerates one report with the same identity;
- no candidate means `DEEPSEEK_API_KEY` is not read or required;
- pending reports still open preview without an API key;
- output conflict excludes only that report;
- one generation failure does not stop other candidates;
- an ambiguous rename never creates a duplicate;
- private analysis state updates after each successful atomic output write.

Before any model call for an existing candidate, use `inspectMeetingReport` and compare it with `previousEntry.outputSha256`. An `output_conflict` is reported immediately, consumes no API tokens, and is excluded from pending publication.

```js
const result = await runMeetingWorkflow({ open: false, push: false }, {
  env: {},
  loadConfig: async () => config,
  scanMeetingInputs: async () => unchangedScan,
  createMeetingStateStore: () => stateStore,
  createDeepSeekClient: () => assert.fail('no API client for unchanged inputs'),
  prepareNotePublications: async () => preparedPending,
  startPublisherServer: fakeCancelServer,
});

assert.equal(result.action, 'cancel');
assert.equal(result.generated, 0);
assert.equal(result.pending, 2);
```

- [ ] **Step 2: Add failing exact-pending and preview safety tests**

Create state containing two validated output paths and Publisher state where one hash is already confirmed. Assert the workflow calls `scanCurrentNote` for each exact output, selects only the changed report, and passes only that absolute path plus its expected hash to `prepareNotePublications`.

Assert cancel calls `cancelPreparedPublication`, confirm calls `confirmPreparedPublication` with the chosen push flag, browser-open failure prints the URL and continues waiting, and Publisher preparation failure never starts the server.

- [ ] **Step 3: Run workflow tests and verify red**

Run: `node --test tests/meeting-workflow.test.mjs`

Expected: FAIL because `meeting-workflow/workflow.mjs` does not exist.

- [ ] **Step 4: Implement orchestration with dependency injection**

The workflow order is exact:

```js
return withMeetingWorkflowLock({ repoRoot, run: async () => {
  const config = await loadConfig({ repoRoot });
  const scan = await scanMeetingInputs(config);
  const stateStore = createMeetingStateStore({ repoRoot: config.repoRoot });
  const state = await stateStore.readState();
  const reconciliation = reconcileMeetingSources({
    sources: scan.sources,
    state,
    promptSha256: scan.prompt.sha256,
    model: config.meetingWorkflow.model,
    contractVersion: config.meetingWorkflow.contractVersion,
    outputDirRelativePath: config.meetingWorkflow.outputDirRelativePath,
  });

  if (reconciliation.candidates.length > 0) {
    const apiKey = requireApiKey(env);
    const client = createDeepSeekClient({ apiKey, ...config.meetingWorkflow });
    for (const candidate of reconciliation.candidates) {
      await generateWriteAndPersistOne(candidate, { client, stateStore });
    }
  }

  const pending = await collectExactPendingReports({ config, state: await stateStore.readState() });
  if (pending.length === 0) return noPendingResult();
  return previewExactPendingReports({ config, pending, open, push });
}});
```

`generateWriteAndPersistOne` catches only per-report errors and stores a body-free failure summary in the returned run result; it does not persist transcript/report bodies in state. `collectExactPendingReports` validates each generated output hash against meeting state before calling Publisher scanning.

- [ ] **Step 5: Add failing CLI tests**

Assert default `{ open: true, push: true }`, accepted `--no-open`/`--no-push`, rejection of `--yes`, unknown options, no positional arguments, body-free formatted errors, and partial batch exit code `2` after preview completes.

- [ ] **Step 6: Implement the safe CLI and scripts**

Add scripts:

```json
{
  "meetings:publish": "node meeting-workflow/cli.mjs",
  "meetings:test": "node --test tests/meeting-*.test.mjs tests/publisher-prepare-batch.test.mjs"
}
```

The CLI prints candidate counts, generated/failed basenames, token totals, preview URL, and recovery guidance. It never prints prompts, transcript bodies, reports, keys, or absolute Vault paths. Use the same platform browser commands as `publisher/cli.mjs`; do not shell-interpolate the URL.

- [ ] **Step 7: Run workflow and CLI tests**

Run: `node --test tests/meeting-workflow.test.mjs`

Expected: PASS with zero failures.

Run: `npm run meetings:test`

Expected: PASS with zero failures.

- [ ] **Step 8: Commit Task 7**

```bash
git add meeting-workflow/workflow.mjs meeting-workflow/cli.mjs tests/meeting-workflow.test.mjs package.json
git commit -m "feat: add meeting analysis command"
```

---

### Task 8: Show safe analysis and partial-batch status in the Publisher preview

**Files:**
- Create: `meeting-workflow/preview.mjs`
- Create: `tests/meeting-preview.test.mjs`
- Modify: `meeting-workflow/workflow.mjs`
- Modify: `publisher/public/index.html`
- Modify: `publisher/public/app.js`
- Modify: `publisher/public/styles.css`

**Interfaces:**
- Produces: `annotateMeetingDisplayManifest({ manifest, reports, failures })`.
- Annotation shape: top-level `analysisBatch` and per-publication `analysis`.
- `analysisBatch`: `{ partial: boolean, generated: number, failed: number, failures: [{ sourceBasename, code }] }`.
- `publication.analysis`: `{ sourceBasename, outputRelativePath, verificationStatus, warningCount, summary, publicRoute }`.

- [ ] **Step 1: Add failing annotation privacy tests**

Assert the function clones rather than mutates the Publisher display manifest, joins annotations by `publishId`, and rejects/omits absolute paths, transcript bodies, report bodies, source hashes, and model reasoning:

```js
const display = annotateMeetingDisplayManifest({ manifest, reports, failures });
assert.deepEqual(display.publications[0].analysis, {
  sourceBasename: '20260808高盛闭门会.md',
  outputRelativePath: '10_资料库/闭门会/AI分析报告/report-a.md',
  verificationStatus: 'passed',
  warningCount: 1,
  summary: 'AI资本开支仍强，但信用供给成为新的约束。',
  publicRoute: '/blog/report-a/',
});
assert.equal(JSON.stringify(display).includes('/Users/'), false);
```

- [ ] **Step 2: Add failing UI contract tests**

Load the static HTML/JS/CSS and assert the UI has a partial-batch warning region, analysis metadata elements created with `textContent`, status classes, and no `innerHTML`. Assert ordinary Publisher manifests without `analysisBatch` retain the current UI.

- [ ] **Step 3: Run preview tests and verify red**

Run: `node --test tests/meeting-preview.test.mjs`

Expected: FAIL because `meeting-workflow/preview.mjs` and the UI contract do not exist.

- [ ] **Step 4: Implement safe manifest annotations**

Clone the display manifest and append only the whitelisted fields above. Validate `outputRelativePath` as portable and relative, reduce failures to basename + code, and derive `publicRoute` from `publishId`.

- [ ] **Step 5: Render meeting metadata without changing ordinary Publisher behavior**

Add a hidden-by-default batch warning section to `publisher/public/index.html`. In `publisher/public/app.js`, reveal it only when `state.manifest.analysisBatch?.partial` is true. For each annotated publication, append source basename, verification badge, warning count, summary, and route using the existing `textElement` helper and `textContent` only.

Add responsive styles under `.analysis-*` and `.batch-warning`; do not weaken existing CSP or iframe sandboxing.

- [ ] **Step 6: Pass annotated manifest from the workflow**

After `prepareNotePublications`, call:

```js
const displayManifest = annotateMeetingDisplayManifest({
  manifest: prepared.manifest,
  reports: pending,
  failures,
});

await startPublisherServer({
  previewRoot: prepared.previewRoot,
  route: prepared.route,
  manifest: displayManifest,
  allowPush: push,
  onConfirm: ({ push: confirmedPush }) =>
    confirmPreparedPublication(prepared, { push: confirmedPush }),
  onCancel: () => cancelPreparedPublication(prepared),
});
```

Do not mutate `prepared.manifest`; confirmation continues to use the private transaction context.

- [ ] **Step 7: Run preview, workflow, and Publisher UI tests**

Run: `node --test tests/meeting-preview.test.mjs tests/meeting-workflow.test.mjs tests/publisher-cli.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 8: Commit Task 8**

```bash
git add meeting-workflow/preview.mjs meeting-workflow/workflow.mjs tests/meeting-preview.test.mjs publisher/public/index.html publisher/public/app.js publisher/public/styles.css
git commit -m "feat: show meeting analysis preview status"
```

---

### Task 9: Add end-to-end coverage, operating documentation, and final verification

**Files:**
- Create: `tests/meeting-e2e.test.mjs`
- Modify: `README.md`
- Modify: `publisher/README.md`

**Interfaces:**
- Consumes the final `npm run meetings:publish` command and every earlier module.
- Produces documented setup/recovery steps and end-to-end evidence without real subscribed fixture content.

- [ ] **Step 1: Add a synthetic end-to-end cancellation test**

Build a temporary Vault with two synthetic transcripts, the real prompt filename containing a short synthetic prompt, and a temporary cloned repository. Inject a deterministic fake DeepSeek transport that returns valid reports and verifier JSON. Exercise the real scanner, state, output, exact multi-note preparation, transaction preview, and cancellation.

Assert:

```js
assert.equal(modelCalls.length, 4, 'two drafts plus two verification calls');
assert.equal(await exists(reportAPath), true);
assert.equal(await exists(reportBPath), true);
assert.deepEqual(await trackedRepositorySnapshot(repoRoot), beforeTrackedSnapshot);
assert.equal(await exists(path.join(repoRoot, '.meeting-analysis-state.json')), true);
assert.equal(serializedLogs.includes('SYNTHETIC PRIVATE TRANSCRIPT BODY'), false);
```

- [ ] **Step 2: Extend the end-to-end test for rerun and exact confirmation**

Rerun after cancellation with an empty environment and a fake client that fails if constructed. Assert zero model calls and the same two reports enter preview. Then confirm without push and assert the created Git commit contains exactly:

```text
src/content/entries/synthetic-meeting-a.md
src/content/entries/synthetic-meeting-b.md
```

Modify one synthetic source, rerun, and assert one generation + one verification call and one updated public target. Modify the synthetic prompt and assert both reports regenerate. Make one verifier fail after repair and assert the preview is visibly partial and contains only the valid report.

- [ ] **Step 3: Run the end-to-end test and verify red/green**

Run before completing the fixture: `node --test tests/meeting-e2e.test.mjs`

Expected before implementation completion: FAIL at the first unmet end-to-end assertion.

Run after completing the fixture: `node --test tests/meeting-e2e.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 4: Document local configuration and the daily command**

Document in `README.md` and `publisher/README.md`:

- the zsh commands below, which read the key without echoing or storing it in a file;

  ```zsh
  read -s "DEEPSEEK_API_KEY?DeepSeek API key: "
  export DEEPSEEK_API_KEY
  ```
- `npm run meetings:publish`;
- which files are scanned and excluded;
- full-input, no-chunk behavior;
- two-pass verification and single repair attempt;
- generated report location;
- prompt/source/model hash invalidation;
- machine-managed output conflict recovery;
- cancel/rerun without another API call;
- partial batch behavior;
- Confirm & Push, Confirm without Push, and Cancel;
- missing key, API failure, invalid output, build conflict, commit failure, and push failure recovery;
- assurance that raw transcripts and private URLs are not published.

- [ ] **Step 5: Run focused workflow and Publisher suites**

Run: `npm run meetings:test`

Expected: PASS with zero failed tests.

Run: `npm run publish:test`

Expected: PASS with zero failed tests.

- [ ] **Step 6: Run the full repository test suite and production build**

Run: `npm test`

Expected: PASS with zero failed tests.

Run: `npm run build`

Expected: Astro completes successfully with no content-schema or route-generation failure.

Run: `git diff --check`

Expected: no output and exit code `0`.

- [ ] **Step 7: Perform a redacted manual preview smoke test**

Create temporary synthetic inputs outside the real Vault, point a temporary local config at them, use a test DeepSeek-compatible stub, run `npm run meetings:publish -- --no-push`, open the loopback URL, inspect desktop and narrow-window layouts, and click Cancel.

Expected: the preview shows both articles, verification status, summaries, routes, exact file operations, and no absolute path or transcript body; Cancel leaves tracked repository content unchanged.

- [ ] **Step 8: Optionally exercise the real four-file workflow without publication**

Only when `DEEPSEEK_API_KEY` is present and the user is ready to incur API usage, run:

```bash
npm run meetings:publish -- --no-push
```

Expected: four validated reports appear under `10_资料库/闭门会/AI分析报告`, one local batch preview opens, and clicking Cancel leaves the blog repository unpublished while retaining the four private reports. If the key is absent, record this optional live check as not run; automated synthetic coverage remains mandatory.

- [ ] **Step 9: Inspect final scope and commit Task 9**

Run: `git status --short`

Run: `git diff --stat`

Run: `git diff --check`

Expected: only meeting-workflow implementation, exact Publisher extensions, tests, configuration example, ignore rules, package scripts, and documentation are part of this feature; known unrelated user changes remain unstaged.

```bash
git add tests/meeting-e2e.test.mjs README.md publisher/README.md
git commit -m "docs: complete meeting analysis workflow"
```

---

## Final Review Gate

- [ ] Review every changed file against the design's privacy boundary: no transcript body, private URL, absolute Vault path, key, or reasoning content can enter Git, logs, display manifests, or public Markdown.
- [ ] Review filesystem operations for containment, symlink rejection, atomic writes, output conflict behavior, stale lock recovery, and source immutability.
- [ ] Review incremental behavior for source edit, prompt edit, model/contract edit, same-hash rename, ambiguous rename, canceled preview, and partial generation failure.
- [ ] Review exact Publisher scope so only generated report paths reach `prepareNotePublications` and unrelated eligible notes remain untouched.
- [ ] Run fresh `npm run meetings:test`, `npm run publish:test`, `npm test`, `npm run build`, and `git diff --check` after the final review fixes.
- [ ] Inspect `git status --short` and every feature commit to confirm unrelated existing files were never staged.
