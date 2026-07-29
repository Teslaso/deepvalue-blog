import {
  defaultKeymap,
  history,
  historyKeymap,
} from '@codemirror/commands';
import { bracketMatching } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  keymap,
} from '@codemirror/view';

const TOOLBAR_ITEMS = [
  ['heading', '标题'],
  ['bold', '粗体'],
  ['italic', '斜体'],
  ['quote', '引用'],
  ['link', '链接'],
  ['image', '图片'],
];

function normalizeSelection(value, selectionStart, selectionEnd) {
  const start = Math.max(0, Math.min(value.length, Number(selectionStart) || 0));
  const end = Math.max(start, Math.min(value.length, Number(selectionEnd) || start));
  return { start, end };
}

function wrapSelection(value, start, end, prefix, suffix, placeholder) {
  const selected = value.slice(start, end);
  const content = selected || placeholder;
  return {
    value: `${value.slice(0, start)}${prefix}${content}${suffix}${value.slice(end)}`,
    selectionStart: start + prefix.length,
    selectionEnd: start + prefix.length + content.length,
  };
}

function lineRange(value, start, end) {
  const from = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nextBreak = value.indexOf('\n', end);
  const to = nextBreak === -1 ? value.length : nextBreak;
  return { from, to };
}

function transformLines(value, start, end, transform) {
  const range = lineRange(value, start, end);
  const replacement = value.slice(range.from, range.to)
    .split('\n')
    .map(transform)
    .join('\n');
  return {
    value: `${value.slice(0, range.from)}${replacement}${value.slice(range.to)}`,
    selectionStart: range.from,
    selectionEnd: range.from + replacement.length,
  };
}

export function applyMarkdownCommand({
  command,
  value,
  selectionStart,
  selectionEnd,
}) {
  const source = String(value ?? '');
  const selection = normalizeSelection(source, selectionStart, selectionEnd);

  switch (command) {
    case 'bold':
      return wrapSelection(source, selection.start, selection.end, '**', '**', '粗体');
    case 'italic':
      return wrapSelection(source, selection.start, selection.end, '*', '*', '斜体');
    case 'link':
      return wrapSelection(source, selection.start, selection.end, '[', '](https://)', '链接文字');
    case 'image':
      return wrapSelection(source, selection.start, selection.end, '![', '](图片地址)', '图片说明');
    case 'heading':
      return transformLines(source, selection.start, selection.end, (line) => {
        if (/^ {0,3}#{1,6}(?:[ \t]+|$)/u.test(line)) {
          return line.replace(/^ {0,3}#{1,6}[ \t]*/u, '');
        }
        return line.length > 0 ? `## ${line}` : line;
      });
    case 'quote':
      return transformLines(source, selection.start, selection.end, (line) => (
        /^ {0,3}>[ \t]?/u.test(line)
          ? line.replace(/^ {0,3}>[ \t]?/u, '')
          : `> ${line}`
      ));
    default:
      throw new TypeError(`Unknown Markdown command: ${command}`);
  }
}

function fenceOpening(line) {
  const match = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
  if (!match) return undefined;
  return { marker: match[1][0], length: match[1].length };
}

function closesFence(line, fence) {
  const pattern = new RegExp(`^ {0,3}${fence.marker}{${fence.length},}[ \\t]*$`, 'u');
  return pattern.test(line);
}

export function extractMarkdownOutline(source) {
  const outline = [];
  let fence;
  String(source ?? '').split(/\r?\n/u).forEach((line, index) => {
    if (fence) {
      if (closesFence(line, fence)) fence = undefined;
      return;
    }
    const opening = fenceOpening(line);
    if (opening) {
      fence = opening;
      return;
    }
    const heading = /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/u.exec(line);
    if (!heading) return;
    const text = heading[2].replace(/[ \t]+#+[ \t]*$/u, '').trim();
    if (!text) return;
    outline.push({
      depth: heading[1].length,
      text,
      line: index + 1,
    });
  });
  return outline;
}

export function createChangeNotifier(callback, delay = 150) {
  const notify = typeof callback === 'function' ? callback : () => {};
  let timer;
  let destroyed = false;
  return {
    schedule(value) {
      if (destroyed) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        if (!destroyed) notify(value);
      }, delay);
    },
    destroy() {
      destroyed = true;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

function transferredImageFiles(event) {
  const transfer = event?.clipboardData ?? event?.dataTransfer;
  if (!transfer) return [];
  const fromFiles = Array.from(transfer.files ?? [])
    .filter((file) => typeof file?.type === 'string' && file.type.startsWith('image/'));
  if (fromFiles.length > 0) return fromFiles;
  return Array.from(transfer.items ?? [])
    .filter((item) => item?.kind === 'file' && item.type?.startsWith('image/'))
    .map((item) => item.getAsFile?.())
    .filter(Boolean);
}

function insertedImageText(result) {
  if (typeof result === 'string') return result;
  return typeof result?.embed === 'string' ? result.embed : '';
}

export function startImageTransfer({
  event,
  onPasteImage,
  insertText,
}) {
  const files = transferredImageFiles(event);
  if (files.length === 0) {
    return {
      handled: false,
      completion: Promise.resolve({ inserted: 0, errors: [] }),
    };
  }

  event.preventDefault();
  const upload = typeof onPasteImage === 'function' ? onPasteImage : async () => undefined;
  const insert = typeof insertText === 'function' ? insertText : () => {};
  const completion = (async () => {
    const errors = [];
    let inserted = 0;
    for (const file of files) {
      try {
        const text = insertedImageText(await upload(file));
        if (!text) continue;
        insert(text);
        inserted += 1;
      } catch (error) {
        errors.push(error);
      }
    }
    return { inserted, errors };
  })();

  return { handled: true, completion };
}

export function dispatchStudioSave(view) {
  const EventConstructor = view.dom.ownerDocument.defaultView.CustomEvent;
  view.dom.dispatchEvent(new EventConstructor('studio:save', {
    bubbles: true,
    cancelable: true,
  }));
  return true;
}

function dispatchImageErrors(view, errors) {
  if (errors.length === 0 || !view.dom.isConnected) return;
  const EventConstructor = view.dom.ownerDocument.defaultView.CustomEvent;
  view.dom.dispatchEvent(new EventConstructor('studio:image-error', {
    bubbles: true,
    detail: { errors },
  }));
}

function handleTransfer(view, event, onPasteImage) {
  if (event.type === 'drop') {
    const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (position !== null) {
      view.dispatch({ selection: { anchor: position } });
    }
  }
  const transfer = startImageTransfer({
    event,
    onPasteImage,
    insertText: (text) => {
      const selection = view.state.selection.main;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: text },
        selection: { anchor: selection.from + text.length },
        scrollIntoView: true,
      });
    },
  });
  if (transfer.handled) {
    void transfer.completion.then(({ errors }) => dispatchImageErrors(view, errors));
  }
  return transfer.handled;
}

