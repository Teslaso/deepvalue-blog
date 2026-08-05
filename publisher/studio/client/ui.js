/* Deep Value 写作台客户端 UI 控制器。
 * 字段清单与 publisher/lib/studio-frontmatter.mjs 的 publicationFormSchema() 保持一致；
 * 服务端是唯一权威，这里只是渲染副本。 */

const FORM_SCHEMA = [
  { name: 'publish', type: 'boolean', label: '允许发布' },
  { name: 'publish_id', type: 'slug', label: '固定网址', lockedWhenPresent: true },
  { name: 'domain', type: 'select', label: '领域', options: ['investment', 'ai', 'beyond'] },
  {
    name: 'section',
    type: 'select',
    label: '栏目',
    visibleWhen: { domain: 'investment' },
    options: ['commodities', 'industries-companies', 'macro-cycles', 'markets-trading'],
  },
  { name: 'format', type: 'select', label: '体裁', options: ['article', 'log'] },
  { name: 'title', type: 'text', label: '标题', requiredWhen: { format: 'article' } },
  { name: 'summary', type: 'textarea', label: '摘要', requiredWhen: { format: 'article' }, wide: true },
  { name: 'topic', type: 'text', label: '主题' },
  {
    name: 'source_type',
    type: 'select',
    label: '来源类型',
    options: ['original', 'book', 'podcast', 'report', 'news', 'mixed'],
  },
  { name: 'tags', type: 'string-list', label: '标签' },
  { name: 'commodities', type: 'string-list', label: '商品' },
  { name: 'companies', type: 'string-list', label: '公司' },
  { name: 'tickers', type: 'string-list', label: '代码' },
  { name: 'thesis', type: 'textarea', label: '论点', wide: true },
  { name: 'confidence', type: 'select', label: '置信度', options: ['', 'low', 'medium', 'high'] },
];

const STATUS_LABELS = {
  draft: '草稿',
  ready: '待发布',
  published: '已发布',
  modified: '已修改',
  invalid: '元数据有误',
};

const SAVE_LABELS = {
  idle: '',
  saving: '正在保存…',
  saved: '已保存',
  error: '保存失败',
  conflict: '外部冲突',
};

const AUTOSAVE_DELAY = 1000;
const PREVIEW_DELAY = 150;

function wordCount(text) {
  const cjk = (text.match(/[一-鿿]/gu) ?? []).length;
  const words = (text.match(/[A-Za-z0-9]+/gu) ?? []).length;
  return cjk + words;
}

function formatTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function shortFingerprint(value) {
  return typeof value === 'string' ? value.slice(0, 12) : '';
}

