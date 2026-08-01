import { createMarkdownEditor } from './editor.js';
import { createStudioUI } from './ui.js';

function studioToken() {
  const node = document.getElementById('studio-data');
  try {
    return JSON.parse(node.textContent).token;
  } catch {
    throw new Error('写作台会话数据缺失，请重新从终端打开写作台。');
  }
}

function createApi(token) {
  async function request(path, { method = 'GET', query, json, body, headers = {} } = {}) {
    const url = new URL(`/_studio/api${path}`, document.baseURI);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    const response = await fetch(url, {
      method,
      headers: {
        'X-Studio-Token': token,
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : body,
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    if (!response.ok) {
      const error = new Error(payload?.error?.message ?? `请求失败（HTTP ${response.status}）`);
      error.status = response.status;
      error.code = payload?.error?.code;
      error.diagnostics = payload?.error?.diagnostics;
      throw error;
    }
    return payload;
  }

  return {
    getWorkspaces: () => request('/workspaces'),
    getDocument: (workspaceId, path) => request('/document', {
      query: { workspaceId, path },
    }),
    createDocument: (input) => request('/document', { method: 'POST', json: input }),
    saveDocument: (input) => request('/document', { method: 'PUT', json: input }),
    uploadAttachment: (file) => request('/attachment', {
      method: 'POST',
      body: file,
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Studio-Filename': encodeURIComponent(file.name || 'pasted-image'),
      },
    }),
    renderPreview: (input) => request('/preview', { method: 'POST', json: input }),
    preparePublication: (input) => request('/publish/prepare', { method: 'POST', json: input }),
    confirmPublication: (input) => request('/publish/confirm', { method: 'POST', json: input }),
    cancelPublication: (input) => request('/publish/cancel', { method: 'POST', json: input }),
  };
}

async function main() {
  const api = createApi(studioToken());
  const host = document.querySelector('[data-testid="markdown-editor"]');
  let ui;
  const editor = createMarkdownEditor({
    parent: host,
    onChange: () => ui?.onEditorChange(),
    onPasteImage: (file) => ui?.uploadImage(file),
  });
  ui = createStudioUI({ root: document, api, editor });
  await ui.start();
}

main().catch((error) => {
  const status = document.querySelector('[data-testid="save-status"]');
  if (status) {
    status.dataset.state = 'error';
    status.textContent = `初始化失败：${error.message}`;
  }
});