function createToolbar(parent, runCommand) {
  const document = parent.ownerDocument;
  const toolbar = document.createElement('div');
  toolbar.className = 'dv-markdown-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Markdown 格式');
  for (const [command, label] of TOOLBAR_ITEMS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.command = command;
    button.textContent = label;
    button.addEventListener('click', () => runCommand(command));
    toolbar.append(button);
  }
  return toolbar;
}

export function createMarkdownEditor({
  parent,
  value = '',
  onChange,
  onPasteImage,
}) {
  if (!parent?.ownerDocument) {
    throw new TypeError('createMarkdownEditor requires a DOM parent');
  }

  const document = parent.ownerDocument;
  const shell = document.createElement('div');
  shell.className = 'dv-markdown-editor';
  const editorHost = document.createElement('div');
  editorHost.className = 'dv-markdown-editor__host';
  const notifier = createChangeNotifier(onChange, 150);
  let destroyed = false;
  let view;

  const runCommand = (command) => {
    if (destroyed) return;
    const selection = view.state.selection.main;
    const edit = applyMarkdownCommand({
      command,
      value: view.state.doc.toString(),
      selectionStart: selection.from,
      selectionEnd: selection.to,
    });
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: edit.value },
      selection: { anchor: edit.selectionStart, head: edit.selectionEnd },
      scrollIntoView: true,
    });
    view.focus();
  };

  const toolbar = createToolbar(parent, runCommand);
  shell.append(toolbar, editorHost);
  parent.append(shell);

  const state = EditorState.create({
    doc: String(value ?? ''),
    extensions: [
      markdown(),
      history(),
      bracketMatching(),
      highlightActiveLine(),
      EditorView.lineWrapping,
      keymap.of([
        { key: 'Mod-s', preventDefault: true, run: dispatchStudioSave },
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) notifier.schedule(update.state.doc.toString());
      }),
      EditorView.domEventHandlers({
        paste: (event, currentView) => handleTransfer(currentView, event, onPasteImage),
        drop: (event, currentView) => handleTransfer(currentView, event, onPasteImage),
      }),
    ],
  });
  view = new EditorView({ state, parent: editorHost });

  return {
    getValue() {
      return view.state.doc.toString();
    },
    setValue(nextValue) {
      if (destroyed) return;
      const next = String(nextValue ?? '');
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        selection: { anchor: Math.min(view.state.selection.main.head, next.length) },
      });
    },
    insertText(text) {
      if (destroyed) return;
      const insert = String(text ?? '');
      const selection = view.state.selection.main;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert },
        selection: { anchor: selection.from + insert.length },
        scrollIntoView: true,
      });
    },
    focus() {
      if (!destroyed) view.focus();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      notifier.destroy();
      view.destroy();
      shell.remove();
    },
    getOutline() {
      return destroyed ? [] : extractMarkdownOutline(view.state.doc.toString());
    },
  };
}