export function createStudioUI({ root, api, editor }) {
  const view = root.ownerDocument ?? root;
  const $ = (testid) => view.querySelector(`[data-testid="${testid}"]`);
  const elements = {
    shell: $('studio-shell'),
    currentPath: $('current-path'),
    saveStatus: $('save-status'),
    saveButton: $('save-document'),
    prepareButton: $('prepare-publish'),
    workspaceSelect: $('workspace-select'),
    search: $('document-search'),
    statusFilter: $('status-filter'),
    createButton: $('create-document'),
    documentList: $('document-list'),
    editorPath: $('editor-path'),
    wordCount: $('editor-word-count'),
    metadataPanel: $('metadata-panel'),
    metadataForm: $('metadata-form'),
    metadataDiagnostics: $('metadata-diagnostics'),
    preview: $('instant-preview'),
    outline: $('preview-outline'),
    statusPath: $('status-path'),
    statusWords: $('status-words'),
    statusSavedAt: $('status-saved-at'),
    statusPreview: $('status-preview'),
    statusDiagnostics: $('status-diagnostics'),
    statusTransaction: $('status-transaction'),
    conflictDialog: $('conflict-dialog'),
    conflictDiskFingerprint: $('conflict-disk-fingerprint'),
    conflictBrowserFingerprint: $('conflict-browser-fingerprint'),
    conflictCompare: $('conflict-compare'),
    conflictDiskSource: $('conflict-disk-source'),
    conflictBrowserSource: $('conflict-browser-source'),
    conflictReload: $('conflict-reload'),
    conflictCompareToggle: $('conflict-compare-toggle'),
    conflictKeepBrowser: $('conflict-keep-browser'),
    publishReview: $('publish-review'),
    publishRoute: $('publish-route'),
    publishFrame: $('publish-frame'),
    publishNotes: $('publish-notes'),
    publishFiles: $('publish-files'),
    publishDiagnostics: $('publish-diagnostics'),
    publishResult: $('publish-result'),
    publishConfirmPush: $('publish-confirm-push'),
    publishConfirmLocal: $('publish-confirm-local'),
    publishCancel: $('publish-cancel'),
    toast: $('toast'),
  };

  const state = {
    workspaces: [],
    activeWorkspaceId: undefined,
    documents: [],
    searchText: '',
    statusFilterValue: '',
    activeDocument: undefined,
    metadata: {},
    dirty: false,
    saveState: 'idle',
    conflict: undefined,
    previewRequestId: 0,
    publication: undefined,
    publishing: false,
  };

  let autosaveTimer;
  let previewTimer;
  let toastTimer;

  function toast(message) {
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      elements.toast.hidden = true;
    }, 6000);
  }

  function setSaveState(next) {
    state.saveState = next;
    elements.saveStatus.dataset.state = next;
    elements.saveStatus.textContent = SAVE_LABELS[next] ?? '';
  }

  function updateChrome() {
    const doc = state.activeDocument;
    const path = doc ? doc.relativePath : '未打开文档';
    elements.currentPath.textContent = path;
    elements.editorPath.textContent = path;
    elements.statusPath.textContent = doc ? path : '';
    const words = doc ? wordCount(editor.getValue()) : 0;
    elements.wordCount.textContent = doc ? `${words} 字` : '';
    elements.statusWords.textContent = doc ? `${words} 字` : '';
    elements.statusSavedAt.textContent = doc?.modifiedAt
      ? `最后保存 ${formatTime(doc.modifiedAt)}`
      : '';
    const diagnostics = doc?.diagnostics?.length ?? 0;
    elements.statusDiagnostics.textContent = diagnostics > 0 ? `验证错误 ${diagnostics}` : '';
    const blocked = !doc || state.dirty || state.saveState === 'conflict' || state.publishing;
    elements.prepareButton.disabled = Boolean(blocked);
  }

  function renderDiagnostics(target, diagnostics) {
    target.replaceChildren();
    for (const entry of diagnostics ?? []) {
      const item = view.createElement('li');
      item.textContent = `${entry.field ?? '<frontmatter>'}: ${entry.message ?? entry.code}`;
      target.append(item);
    }
  }

  // ---- 元数据表单 ----

  const fieldInputs = new Map();

  function buildMetadataForm() {
    elements.metadataForm.replaceChildren();
    fieldInputs.clear();
    for (const field of FORM_SCHEMA) {
      const label = view.createElement('label');
      label.dataset.field = field.name;
      if (field.wide) label.dataset.wide = 'true';
      const caption = view.createElement('span');
      caption.textContent = field.label;
      label.append(caption);

      let input;
      if (field.type === 'boolean') {
        input = view.createElement('input');
        input.type = 'checkbox';
      } else if (field.type === 'select') {
        input = view.createElement('select');
        const empty = view.createElement('option');
        empty.value = '';
        empty.textContent = '（未设置）';
        input.append(empty);
        for (const option of field.options ?? []) {
          const node = view.createElement('option');
          node.value = option;
          node.textContent = option;
          input.append(node);
        }
      } else if (field.type === 'textarea') {
        input = view.createElement('textarea');
      } else {
        input = view.createElement('input');
        input.type = 'text';
        if (field.type === 'string-list') input.placeholder = '用逗号分隔';
      }
      input.name = field.name;
      input.setAttribute('aria-label', field.label);
      input.addEventListener('input', () => {
        applyFieldVisibility();
        markDirty();
      });
      label.append(input);
      elements.metadataForm.append(label);
      fieldInputs.set(field.name, { field, input, label });
    }
  }

  function applyFieldVisibility() {
    const domain = fieldInputs.get('domain')?.input.value ?? '';
    for (const { field, label } of fieldInputs.values()) {
      if (field.visibleWhen?.domain !== undefined) {
        label.hidden = field.visibleWhen.domain !== domain;
      }
    }
  }

  function readFormMetadata() {
    const metadata = {};
    for (const { field, input } of fieldInputs.values()) {
      if (field.type === 'boolean') {
        if (input.checked) metadata[field.name] = true;
        else if (field.name in state.metadata) metadata[field.name] = false;
        continue;
      }
      const raw = input.value.trim();
      if (field.type === 'string-list') {
        const list = raw.split(/[,，]/u).map((item) => item.trim()).filter(Boolean);
        if (list.length > 0 || Array.isArray(state.metadata[field.name])) {
          metadata[field.name] = list;
        }
        continue;
      }
      if (raw !== '' || typeof state.metadata[field.name] === 'string') {
        metadata[field.name] = raw;
      }
    }
    return metadata;
  }

  function fillMetadataForm(metadata) {
    state.metadata = metadata ?? {};
    for (const { field, input } of fieldInputs.values()) {
      const value = state.metadata[field.name];
      if (field.type === 'boolean') {
        input.checked = value === true;
      } else if (field.type === 'string-list') {
        input.value = Array.isArray(value) ? value.join(', ') : '';
      } else {
        input.value = typeof value === 'string' ? value : '';
      }
      if (field.lockedWhenPresent) {
        const locked = typeof value === 'string' && value !== '';
        input.readOnly = locked;
        input.title = locked ? 'publish_id 一经设定即锁定，不可修改' : '';
      }
    }
    applyFieldVisibility();
  }

  // ---- 文档列表 ----

  function visibleDocuments() {
    const query = state.searchText.toLowerCase();
    return state.documents.filter((doc) => {
      if (state.statusFilterValue && doc.status !== state.statusFilterValue) return false;
      if (!query) return true;
      return [doc.relativePath, doc.title, doc.topic, ...(doc.tags ?? [])]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query));
    });
  }

  function renderDocumentList() {
    elements.documentList.replaceChildren();
    for (const doc of visibleDocuments()) {
      const item = view.createElement('li');
      const isActive = state.activeDocument?.relativePath === doc.relativePath;
      if (isActive) item.setAttribute('aria-current', 'true');
      const title = view.createElement('span');
      title.className = 'doc-title';
      title.textContent = doc.title ?? doc.relativePath;
      const meta = view.createElement('span');
      meta.className = 'doc-meta';
      meta.textContent = `${STATUS_LABELS[doc.status] ?? doc.status} · ${formatTime(doc.modifiedAt)}`;
      item.append(title, meta);
      item.addEventListener('click', () => {
        void openDocument(doc.relativePath);
      });
      elements.documentList.append(item);
    }
  }

  async function refreshWorkspace() {
    const workspaceId = state.activeWorkspaceId;
    const { workspaces } = await api.getWorkspaces();
    state.workspaces = workspaces;
    const workspace = workspaces.find(({ id }) => id === workspaceId) ?? workspaces[0];
    state.activeWorkspaceId = workspace?.id;
    state.documents = workspace?.documents ?? [];
    elements.workspaceSelect.replaceChildren();
    for (const entry of workspaces) {
      const option = view.createElement('option');
      option.value = entry.id;
      option.textContent = entry.label;
      elements.workspaceSelect.append(option);
    }
    if (state.activeWorkspaceId) {
      elements.workspaceSelect.value = state.activeWorkspaceId;
    }
    renderDocumentList();
  }

  // ---- 文档打开与保存 ----

  function confirmDiscardChanges() {
    if (!state.dirty) return true;
    return view.defaultView.confirm('当前文档有未保存的修改，确定要放弃吗？');
  }

  async function openDocument(relativePath) {
    if (!state.activeWorkspaceId || !confirmDiscardChanges()) return;
    const { document: doc } = await api.getDocument(state.activeWorkspaceId, relativePath);
    state.activeDocument = doc;
    state.conflict = undefined;
    elements.conflictDialog.hidden = true;
    fillMetadataForm(doc.metadata);
    editor.setValue(doc.body ?? '');
    renderDiagnostics(elements.metadataDiagnostics, doc.diagnostics);
    state.dirty = false;
    setSaveState('idle');
    updateChrome();
    renderDocumentList();
    schedulePreview();
  }

  function currentBody() {
    return editor.getValue();
  }

  async function saveActiveDocument() {
    const doc = state.activeDocument;
    if (!doc || state.saveState === 'saving' || state.saveState === 'conflict') return;
    setSaveState('saving');
    updateChrome();
    try {
      const { document: saved } = await api.saveDocument({
        workspaceId: doc.workspaceId,
        relativePath: doc.relativePath,
        expectedFingerprint: doc.fingerprint,
        patch: readFormMetadata(),
        body: currentBody(),
      });
      state.activeDocument = saved;
      state.metadata = saved.metadata ?? {};
      state.dirty = false;
      setSaveState('saved');
      renderDiagnostics(elements.metadataDiagnostics, saved.diagnostics);
      updateChrome();
      void refreshWorkspace();
    } catch (error) {
      if (error.status === 409) {
        await enterConflict();
      } else {
        setSaveState('error');
        updateChrome();
        toast(`保存失败：${error.message}`);
      }
    }
  }

  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    if (state.saveState === 'conflict') return;
    autosaveTimer = setTimeout(() => {
      void saveActiveDocument();
    }, AUTOSAVE_DELAY);
  }

  function markDirty() {
    if (!state.activeDocument) return;
    state.dirty = true;
    if (state.saveState === 'saved') setSaveState('idle');
    updateChrome();
    scheduleAutosave();
    schedulePreview();
  }

  // ---- 即时预览 ----

  function renderOutline(outline) {
    elements.outline.replaceChildren();
    for (const entry of outline ?? []) {
      const item = view.createElement('li');
      const button = view.createElement('button');
      button.type = 'button';
      button.style.paddingLeft = `${(entry.depth - 1) * 12}px`;
      button.textContent = entry.text;
      button.addEventListener('click', () => {
        if (typeof editor.revealLine === 'function' && entry.line) {
          editor.revealLine(entry.line);
          return;
        }
        const target = entry.id && elements.preview.querySelector(`[id="${CSS.escape(entry.id)}"]`);
        target?.scrollIntoView({ block: 'start' });
      });
      item.append(button);
      elements.outline.append(item);
    }
  }

  async function runPreview() {
    if (!state.activeDocument) return;
    const requestId = ++state.previewRequestId;
    elements.statusPreview.textContent = '预览加载中…';
    try {
      const { preview } = await api.renderPreview({
        body: currentBody(),
        metadata: readFormMetadata(),
      });
      if (requestId !== state.previewRequestId) return;
      elements.preview.innerHTML = preview.html;
      renderOutline(preview.outline ?? editor.getOutline());
      elements.statusPreview.textContent = '即时预览';
    } catch (error) {
      if (requestId !== state.previewRequestId) return;
      elements.statusPreview.textContent = '预览失败';
      renderOutline(editor.getOutline());
    }
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      void runPreview();
    }, PREVIEW_DELAY);
  }

  // ---- 外部冲突 ----

  async function enterConflict() {
    clearTimeout(autosaveTimer);
    const doc = state.activeDocument;
    setSaveState('conflict');
    let disk;
    try {
      ({ document: disk } = await api.getDocument(doc.workspaceId, doc.relativePath));
    } catch (error) {
      toast(`无法读取磁盘版本：${error.message}`);
      updateChrome();
      return;
    }
    state.conflict = {
      staleFingerprint: doc.fingerprint,
      diskFingerprint: disk.fingerprint,
      diskSource: disk.source,
      diskBody: disk.body ?? '',
    };
    elements.conflictDiskFingerprint.textContent = shortFingerprint(disk.fingerprint);
    elements.conflictBrowserFingerprint.textContent = shortFingerprint(doc.fingerprint);
    elements.conflictDiskSource.textContent = disk.source;
    elements.conflictBrowserSource.textContent = currentBody();
    elements.conflictCompare.hidden = true;
    elements.conflictDialog.hidden = false;
    updateChrome();
  }

  async function resolveConflictReload() {
    const doc = state.activeDocument;
    const { document: disk } = await api.getDocument(doc.workspaceId, doc.relativePath);
    state.activeDocument = disk;
    state.conflict = undefined;
    elements.conflictDialog.hidden = true;
    fillMetadataForm(disk.metadata);
    editor.setValue(disk.body ?? '');
    state.dirty = false;
    setSaveState('idle');
    updateChrome();
    schedulePreview();
    void refreshWorkspace();
  }

  async function resolveConflictKeepBrowser() {
    const doc = state.activeDocument;
    const conflict = state.conflict;
    if (!doc || !conflict) return;
    const approved = view.defaultView.confirm(
      '确定要用浏览器中的版本覆盖磁盘上的外部修改吗？此操作不可撤销。',
    );
    if (!approved) return;
    try {
      // 通过专用冲突解决端点提交：同时携带网页版本（stale）与磁盘最新版本
      // （current）两个指纹，服务端在覆盖前再次比对磁盘指纹。patch+body 走
      // frontmatter 适配器序列化，保留磁盘版本中表单未建模的未知 YAML 字段；
      // 指纹不匹配会再次返回 409 并重新进入冲突流程。
      const { document: saved } = await api.resolveConflict({
        workspaceId: doc.workspaceId,
        relativePath: doc.relativePath,
        staleFingerprint: conflict.staleFingerprint,
        currentFingerprint: conflict.diskFingerprint,
        patch: readFormMetadata(),
        body: currentBody(),
      });
      state.activeDocument = saved;
      state.conflict = undefined;
      elements.conflictDialog.hidden = true;
      state.dirty = false;
      setSaveState('saved');
      updateChrome();
      schedulePreview();
      void refreshWorkspace();
    } catch (error) {
      if (error.status === 409) {
        await enterConflict();
      } else {
        toast(`覆盖失败：${error.message}`);
      }
    }
  }

  // ---- 发布 ----

  function renderManifest(publication) {
    elements.publishNotes.replaceChildren();
    for (const note of publication.manifest?.publications ?? []) {
      const item = view.createElement('li');
      item.textContent = `${note.title ?? note.publishId} → ${note.entryTargetPath ?? ''}`;
      elements.publishNotes.append(item);
    }
    elements.publishFiles.replaceChildren();
    for (const file of publication.manifest?.files ?? []) {
      const item = view.createElement('li');
      const operation = file.operation === 'create' ? '新增' : file.operation === 'conflict' ? '冲突' : '更新';
      item.textContent = `[${operation}] ${file.targetPath ?? ''}`;
      elements.publishFiles.append(item);
    }
  }

  function lockPublishButtons(locked) {
    elements.publishConfirmPush.disabled = locked;
    elements.publishConfirmLocal.disabled = locked;
    elements.publishCancel.disabled = locked;
  }

  function closePublishReview() {
    state.publication = undefined;
    state.publishing = false;
    elements.publishReview.hidden = true;
    elements.publishFrame.removeAttribute('src');
    elements.statusTransaction.textContent = '';
    updateChrome();
  }

  async function preparePublication() {
    const doc = state.activeDocument;
    if (!doc || state.publishing) return;
    if (state.dirty) await saveActiveDocument();
    if (state.dirty || state.saveState === 'conflict') return;
    state.publishing = true;
    updateChrome();
    renderDiagnostics(elements.publishDiagnostics, []);
    elements.publishResult.textContent = '';
    try {
      const { publication } = await api.preparePublication({
        workspaceId: doc.workspaceId,
        relativePath: doc.relativePath,
        expectedFingerprint: state.activeDocument.fingerprint,
      });
      state.publication = publication;
      elements.publishRoute.textContent = publication.route;
      elements.publishFrame.src = publication.previewUrl;
      renderManifest(publication);
      lockPublishButtons(false);
      elements.publishReview.hidden = false;
      elements.statusTransaction.textContent = '发布待确认';
    } catch (error) {
      if (error.status === 409) {
        await enterConflict();
      } else {
        renderDiagnostics(elements.publishDiagnostics, error.diagnostics ?? [{
          field: '<publish>',
          message: `准备发布失败：${error.message}`,
        }]);
        elements.publishReview.hidden = false;
        lockPublishButtons(true);
        elements.publishCancel.disabled = false;
      }
    } finally {
      state.publishing = false;
      updateChrome();
    }
  }

  async function confirmPublication(push) {
    const publication = state.publication;
    if (!publication) return;
    lockPublishButtons(true);
    elements.publishResult.dataset.tone = '';
    elements.publishResult.textContent = push ? '正在确认并推送…' : '正在确认…';
    try {
      const { result } = await api.confirmPublication({
        transactionId: publication.transactionId,
        push,
      });
      const commit = result?.commitSha ? `提交 ${String(result.commitSha).slice(0, 10)}` : '提交完成';
      elements.publishResult.textContent = result?.pushed
        ? `已发布并推送（${commit}）。`
        : `已在本地确认（${commit}），尚未推送。`;
      elements.statusTransaction.textContent = '发布完成';
      state.publication = undefined;
      elements.publishCancel.disabled = false;
      elements.publishCancel.textContent = '关闭';
      void refreshWorkspace();
    } catch (error) {
      elements.publishResult.dataset.tone = 'error';
      elements.publishResult.textContent = push
        ? `推送失败：${error.message}。本地提交已保留，修复远端后可手动 git push。`
        : `确认失败：${error.message}`;
      elements.publishCancel.disabled = false;
    }
  }

  async function cancelPublication() {
    const publication = state.publication;
    if (!publication) {
      closePublishReview();
      elements.publishCancel.textContent = '取消发布';
      return;
    }
    lockPublishButtons(true);
    try {
      await api.cancelPublication({ transactionId: publication.transactionId });
    } catch (error) {
      toast(`取消发布时清理失败：${error.message}`);
    }
    elements.publishCancel.textContent = '取消发布';
    closePublishReview();
  }

  // ---- 图片上传 ----

  async function uploadImage(file) {
    try {
      const { attachment } = await api.uploadAttachment(file);
      return attachment;
    } catch (error) {
      toast(`图片上传失败：${error.message}`);
      throw error;
    }
  }

  // ---- 事件绑定 ----

  function bindEvents() {
    elements.workspaceSelect.addEventListener('change', () => {
      state.activeWorkspaceId = elements.workspaceSelect.value;
      const workspace = state.workspaces.find(({ id }) => id === state.activeWorkspaceId);
      state.documents = workspace?.documents ?? [];
      renderDocumentList();
    });
    elements.search.addEventListener('input', () => {
      state.searchText = elements.search.value.trim();
      renderDocumentList();
    });
    elements.statusFilter.addEventListener('change', () => {
      state.statusFilterValue = elements.statusFilter.value;
      renderDocumentList();
    });
    elements.createButton.addEventListener('click', async () => {
      const title = view.defaultView.prompt('新文章标题（将成为文件名）：');
      if (!title?.trim()) return;
      try {
        const { document: created } = await api.createDocument({
          workspaceId: state.activeWorkspaceId,
          title: title.trim(),
        });
        await refreshWorkspace();
        state.dirty = false;
        await openDocument(created.relativePath);
      } catch (error) {
        toast(`新建失败：${error.message}`);
      }
    });
    elements.saveButton.addEventListener('click', () => {
      void saveActiveDocument();
    });
    elements.prepareButton.addEventListener('click', () => {
      void preparePublication();
    });
    elements.conflictReload.addEventListener('click', () => {
      void resolveConflictReload();
    });
    elements.conflictCompareToggle.addEventListener('click', () => {
      elements.conflictCompare.hidden = !elements.conflictCompare.hidden;
      elements.conflictCompareToggle.textContent = elements.conflictCompare.hidden ? '打开对比' : '关闭对比';
    });
    elements.conflictKeepBrowser.addEventListener('click', () => {
      void resolveConflictKeepBrowser();
    });
    elements.publishConfirmPush.addEventListener('click', () => {
      void confirmPublication(true);
    });
    elements.publishConfirmLocal.addEventListener('click', () => {
      void confirmPublication(false);
    });
    elements.publishCancel.addEventListener('click', () => {
      void cancelPublication();
    });
    for (const button of view.querySelectorAll('[data-panel-button]')) {
      button.addEventListener('click', () => {
        elements.shell.dataset.mobilePanel = button.dataset.panelButton;
        for (const tab of view.querySelectorAll('[data-panel-button]')) {
          tab.setAttribute('aria-selected', String(tab === button));
        }
      });
    }
    view.addEventListener('studio:save', () => {
      clearTimeout(autosaveTimer);
      void saveActiveDocument();
    });
    view.addEventListener('studio:image-error', (event) => {
      toast('部分图片插入失败，附件已保留在磁盘上。');
      void event;
    });
    view.defaultView.addEventListener('beforeunload', (event) => {
      if (state.dirty) event.preventDefault();
    });
  }

  buildMetadataForm();
  bindEvents();
  updateChrome();

  return {
    onEditorChange: markDirty,
    uploadImage,
    async start() {
      await refreshWorkspace();
      const first = state.documents[0];
      if (first) {
        state.dirty = false;
        await openDocument(first.relativePath);
      }
    },
  };
}
