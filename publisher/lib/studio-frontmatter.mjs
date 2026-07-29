import { parseDocument } from 'yaml';

import { FrontmatterParseError, parseNoteMarkdown } from './frontmatter.mjs';

const FORM_FIELDS = [
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
];

const KNOWN_FIELD_NAMES = new Set([
  ...FORM_FIELDS.map(({ name }) => name),
  'source_title',
  'source_url',
]);

function diagnostic(filename, message, code) {
  return {
    filename,
    field: '<frontmatter>',
    message,
    ...(code ? { code } : {}),
  };
}

function findFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) return null;
  return {
    rawFrontmatter: match[1],
    bodyStart: match[0].length,
    lineEnding: source.includes('\r\n') ? '\r\n' : '\n',
  };
}

function parseYamlDocument(rawFrontmatter, filename) {
  const document = parseDocument(rawFrontmatter, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new FrontmatterParseError([
      diagnostic(filename, `Could not parse YAML frontmatter: ${document.errors[0].message}`, 'invalid_yaml'),
    ], document.errors[0]);
  }
  return document;
}

function yamlData(document, filename) {
  const data = document.toJS();
  if (data === null) return {};
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new FrontmatterParseError([
      diagnostic(filename, 'YAML frontmatter must be a mapping', 'invalid_yaml'),
    ]);
  }
  return data;
}

function serializeYaml(document, lineEnding) {
  return document.toString({ lineWidth: 0 }).replaceAll('\n', lineEnding);
}

function hasPublishId(value) {
  return value !== undefined && value !== null && value !== '';
}

function lockedPublishIdError() {
  const error = new Error('publish_id is locked once it has been set');
  error.name = 'StudioDocumentError';
  error.code = 'publish_id_locked';
  return error;
}

/**
 * Parses an editable Markdown note while retaining its raw YAML fields and body.
 */
export function parseStudioDocument(source, { filename = '<note>' } = {}) {
  const parsed = parseNoteMarkdown(source, { filename });
  const frontmatter = findFrontmatter(source);

  if (!frontmatter) {
    return {
      data: {},
      known: parsed.data,
      unknown: {},
      body: parsed.body,
      rawFrontmatter: '',
    };
  }

  const document = parseYamlDocument(frontmatter.rawFrontmatter, filename);
  const data = yamlData(document, filename);
  const unknown = Object.fromEntries(
    Object.entries(data).filter(([name]) => !KNOWN_FIELD_NAMES.has(name)),
  );

  return {
    data,
    known: parsed.data,
    unknown,
    body: parsed.body,
    rawFrontmatter: frontmatter.rawFrontmatter,
  };
}

/**
 * Applies an explicit form patch to YAML document nodes and replaces the body verbatim.
 */
export function serializeStudioDocument({ source, patch = {}, body } = {}) {
  const parsed = parseStudioDocument(source);
  const frontmatter = findFrontmatter(source);
  const document = parseYamlDocument(frontmatter?.rawFrontmatter ?? '', '<note>');

  if (
    Object.hasOwn(patch, 'publish_id')
    && hasPublishId(parsed.data.publish_id)
    && patch.publish_id !== parsed.data.publish_id
  ) {
    throw lockedPublishIdError();
  }

  for (const [name, value] of Object.entries(patch)) {
    document.set(name, value);
  }

  const lineEnding = frontmatter?.lineEnding ?? '\n';
  const nextBody = body === undefined ? parsed.body : body;
  return `---${lineEnding}${serializeYaml(document, lineEnding)}---${lineEnding}${nextBody}`;
}

export function publicationFormSchema({ domain, format } = {}) {
  void domain;
  void format;
  return FORM_FIELDS.map((field) => ({ ...field }));
}
