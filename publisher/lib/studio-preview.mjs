import { Marked } from 'marked';
import { decodeHTML } from 'entities';
import markedFootnote from 'marked-footnote';
import sanitizeHtml from 'sanitize-html';

const CALLOUT_LABELS = Object.freeze({
  abstract: 'Abstract',
  attention: 'Attention',
  bug: 'Bug',
  caution: 'Caution',
  check: 'Success',
  cite: 'Cite',
  danger: 'Danger',
  done: 'Success',
  error: 'Error',
  example: 'Example',
  failure: 'Failure',
  fail: 'Failure',
  faq: 'Question',
  help: 'Question',
  important: 'Important',
  info: 'Info',
  missing: 'Failure',
  note: 'Note',
  question: 'Question',
  quote: 'Quote',
  success: 'Success',
  summary: 'Summary',
  tip: 'Tip',
  tldr: 'Summary',
  todo: 'Todo',
  warning: 'Warning',
});

const SANITIZE_OPTIONS = Object.freeze({
  allowedTags: [
    'a', 'blockquote', 'br', 'code', 'del', 'details', 'div', 'em', 'figcaption',
    'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'img', 'input', 'kbd',
    'li', 'mark', 'ol', 'p', 'pre', 's', 'section', 'span', 'strong', 'sub', 'sup',
    'summary', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
  ],
  allowedAttributes: {
    '*': ['aria-describedby', 'aria-label', 'class', 'data-footnote-backref', 'data-footnote-ref', 'data-footnotes', 'id', 'title'],
    a: ['aria-describedby', 'aria-label', 'class', 'data-footnote-backref', 'data-footnote-ref', 'href', 'id', 'title'],
    img: ['alt', 'height', 'loading', 'src', 'title', 'width'],
    input: ['checked', 'disabled', 'type'],
    ol: ['start'],
    td: ['align', 'colspan', 'rowspan'],
    th: ['align', 'colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {
    a: ['http', 'https', 'mailto'],
    img: ['http', 'https'],
  },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
});

function escapeMarkdownText(value) {
  return String(value).replace(/[\\`*_[\]<>]/gu, '\\$&');
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function visibleWikiLabel(target, alias) {
  if (typeof alias === 'string' && alias.trim() !== '') return alias.trim();
  const reference = target.split('#', 1)[0].trim().replaceAll('\\', '/');
  const label = reference.split('/').at(-1)?.replace(/\.md$/iu, '') ?? '';
  return label || 'Note';
}

function safeDiagnosticReference(value) {
  const reference = String(value ?? '').trim().replaceAll('\\', '/');
  const basename = reference.split('/').at(-1)?.replace(/\.md$/iu, '') ?? '';
  return basename || 'Note';
}

function stableCalloutLabel(type) {
  const normalized = type.toLocaleLowerCase('en-US');
  if (CALLOUT_LABELS[normalized]) return CALLOUT_LABELS[normalized];
  return normalized
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toLocaleUpperCase('en-US')}${part.slice(1)}`)
    .join(' ') || 'Note';
}

function transformCalloutHeader(line) {
  const match = line.match(/^(\s{0,3}>\s*)\[!([\p{Letter}\p{Number}_-]+)\][+-]?(?:[ \t]+(.*?))?[ \t]*$/u);
  if (!match) return line;
  const [, prefix, type, title = ''] = match;
  const label = stableCalloutLabel(type);
  const content = title.trim();
  return content
    ? `${prefix}**${label}: ${escapeMarkdownText(content)}**`
    : `${prefix}**${label}:**`;
}

function fenceMarker(line) {
  return line.match(/^(?: {0,3})(?:>\s*)*(`{3,}|~{3,})/u)?.[1];
}

function closesFence(line, openFence) {
  const marker = fenceMarker(line);
  return Boolean(marker && marker[0] === openFence[0] && marker.length >= openFence.length
    && new RegExp(`^(?: {0,3})(?:>\\s*)*${openFence[0] === '`' ? '`' : '~'}{${openFence.length},}\\s*$`, 'u').test(line));
}

function blockquoteContent(line) {
  let content = line;
  let depth = 0;
  while (true) {
    const prefix = content.match(/^ {0,3}>[ \t]?/u)?.[0];
    if (!prefix) return { content, depth };
    content = content.slice(prefix.length);
    depth += 1;
  }
}

function indentationInfo(content) {
  let columns = 0;
  let index = 0;
  while (index < content.length && (content[index] === ' ' || content[index] === '\t')) {
    columns += content[index] === '\t' ? 4 - (columns % 4) : 1;
    index += 1;
  }
  const marker = /^(?:[-+*]|\d+[.)])(?:[ \t]+|$)/u.test(content.slice(index));
  return { columns, index, marker };
}

function lineBlockInfo(line) {
  const { content, depth } = blockquoteContent(line);
  return { content, ...indentationInfo(content), depth };
}

function createBlockState() {
  return { listIndentsByQuoteDepth: new Map() };
}

function clearExitedQuoteScopes(blockState, depth) {
  for (const quoteDepth of blockState.listIndentsByQuoteDepth.keys()) {
    if (quoteDepth > depth) blockState.listIndentsByQuoteDepth.delete(quoteDepth);
  }
}

function isIndentedCodeLine(line, blockState) {
  const info = lineBlockInfo(line);
  clearExitedQuoteScopes(blockState, info.depth);
  if (info.columns < 4) return false;
  const parentIndents = blockState.listIndentsByQuoteDepth.get(info.depth) ?? [];
  return !(info.marker && parentIndents.some((indent) => indent < info.columns));
}

function observeBlockLine(line, blockState) {
  const { content, depth, columns, marker } = lineBlockInfo(line);
  clearExitedQuoteScopes(blockState, depth);
  if (marker) {
    const existing = blockState.listIndentsByQuoteDepth.get(depth) ?? [];
    blockState.listIndentsByQuoteDepth.set(depth, [
      ...existing.filter((indent) => indent < columns),
      columns,
    ]);
    return;
  }
  if (content.trim() !== '' && columns === 0) {
    blockState.listIndentsByQuoteDepth.delete(depth);
  }
}

function safeUrl(value, { image = false } = {}) {
  if (typeof value !== 'string') return undefined;
  const url = value.trim();
  if (url === '' || /[\u0000-\u001F\u007F\s<>]/u.test(url) || url.startsWith('//')) return undefined;
  if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) return url;
  if (!image && url.startsWith('#')) return url;
  if (/^https?:\/\//iu.test(url)) return url;
  if (!image && /^mailto:/iu.test(url)) return url;
  return undefined;
}

function removeUnsafeMarkdownLinks(markdown) {
  return markdown.replace(/(!?)\[([^\]\r\n]*)\]\(\s*<?((?:javascript|vbscript|data):[^\r\n]*)\)/giu, (_match, image, label) => {
    return escapeMarkdownText(label || (image ? 'image' : 'link'));
  });
}

function normalizeAsset(result) {
  if (typeof result === 'string') return { src: result };
  if (!result || typeof result !== 'object') return undefined;
  const src = result.src ?? result.href ?? result.url;
  return typeof src === 'string' ? { src, alt: result.alt, title: result.title } : undefined;
}

function normalizeWikiLink(result) {
  if (!result || typeof result !== 'object') return undefined;
  return {
    kind: result.kind,
    href: result.href ?? result.url,
    label: result.label,
    title: result.title,
  };
}

function diagnostic(code, reference, message) {
  return { code, reference, message };
}

async function replaceObsidianSyntax(segment, context) {
  const pattern = /(!)?\[\[([^\]\r\n]+?)\]\]/gu;
  let result = '';
  let cursor = 0;

  for (const match of segment.matchAll(pattern)) {
    result += segment.slice(cursor, match.index);
    const embedded = match[1] === '!';
    const inner = match[2];
    const separator = inner.indexOf('|');
    const target = (separator === -1 ? inner : inner.slice(0, separator)).trim();
    const alias = separator === -1 ? undefined : inner.slice(separator + 1).trim();
    const label = visibleWikiLabel(target, alias);

    if (embedded) {
      const asset = normalizeAsset(await context.resolveAsset?.(target, { alias, metadata: context.metadata }));
      const src = safeUrl(asset?.src, { image: true });
      if (!asset) {
        context.diagnostics.push(diagnostic('unresolved_embed', safeDiagnosticReference(alias ?? label), 'Could not resolve embedded asset'));
        result += escapeMarkdownText(label);
      } else if (!src) {
        context.diagnostics.push(diagnostic('unsafe_embed_url', safeDiagnosticReference(alias ?? asset.alt ?? label), 'Embedded asset resolved to an unsafe URL'));
        result += escapeMarkdownText(label);
      } else {
        const alt = typeof alias === 'string' && alias !== '' ? alias : (asset.alt ?? label);
        const title = typeof asset.title === 'string' && asset.title.trim() !== ''
          ? ` "${escapeMarkdownText(asset.title.trim())}"`
          : '';
        result += `![${escapeMarkdownText(alt)}](<${src}>${title})`;
      }
    } else {
      const resolved = normalizeWikiLink(await context.resolveWikiLink?.(target, { alias, metadata: context.metadata }));
      if (resolved?.kind === 'plain-text') {
        result += escapeMarkdownText(resolved.label ?? label);
      } else if (resolved?.kind === 'published' || resolved?.kind === 'link') {
        const href = safeUrl(resolved.href);
        if (!href) {
          context.diagnostics.push(diagnostic('unsafe_wiki_link', safeDiagnosticReference(resolved.label ?? label), 'Wiki link resolved to an unsafe URL'));
          result += escapeMarkdownText(resolved.label ?? label);
        } else {
          const title = typeof resolved.title === 'string' && resolved.title.trim() !== ''
            ? ` "${escapeMarkdownText(resolved.title.trim())}"`
            : '';
          result += `[${escapeMarkdownText(resolved.label ?? label)}](<${href}>${title})`;
        }
      } else {
        context.diagnostics.push(diagnostic('unresolved_wiki_link', safeDiagnosticReference(alias ?? label), 'Could not resolve wiki link'));
        result += escapeMarkdownText(label);
      }
    }
    cursor = match.index + match[0].length;
  }
  return result + segment.slice(cursor);
}

async function transformOutsideInlineCode(line, context) {
  let result = '';
  let cursor = 0;
  while (cursor < line.length) {
    if (context.inlineCodeDelimiter) {
      const closing = line.indexOf(context.inlineCodeDelimiter, cursor);
      if (closing === -1) return result + line.slice(cursor);
      result += line.slice(cursor, closing + context.inlineCodeDelimiter.length);
      cursor = closing + context.inlineCodeDelimiter.length;
      context.inlineCodeDelimiter = undefined;
      continue;
    }
    const opening = line.indexOf('`', cursor);
    if (opening === -1) return result + removeUnsafeMarkdownLinks(await replaceObsidianSyntax(line.slice(cursor), context));
    result += removeUnsafeMarkdownLinks(await replaceObsidianSyntax(line.slice(cursor, opening), context));
    let runLength = 1;
    while (line[opening + runLength] === '`') runLength += 1;
    const marker = '`'.repeat(runLength);
    const closing = line.indexOf(marker, opening + runLength);
    if (closing === -1) {
      context.inlineCodeDelimiter = marker;
      return result + line.slice(opening);
    }
    result += line.slice(opening, closing + runLength);
    cursor = closing + runLength;
  }
  return result;
}

async function preprocessMarkdown(body, context) {
  const lines = body.split(/(\r?\n)/u);
  let output = '';
  let openFence;
  const blockState = createBlockState();
  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index];
    const ending = lines[index + 1] ?? '';
    if (openFence) {
      output += line + ending;
      if (closesFence(line, openFence)) openFence = undefined;
      continue;
    }
    const marker = fenceMarker(line);
    if (marker) {
      openFence = marker;
      output += line + ending;
      continue;
    }
    if (isIndentedCodeLine(line, blockState)) {
      if (context.inlineCodeDelimiter) {
        output += `${await transformOutsideInlineCode(line, context)}${ending}`;
        continue;
      }
      output += line + ending;
      continue;
    }
    const source = context.inlineCodeDelimiter ? line : transformCalloutHeader(line);
    output += `${await transformOutsideInlineCode(source, context)}${ending}`;
    observeBlockLine(line, blockState);
  }
  return output;
}

function outlineText(rawText) {
  return decodeHTML(rawText.replace(/<[^>]*>/gu, ''))
    .replace(/[\uD800-\uDFFF]/gu, '�')
    .replace(/\s+/gu, ' ')
    .trim();
}

function headingSlug(text) {
  const slug = text.normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return slug || 'section';
}

function collectReservedFootnoteIds(markdown) {
  const labels = new Set();
  const referenceCounts = new Map();
  const source = markdown.split(/(\r?\n)/u);
  let openFence;
  let visibleMarkdown = '';
  const blockState = createBlockState();
  for (let index = 0; index < source.length; index += 2) {
    const line = source[index];
    const ending = source[index + 1] ?? '';
    if (openFence) {
      if (closesFence(line, openFence)) openFence = undefined;
      visibleMarkdown += ending;
      continue;
    }
    const marker = fenceMarker(line);
    if (marker) {
      openFence = marker;
      visibleMarkdown += ending;
      continue;
    }
    if (isIndentedCodeLine(line, blockState)) {
      visibleMarkdown += ending;
      continue;
    }
    visibleMarkdown += line + ending;
    observeBlockLine(line, blockState);
  }
  for (const match of visibleMarkdown.matchAll(/(?:^|\n)(?:[ \t]{0,3}>[ \t]*)*[ \t]{0,3}\[\^([^\]\n]+)\]:/gu)) labels.add(match[1]);
  for (const match of visibleMarkdown.matchAll(/\[\^([^\]\n]+)\](?!:)/gu)) {
    referenceCounts.set(match[1], (referenceCounts.get(match[1]) ?? 0) + 1);
  }
  const reserved = new Set(['footnote-label']);
  for (const label of labels) {
    const encoded = encodeURIComponent(label);
    reserved.add(`footnote-${encoded}`);
    const count = referenceCounts.get(label) ?? 1;
    for (let index = 1; index <= count; index += 1) {
      reserved.add(`footnote-ref-${encoded}${index === 1 ? '' : `-${index}`}`);
    }
  }
  return reserved;
}

