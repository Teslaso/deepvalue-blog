# Deep Value Writing Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a loopback-only Web writing studio that edits Markdown inside configured Obsidian publishing directories, renders an immediate blog-style preview, and hands the saved note to the existing two-stage Publisher transaction.

**Architecture:** Extend the existing Publisher with focused workspace, document, attachment, preview, and studio-server modules. The browser client is a small CodeMirror application bundled into a temporary runtime directory with esbuild; it never becomes part of the public Astro build. Existing Publisher validation, transformation, preview, Git transaction, and confirmation code remain the only implementation of publication.

**Tech Stack:** Node.js 22.12+, native `node:http`, CodeMirror 6, esbuild, `marked`, `sanitize-html`, existing `gray-matter`, `yaml`, Astro 6, Node test runner.

## Global Constraints

- The Obsidian Vault Markdown file is the only source of truth.
- The studio listens only on `127.0.0.1`; no LAN or public binding option is added.
- Only configured publishing workspaces and the configured attachment destination are readable or writable.
- The entire Vault is never indexed or exposed.
- Every write uses an atomic same-directory replacement and external-change conflict detection.
- Publication remains two-stage: prepare and inspect, then explicit confirm-and-push or confirm-local.
- Existing `publish:current` and `publish:pending` CLI behavior remains unchanged.
- The studio API and assets must never appear in the production Astro output.
- `publish_id` is stable after first assignment and is never regenerated from a changed title.
- No AI writing, cloud sync, collaboration, delete-file action, or desktop wrapper is included.
- Do not stage or commit `.DS_Store`, `.claude/settings.local.json`, `handoff/`, `.superpowers/`, `publish.config.local.json`, or runtime studio data.

---

## File Structure

### Configuration and storage

- Modify `publish.config.example.json` — document `studioWorkspaces` and `studioAttachmentRoot`.
- Modify `publisher/lib/config.mjs` — validate and resolve studio paths inside the Vault.
- Create `publisher/lib/studio-paths.mjs` — reusable lexical and physical containment checks.
- Create `publisher/lib/studio-workspace.mjs` — scan allowed Markdown files and derive editor status.
- Create `publisher/lib/studio-document.mjs` — read, create, rename, and atomically save notes with conflict detection.
- Create `publisher/lib/studio-frontmatter.mjs` — preserve unknown YAML fields while applying structured form changes.
- Create `publisher/lib/studio-attachments.mjs` — validate and write pasted image bytes.

### Preview and publication

- Create `publisher/lib/studio-preview.mjs` — render and sanitize immediate Markdown previews.
- Create `publisher/lib/publish-note.mjs` — extract the existing single-note transaction orchestration from `cli.mjs`.
- Modify `publisher/cli.mjs` — call `prepareNotePublication()` without behavior changes.
- Create `publisher/lib/studio-publish.mjs` — maintain at most one prepared transaction per studio session and expose prepare/confirm/cancel.

### Server and browser client

- Create `publisher/studio-server.mjs` — loopback HTTP server, token validation, API routing, and static assets.
- Create `publisher/studio.mjs` — executable entrypoint that loads config, builds client assets, starts the server, and opens the browser.
- Create `publisher/build-studio.mjs` — esbuild entrypoint for runtime browser assets.
- Create `publisher/studio/client/index.js` — application state and API coordination.
- Create `publisher/studio/client/editor.js` — CodeMirror setup, shortcuts, outline, and change events.
- Create `publisher/studio/client/ui.js` — file list, metadata form, preview, conflict, and publish views.
- Create `publisher/studio/client/styles.css` — confirmed Deep Value three-column interface.
- Create `publisher/studio/index.html` — semantic application shell.
- Modify `package.json` and `package-lock.json` — dependencies and `studio` / `studio:test` scripts.

### Tests and documentation

- Create `tests/studio-config.test.mjs`
- Create `tests/studio-frontmatter.test.mjs`
- Create `tests/studio-workspace.test.mjs`
- Create `tests/studio-document.test.mjs`
- Create `tests/studio-attachments.test.mjs`
- Create `tests/studio-preview.test.mjs`
- Create `tests/studio-server.test.mjs`
- Create `tests/studio-publish.test.mjs`
- Create `tests/studio-e2e.test.mjs`
- Modify `publisher/README.md`
- Modify `README.md`
- Modify `.gitignore`

---

### Task 1: Studio configuration and contained paths

**Files:**
- Create: `publisher/lib/studio-paths.mjs`
- Modify: `publisher/lib/config.mjs`
- Modify: `publish.config.example.json`
- Test: `tests/studio-config.test.mjs`

**Interfaces:**
- Consumes: existing `validatePublishConfig(rawConfig, options)`.
- Produces:
  - `isPathInside(root: string, candidate: string, options?: { allowRoot?: boolean }): boolean`
  - `resolveExistingContainedPath({ root, rawPath, label, allowRoot? }): Promise<string>`
  - `resolveMissingContainedPath({ root, rawPath, label, allowRoot? }): Promise<string>`
  - `config.studioWorkspaces: Array<{ id: string, label: string, path: string }>`
  - `config.studioAttachmentRoot: string`

- [ ] **Step 1: Write failing configuration and path-containment tests**

```js
test('validatePublishConfig resolves studio workspaces and one attachment destination', async () => {
  const config = await validatePublishConfig({
    ...validConfig(fixture.vaultRoot),
    studioWorkspaces: [
      { id: 'research', label: '产业研究', path: 'Publishing/Research' },
    ],
    studioAttachmentRoot: 'Attachments/Studio',
  }, { repoRoot: fixture.repoRoot });

  assert.deepEqual(config.studioWorkspaces, [{
    id: 'research',
    label: '产业研究',
    path: path.join(fixture.vaultRoot, 'Publishing/Research'),
  }]);
  assert.equal(
    config.studioAttachmentRoot,
    path.join(fixture.vaultRoot, 'Attachments/Studio'),
  );
});

test('studio paths reject duplicates, traversal, absolute paths, and symlink escapes', async () => {
  await assert.rejects(
    validatePublishConfig({
      ...validConfig(fixture.vaultRoot),
      studioWorkspaces: [
        { id: 'research', label: '研究', path: '../Private' },
        { id: 'research', label: '重复', path: 'Publishing/Other' },
      ],
      studioAttachmentRoot: 'Escaped',
    }, { repoRoot: fixture.repoRoot }),
    (error) => error.diagnostics.some(({ code }) => code === 'path_escape'),
  );
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/studio-config.test.mjs`  
Expected: FAIL because studio configuration fields and path helpers do not exist.

- [ ] **Step 3: Implement path helpers and configuration validation**

Use physical `realpath` checks for existing workspaces. Allow the attachment leaf
to be absent only when its closest existing parent remains physically inside the
Vault. Validate workspace IDs with `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, require unique
IDs, non-empty labels, and at least one workspace.

The returned shape must be:

```js
{
  ...existingConfig,
  studioWorkspaces: [
    { id: 'research', label: '产业研究', path: '/physical/vault/Publishing/Research' },
  ],
  studioAttachmentRoot: '/physical/vault/Attachments/Studio',
}
```

- [ ] **Step 4: Update the example configuration**

```json
{
  "studioWorkspaces": [
    {
      "id": "research",
      "label": "产业研究",
      "path": "Publishing/Research"
    }
  ],
  "studioAttachmentRoot": "Attachments/Studio"
}
```

- [ ] **Step 5: Run focused and existing config tests**

Run: `node --test tests/studio-config.test.mjs tests/publisher-core.test.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add publish.config.example.json publisher/lib/config.mjs publisher/lib/studio-paths.mjs tests/studio-config.test.mjs
git commit -m "feat: configure studio workspaces"
```

---

### Task 2: Lossless frontmatter form adapter

**Files:**
- Create: `publisher/lib/studio-frontmatter.mjs`
- Test: `tests/studio-frontmatter.test.mjs`

**Interfaces:**
- Consumes: `parseNoteMarkdown()` and the `yaml` package.
- Produces:
  - `parseStudioDocument(source: string, options): { data, known, unknown, body, rawFrontmatter }`
  - `serializeStudioDocument({ source, patch, body }): string`
  - `publicationFormSchema({ domain, format }): Array<FieldDefinition>`

- [ ] **Step 1: Write failing lossless round-trip tests**

```js
test('form updates preserve unknown YAML fields and body bytes', () => {
  const source = `---
publish: false
title: 旧标题
custom_private_flag: keep-me
tags: [铜, 炼化]
---

正文  \n
`;
  const output = serializeStudioDocument({
    source,
    patch: { title: '新标题', publish: true },
    body: '\n正文  \n',
  });
  const parsed = parseYamlFrontmatter(output);
  assert.equal(parsed.data.custom_private_flag, 'keep-me');
  assert.equal(parsed.data.title, '新标题');
  assert.equal(parsed.data.publish, true);
  assert.equal(parsed.content, '\n正文  \n');
});