function createRenderer(outline, reservedIds) {
  const usedIds = new Set();
  return {
    heading({ tokens, depth }) {
      const rawText = this.parser.parseInline(tokens, this.parser.textRenderer);
      const text = outlineText(rawText);
      const baseId = headingSlug(text);
      let count = 1;
      let id = baseId;
      while (reservedIds.has(id) || usedIds.has(id)) {
        count += 1;
        id = `${baseId}-${count}`;
      }
      usedIds.add(id);
      outline.push({ depth, text, id });
      return `<h${depth} id="${escapeHtmlAttribute(id)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
  };
}

/**
 * Render a Studio document without changing publisher transform semantics.
 */
export async function renderStudioPreview({
  body,
  metadata = {},
  resolveAsset,
  resolveWikiLink,
} = {}) {
  if (typeof body !== 'string') throw new TypeError('body must be a Markdown string');
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new TypeError('metadata must be a structured metadata object');
  }
  if (resolveAsset !== undefined && typeof resolveAsset !== 'function') throw new TypeError('resolveAsset must be a function');
  if (resolveWikiLink !== undefined && typeof resolveWikiLink !== 'function') throw new TypeError('resolveWikiLink must be a function');

  const diagnostics = [];
  const markdown = await preprocessMarkdown(body, {
    diagnostics,
    metadata,
    resolveAsset,
    resolveWikiLink,
  });
  const outline = [];
  const marked = new Marked({ gfm: true, renderer: createRenderer(outline, collectReservedFootnoteIds(markdown)) })
    .use(markedFootnote());
  const rendered = await marked.parse(markdown);
  return {
    html: sanitizeHtml(rendered, SANITIZE_OPTIONS),
    outline,
    diagnostics,
  };
}