test('changing title never changes an existing publish_id', () => {
  const output = serializeStudioDocument({
    source: note({ publish_id: 'stable-url', title: '旧标题' }),
    patch: { title: '新标题' },
  });
  assert.equal(parseYamlFrontmatter(output).data.publish_id, 'stable-url');
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/studio-frontmatter.test.mjs`  
Expected: FAIL because the adapter is missing.

- [ ] **Step 3: Implement parsing and serialization**

Use `yaml` `Document` nodes rather than reconstructing from
`normalizeFrontmatter()`. Apply only keys present in `patch`, preserve unknown
keys and their ordering, and replace the body without trimming it.

Reject duplicate YAML keys and malformed frontmatter with
`FrontmatterParseError`. Do not silently repair malformed YAML.

- [ ] **Step 4: Define the form schema**

Return exact definitions for:

```js
[
  { name: 'publish', type: 'boolean', label: '允许发布' },
  { name: 'publish_id', type: 'slug', label: '固定网址', lockedWhenPresent: true },
  { name: 'domain', type: 'select', options: ['investment', 'ai', 'beyond'] },
  { name: 'section', type: 'select', visibleWhen: { domain: 'investment' } },
  { name: 'format', type: 'select', options: ['article', 'log'] },
  { name: 'title', type: 'text', requiredWhen: { format: 'article' } },
  { name: 'summary', type: 'textarea', requiredWhen: { format: 'article' } },
  { name: 'topic', type: 'text' },
  { name: 'source_type', type: 'select', options: ['original', 'book', 'podcast', 'report', 'news', 'mixed'] },
  { name: 'tags', type: 'string-list' },
  { name: 'commodities', type: 'string-list' },
  { name: 'companies', type: 'string-list' },
  { name: 'tickers', type: 'string-list' },
  { name: 'thesis', type: 'textarea' },
  { name: 'confidence', type: 'select', options: ['', 'low', 'medium', 'high'] },
]
```

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/studio-frontmatter.test.mjs tests/publisher-core.test.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add publisher/lib/studio-frontmatter.mjs tests/studio-frontmatter.test.mjs
git commit -m "feat: add studio frontmatter adapter"
```

---

### Task 3: Workspace index and secure document store

**Files:**
- Create: `publisher/lib/studio-workspace.mjs`
- Create: `publisher/lib/studio-document.mjs`
- Test: `tests/studio-workspace.test.mjs`
- Test: `tests/studio-document.test.mjs`

**Interfaces:**
- Consumes: normalized `config.studioWorkspaces`, `studio-paths.mjs`, and `studio-frontmatter.mjs`.
- Produces:
  - `scanStudioWorkspace(config): Promise<StudioWorkspace[]>`
  - `readStudioDocument(config, { workspaceId, relativePath }): Promise<StudioDocument>`
  - `createStudioDocument(config, input): Promise<StudioDocument>`
  - `saveStudioDocument(config, input): Promise<StudioDocument>`
  - `renameStudioDocument(config, input): Promise<StudioDocument>`

`StudioDocument` must contain:

```js
{
  workspaceId,
  relativePath,
  source,
  body,
  metadata,
  fingerprint,
  modifiedAt,
  status: 'draft' | 'ready' | 'published' | 'modified' | 'invalid',
  diagnostics: [],
}
```

- [ ] **Step 1: Write failing workspace scan tests**

Cover:

- only `.md` files under configured workspaces;
- ignored dot-directories and symlinks;
- stable POSIX relative paths;
- malformed YAML returned as `invalid` without exposing body in diagnostics;
- sorting by modification time descending;
- search fields limited to filename, public title, topic, and tags.

```js
const workspaces = await scanStudioWorkspace(config);
assert.deepEqual(
  workspaces[0].documents.map(({ relativePath }) => relativePath),
  ['Recent.md', 'Nested/Older.md'],
);
assert.equal(workspaces[0].documents.some(({ relativePath }) => relativePath.includes('Private')), false);
```

- [ ] **Step 2: Write failing document conflict and atomicity tests**

```js
const opened = await readStudioDocument(config, id);
await writeFile(sourcePath, externalVersion);

await assert.rejects(
  saveStudioDocument(config, {
    ...id,
    source: browserVersion,
    expectedFingerprint: opened.fingerprint,
  }),
  (error) => error.code === 'external_change',
);
assert.equal(await readFile(sourcePath, 'utf8'), externalVersion);
```

Also simulate a failed rename of the temporary file and assert the original
document remains byte-identical.

- [ ] **Step 3: Run tests and verify RED**

Run: `node --test tests/studio-workspace.test.mjs tests/studio-document.test.mjs`  
Expected: FAIL because the modules are missing.

- [ ] **Step 4: Implement workspace scanning**

Use `readdir({ withFileTypes: true })`, never follow symlinked files or
directories, and validate the physical path again before reading. Return only
metadata needed by the list; never return every document body in the index.

- [ ] **Step 5: Implement document reads and atomic saves**

Fingerprint exact UTF-8 source bytes with SHA-256. Save by:

1. opening and rechecking the physical source identity;
2. comparing `expectedFingerprint`;
3. writing mode `0o600` to a randomized temporary sibling;
4. syncing and closing the temporary handle;
5. renaming it over the original;
6. removing the temporary sibling on failure.

New documents must use a safe filename derived from the user title and add a
numeric suffix on collision. Renames stay in the same configured workspace.

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/studio-workspace.test.mjs tests/studio-document.test.mjs`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add publisher/lib/studio-workspace.mjs publisher/lib/studio-document.mjs tests/studio-workspace.test.mjs tests/studio-document.test.mjs
git commit -m "feat: add studio document workspace"
```

---

### Task 4: Safe attachment ingestion

**Files:**
- Create: `publisher/lib/studio-attachments.mjs`
- Test: `tests/studio-attachments.test.mjs`

**Interfaces:**
- Consumes: `config.studioAttachmentRoot` and `studio-paths.mjs`.
- Produces:
  - `saveStudioAttachment(config, { bytes, filename, mimeType, alt }): Promise<StudioAttachment>`

```js
{
  relativePath: 'Attachments/Studio/refining-margin-3f90a822.png',
  embed: '![[Attachments/Studio/refining-margin-3f90a822.png|炼化利润图]]',
  size: 184220,
  sha256: '...',
}
```

- [ ] **Step 1: Write failing attachment tests**

Test PNG, JPEG, WebP, AVIF, and GIF magic bytes; reject MIME-only spoofing,
SVG, PDF, audio, empty input, files above 20 MiB, path traversal, and a
symlinked attachment destination. Test identical names and identical bytes.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/studio-attachments.test.mjs`  
Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement validated writes**

Determine the extension from magic bytes, sanitize the basename to Unicode
letters/numbers/hyphens, add the first eight SHA-256 characters, and atomically
write the file. If the exact destination already contains identical bytes,
reuse it. Never overwrite different bytes.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/studio-attachments.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add publisher/lib/studio-attachments.mjs tests/studio-attachments.test.mjs
git commit -m "feat: ingest studio attachments safely"
```

---

### Task 5: Immediate Markdown preview

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `publisher/lib/studio-preview.mjs`
- Test: `tests/studio-preview.test.mjs`

**Interfaces:**
- Consumes: Markdown body, structured metadata, `marked`, and `sanitize-html`.
- Produces:
  - `renderStudioPreview({ body, metadata, resolveAsset, resolveWikiLink }): Promise<{ html, outline, diagnostics }>`

- [ ] **Step 1: Install preview dependencies**

Run:

```bash
npm install marked@18.0.7 sanitize-html@2.17.6
```

Expected: `package.json` and lockfile contain exact compatible dependency ranges.

- [ ] **Step 2: Write failing rendering and sanitization tests**

Cover headings, lists, tables, code fences, footnotes supported by the selected
renderer, callouts, images, published wiki links, unpublished wiki links,
blocked raw scripts, `javascript:` URLs, inline event handlers, and outline IDs.

```js
const preview = await renderStudioPreview({
  body: '# 标题\n\n<script>alert(1)</script>\n\n[[Private Note]]',
  metadata: { title: '标题' },
  resolveWikiLink: () => ({ kind: 'plain-text', label: 'Private Note' }),
});
assert.doesNotMatch(preview.html, /script|alert|javascript:/i);
assert.match(preview.html, />Private Note</);
```

- [ ] **Step 3: Run tests and verify RED**

Run: `node --test tests/studio-preview.test.mjs`  
Expected: FAIL because the renderer is missing.

- [ ] **Step 4: Implement renderer**

Transform Obsidian callouts, wiki links, and embeds before passing Markdown to
`marked`. Sanitize using an explicit allowlist for the elements and attributes
already supported by the blog. Never allow `style`, event attributes, `iframe`,
`object`, `svg`, or active URL schemes.

Generate deterministic heading IDs and return:

```js
outline: [{ depth: 2, text: '炼化利润', id: '炼化利润' }]
```

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/studio-preview.test.mjs tests/publisher-transform.test.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json publisher/lib/studio-preview.mjs tests/studio-preview.test.mjs
git commit -m "feat: render safe studio previews"
```

---

### Task 6: Reusable single-note publication bridge

**Files:**
- Create: `publisher/lib/publish-note.mjs`
- Create: `publisher/lib/studio-publish.mjs`
- Modify: `publisher/cli.mjs`
- Test: `tests/studio-publish.test.mjs`
- Test: `tests/publisher-cli.test.mjs`

**Interfaces:**
- Consumes: existing scanner, transformer, state store, transaction, build, Git, and preview modules.
- Produces:
  - `prepareNotePublication({ config, sourcePath, openBrowser?, allowPush? }): Promise<PreparedPublication>`
  - `createStudioPublisher({ config }): StudioPublisher`
  - `StudioPublisher.prepare({ workspaceId, relativePath, expectedFingerprint })`
  - `StudioPublisher.confirm({ transactionId, push })`
  - `StudioPublisher.cancel({ transactionId })`

- [ ] **Step 1: Write failing CLI parity tests**

Inject fake scanner/build/open functions into `prepareNotePublication()` and
assert the manifest, route, confirmation result, and recovery output match the
current `publish:current` orchestration.

- [ ] **Step 2: Write failing studio transaction-state tests**

Cover:

- saved fingerprint required;
- only one active prepared transaction;
- wrong transaction ID rejected;
- prepare does not apply repository changes;
- confirm invokes the existing transaction exactly once;
- cancel cleans staging;
- second confirmation fails closed.

- [ ] **Step 3: Run tests and verify RED**

Run: `node --test tests/studio-publish.test.mjs tests/publisher-cli.test.mjs`  
Expected: FAIL because the bridge is missing.

- [ ] **Step 4: Extract single-note orchestration**

Move behavior, not safety checks, from `cli.mjs` into `publish-note.mjs`.
`cli.mjs current` must remain a thin adapter that passes the command-line source
and handles terminal output/opening exactly as before.

- [ ] **Step 5: Implement studio publication state**

Keep the prepared transaction in process memory. Return only:

```js
{
  transactionId,
  manifest,
  route,
  previewRoot,
  preparedAt,
}
```

Do not expose staging filesystem paths or source bodies to the browser.

- [ ] **Step 6: Run focused and existing publisher tests**

Run:

```bash
node --test tests/studio-publish.test.mjs tests/publisher-cli.test.mjs tests/publisher-transaction.test.mjs tests/publisher-e2e.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add publisher/lib/publish-note.mjs publisher/lib/studio-publish.mjs publisher/cli.mjs tests/studio-publish.test.mjs tests/publisher-cli.test.mjs
git commit -m "refactor: expose publisher to writing studio"
```

---

### Task 7: Loopback studio server and authenticated API

**Files:**
- Create: `publisher/studio-server.mjs`
- Create: `publisher/studio.mjs`
- Create: `publisher/studio/index.html`
- Test: `tests/studio-server.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces:
  - `startStudioServer({ config, publicRoot, openBrowser }): Promise<{ url, close, result }>`
  - authenticated JSON routes under `/_studio/api/`

Required routes:

```text
GET  /_studio/
GET  /_studio/assets/*
GET  /_studio/api/workspaces
GET  /_studio/api/document?workspaceId=&path=
POST /_studio/api/document
PUT  /_studio/api/document
POST /_studio/api/document/rename
POST /_studio/api/attachment
POST /_studio/api/preview
POST /_studio/api/publish/prepare
POST /_studio/api/publish/confirm
POST /_studio/api/publish/cancel
GET  /_studio/final-preview/*
```

- [ ] **Step 1: Write failing HTTP security tests**

Cover:

- bind host is exactly `127.0.0.1`;
- wrong `Host` returns 421;
- missing/invalid session token returns 403 on API routes;
- mutation routes reject GET and return `Allow`;
- request body limit is 25 MiB for attachments and 2 MiB for JSON;
- invalid JSON returns 400;
- paths outside the API return 404;
- CSP forbids external connections, frames, objects, and inline scripts;
- error responses never contain Vault bodies or stack traces.

- [ ] **Step 2: Write failing API behavior tests**

Exercise workspaces, open, save, conflict, attachment, preview, prepare, confirm,
and cancel using injected fake modules. Assert exact status codes:

```text
200 success
201 document or attachment created
400 malformed request
403 invalid token
404 unknown document
409 external conflict or used transaction
413 request too large
422 publication validation error
500 internal failure with safe public message
```

- [ ] **Step 3: Run tests and verify RED**

Run: `node --test tests/studio-server.test.mjs`  
Expected: FAIL because the server is missing.

- [ ] **Step 4: Implement the server**

Generate a 32-byte base64url session token and embed it in the served HTML as
escaped JSON. Use strict host checking and constant-time token comparison.
Read request bodies incrementally and destroy over-limit requests.

Do not reuse the one-shot publish confirmation token as the studio session
token. The studio token authenticates local API calls; the publication object
still enforces single-use confirm/cancel.

- [ ] **Step 5: Implement the executable**

`publisher/studio.mjs` must:

1. load `publish.config.local.json`;
2. build temporary browser assets;
3. start the loopback server;
4. open the authenticated URL unless `--no-open`;
5. print the URL for recovery;
6. close cleanly on SIGINT/SIGTERM.

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/studio-server.test.mjs`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add publisher/studio-server.mjs publisher/studio.mjs publisher/studio/index.html tests/studio-server.test.mjs
git commit -m "feat: serve authenticated writing studio"
```

---

### Task 8: CodeMirror client bundle and editor foundation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `publisher/build-studio.mjs`
- Create: `publisher/studio/client/editor.js`
- Create: `publisher/studio/client/index.js`
- Test: `tests/studio-client-build.test.mjs`

**Interfaces:**
- Consumes: studio API from Task 7.
- Produces:
  - `buildStudioAssets({ outputDir }): Promise<{ jsPath, cssPath }>`
  - `createMarkdownEditor({ parent, value, onChange, onPasteImage }): StudioEditor`

`StudioEditor`:

```js
{
  getValue(): string,
  setValue(value: string): void,
  insertText(value: string): void,
  focus(): void,
  destroy(): void,
  getOutline(): Array<{ depth, text, line }>,
}
```

- [ ] **Step 1: Install exact editor and bundler dependencies**

Run:

```bash
npm install @codemirror/commands@6.10.4 @codemirror/lang-markdown@6.5.1 @codemirror/search@6.7.1 @codemirror/state@6.7.1 @codemirror/view@6.43.7
npm install --save-dev esbuild@0.28.1
```

- [ ] **Step 2: Write failing bundle test**

```js
const result = await buildStudioAssets({ outputDir });
assert.equal(await fileExists(result.jsPath), true);
assert.equal(await fileExists(result.cssPath), true);
assert.doesNotMatch(await readFile(result.jsPath, 'utf8'), /from ["']@codemirror/);
```

Also assert the output directory is outside `dist/`, `public/`, and tracked
Publisher source paths.

- [ ] **Step 3: Run the test and verify RED**

Run: `node --test tests/studio-client-build.test.mjs`  
Expected: FAIL because the build entrypoint is missing.

- [ ] **Step 4: Implement the editor**

Configure:

- Markdown language mode;
- history, undo/redo;
- search;
- line highlighting;
- bracket matching;
- line wrapping;
- `Mod-s` save event;
- toolbar commands for heading, bold, italic, quote, link, image;
- paste/drop image interception before default insertion;
- 150ms change callback debounce;
- outline extraction from ATX headings.

- [ ] **Step 5: Implement the runtime asset build**

Bundle JavaScript and CSS with esbuild into a `mkdtemp()` directory under the
OS temporary directory. Use `bundle: true`, `format: 'esm'`,
`platform: 'browser'`, `target: ['es2022']`, and source maps only when
`NODE_ENV !== 'production'`.

- [ ] **Step 6: Run focused test**

Run: `node --test tests/studio-client-build.test.mjs`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json publisher/build-studio.mjs publisher/studio/client/editor.js publisher/studio/client/index.js tests/studio-client-build.test.mjs
git commit -m "feat: add markdown studio client"
```

---

### Task 9: Confirmed three-column UI and metadata workflow

**Files:**
- Create: `publisher/studio/client/ui.js`
- Create: `publisher/studio/client/styles.css`
- Modify: `publisher/studio/client/index.js`
- Modify: `publisher/studio/index.html`
- Test: `tests/studio-ui-contract.test.mjs`

**Interfaces:**
- Consumes: Task 8 editor and Task 7 API.
- Produces:
  - `createStudioUI({ root, api, editor }): StudioUI`
  - complete accessible DOM contracts identified by `data-testid`.

- [ ] **Step 1: Write failing static UI contract tests**

Assert the shell contains:

```text
data-testid="studio-shell"
data-testid="document-list"
data-testid="metadata-panel"
data-testid="markdown-editor"
data-testid="instant-preview"
data-testid="save-status"
data-testid="prepare-publish"
data-testid="publish-review"
data-testid="conflict-dialog"
```

Assert buttons have Chinese accessible names, status containers use
`role="status"` or `aria-live`, and editor/preview mobile tabs are real buttons
with `aria-selected`.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/studio-ui-contract.test.mjs`  
Expected: FAIL because the finished shell does not exist.

- [ ] **Step 3: Implement the confirmed visual system**

Use the production Deep Value tokens:

```css
--color-ink: #0b0c0b;
--color-paper: #d8cfbd;
--color-copper: #a46743;
--color-olive: #777b68;
--font-editorial: "Songti SC", "STSong", "Noto Serif CJK SC", Georgia, serif;
--font-data: "Space Mono", "SFMono-Regular", Consolas, monospace;
```

Desktop:

- 280–320px document column;
- flexible editor column with minimum 400px;
- flexible preview column with minimum 430px;
- dark top bar, warm-paper work surfaces, straight rules, 0–2px radii.

Below 720px:

- only one of documents/editor/preview is visible;
- tab buttons change panels;
- no page-level horizontal overflow;
- prepare-publish remains reachable.

- [ ] **Step 4: Implement document and metadata interactions**

Provide:

- workspace and status filters;
- filename/title/tag search;
- create and rename, but no delete;
- collapsible metadata panel;
- structured fields from `publicationFormSchema()`;
- explicit unlock confirmation before changing an existing `publish_id`;
- auto-save after one second idle;
- visible saving/saved/error/conflict states.

- [ ] **Step 5: Implement preview and outline interactions**

Send preview requests after 150ms idle, discard stale responses by monotonically
increasing request ID, render only sanitized server HTML, and update the outline.
Desktop/mobile preview width controls affect only the preview canvas.

- [ ] **Step 6: Implement attachment paste and drag**

Post the binary file with explicit filename, MIME type, and alt text, then insert
the returned `embed` at the current CodeMirror selection. Show a recoverable
message containing `relativePath` when upload succeeds but insertion fails.

- [ ] **Step 7: Run focused tests and build**

Run:

```bash
node --test tests/studio-ui-contract.test.mjs tests/studio-client-build.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add publisher/studio/client/ui.js publisher/studio/client/styles.css publisher/studio/client/index.js publisher/studio/index.html tests/studio-ui-contract.test.mjs
git commit -m "feat: build Deep Value writing interface"
```

---

### Task 10: Publish review, conflict resolution, and recovery UI

**Files:**
- Modify: `publisher/studio/client/index.js`
- Modify: `publisher/studio/client/ui.js`
- Modify: `publisher/studio/client/styles.css`
- Test: `tests/studio-ui-contract.test.mjs`
- Test: `tests/studio-publish.test.mjs`

**Interfaces:**
- Consumes: document conflict payload and `StudioPublisher`.
- Produces:
  - conflict view with disk/browser source comparison;
  - publish review drawer with final iframe, manifest, and actions;
  - retry-push state for a retained local commit.

- [ ] **Step 1: Write failing conflict UI tests**

Assert a 409 save response:

- stops auto-save;
- preserves browser source;
- renders disk and browser fingerprints;
- exposes “重新载入磁盘版本”, “打开对比”, and “保留网页版本”;
- disables prepare publish until resolved.

- [ ] **Step 2: Write failing publish review tests**

Assert:

- prepare forces save first;
- validation diagnostics focus the metadata field or editor line;
- successful prepare shows final route, iframe, publications, and exact files;
- confirm buttons appear only after prepare;
- buttons lock after one action;
- push failure shows retained commit and one retry action;
- cancel returns to editing without changing the note.

- [ ] **Step 3: Run tests and verify RED**

Run: `node --test tests/studio-ui-contract.test.mjs tests/studio-publish.test.mjs`  
Expected: FAIL on missing states.

- [ ] **Step 4: Implement conflict resolution**

“保留网页版本” must call a separate force-save endpoint with both the stale and
current disk fingerprints and require a confirm dialog. The server performs one
last comparison before overwrite; it never accepts a boolean `force: true`
without both fingerprints.

- [ ] **Step 5: Implement final publish review**

The review view must reuse the manifest terminology from the existing
Publisher:

- 待发布笔记;
- 文件与差异清单;
- 真实目标路由;
- 确认并推送;
- 仅确认，不推送;
- 取消发布.

Use a sandboxed same-origin iframe for the built target. Do not inject the final
HTML into the studio DOM.

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/studio-ui-contract.test.mjs tests/studio-publish.test.mjs tests/studio-server.test.mjs`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add publisher/studio/client/index.js publisher/studio/client/ui.js publisher/studio/client/styles.css tests/studio-ui-contract.test.mjs tests/studio-publish.test.mjs
git commit -m "feat: review and confirm studio publications"
```

---

### Task 11: End-to-end workflow, commands, and documentation

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `publisher/README.md`
- Modify: `README.md`
- Create: `tests/studio-e2e.test.mjs`

**Interfaces:**
- Consumes: complete studio.
- Produces:
  - `npm run studio`
  - `npm run studio -- --no-open`
  - `npm run studio:test`

- [ ] **Step 1: Write the failing end-to-end test**

Create temporary repo/Vault fixtures and exercise:

1. scan one configured workspace while a private note outside it remains invisible;
2. create and save an article;
3. externally modify it and receive a conflict;
4. resolve using the disk version;
5. upload a PNG and insert the returned embed;
6. render immediate preview;
7. prepare publication without repository changes;
8. fetch the real Astro preview route;
9. confirm local publication;
10. assert only exact entry and media targets are committed;
11. assert private note text never appears in responses, logs, state, or Git.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/studio-e2e.test.mjs`  
Expected: FAIL until commands and final integration are complete.

- [ ] **Step 3: Add package scripts**

```json
{
  "studio": "node publisher/studio.mjs",
  "studio:test": "node --test tests/studio-*.test.mjs"
}
```

- [ ] **Step 4: Update ignore rules**

Add:

```gitignore
.superpowers/
.publish-studio/
```

Keep all existing local Publisher ignores.

- [ ] **Step 5: Write operator documentation**

Document:

- configuring `studioWorkspaces` and `studioAttachmentRoot`;
- running `npm run studio`;
- browser-only local access;
- auto-save and Obsidian conflict behavior;
- image paste/drop;
- immediate versus final preview;
- prepare/confirm/cancel;
- recovery after build, commit, or push failure;
- CLI Publisher remains supported.

- [ ] **Step 6: Run the end-to-end and complete verification suite**

Run:

```bash
npm run studio:test
npm run publish:test
npm test
npm run build
git diff --check
```

Expected:

- all studio tests pass;
- all existing Publisher and site tests pass;
- Astro build succeeds;
- no whitespace errors.

- [ ] **Step 7: Browser QA**

Start:

```bash
npm run studio -- --no-open
```

Verify at desktop 1440×900 and mobile 390×844:

- three-column desktop layout;
- mobile tabs;
- no page overflow;
- keyboard navigation and visible focus;
- new/open/save/rename;
- metadata collapse and validation;
- Markdown shortcuts;
- paste/drop image;
- immediate preview and width controls;
- conflict handling;
- prepare review and cancel.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .gitignore publisher/README.md README.md tests/studio-e2e.test.mjs
git commit -m "docs: complete writing studio workflow"
```

---

### Task 12: Final regression and branch handoff

**Files:**
- Verify only; modify only files required by a failing in-scope test.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified feature branch ready for integration.

- [ ] **Step 1: Run clean full verification**

Run:

```bash
npm ci
npm run studio:test
npm run publish:test
npm test
npm run build
git diff --check
git status --short --branch
```

Expected: every command passes; only explicitly preserved user files may remain
dirty.

- [ ] **Step 2: Audit production isolation**

Run:

```bash
rg -n \"_studio|studioWorkspaces|127\\.0\\.0\\.1\" dist
```

Expected: no matches. The production site must not contain studio routes,
configuration, tokens, or local paths.

- [ ] **Step 3: Audit tracked files**

Run:

```bash
git ls-files | rg \"(^|/)(publish\\.config\\.local\\.json|\\.publish-state|\\.publish-studio|\\.superpowers)(/|$)\"
```

Expected: no matches.

- [ ] **Step 4: Review exact diff and commits**

Run:

```bash
git log --oneline --decorate origin/main..HEAD
git diff --stat origin/main...HEAD
```

Expected: only writing-studio implementation, tests, configuration example,
documentation, and the previously approved design/plan commits.

- [ ] **Step 5: Hand off**

Use `superpowers:finishing-a-development-branch` to choose merge, push, PR, or
local retention. Do not push or merge without the user's requested handoff.
