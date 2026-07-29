import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import {
  readFile,
  realpath,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

import { saveStudioAttachment as defaultSaveStudioAttachment } from './lib/studio-attachments.mjs';
import {
  createStudioDocument as defaultCreateStudioDocument,
  readStudioDocument as defaultReadStudioDocument,
  saveStudioDocument as defaultSaveStudioDocument,
} from './lib/studio-document.mjs';
import { renderStudioPreview as defaultRenderStudioPreview } from './lib/studio-preview.mjs';
import { createStudioPublisher as defaultCreateStudioPublisher } from './lib/studio-publish.mjs';
import { scanStudioWorkspace as defaultScanStudioWorkspace } from './lib/studio-workspace.mjs';

const LOOPBACK_HOST = '127.0.0.1';
const STUDIO_ROUTE = '/_studio/';
const API_PREFIX = '/_studio/api/';
const ASSET_PREFIX = '/_studio/assets/';
const FINAL_PREVIEW_PREFIX = '/_studio/final-preview/';
const JSON_LIMIT = 2 * 1024 * 1024;
const ATTACHMENT_LIMIT = 25 * 1024 * 1024;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u;
const DEFAULT_PUBLIC_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'studio',
);

const UI_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "frame-src 'self'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
].join('; ');

const PREVIEW_CSP = [
  "default-src 'self' data:",
  "base-uri 'none'",
  "connect-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'none'",
  "style-src 'self' 'unsafe-inline'",
].join('; ');

class StudioHttpError extends Error {
  constructor(status, code, message, { destroyRequest = false } = {}) {
    super(message);
    this.name = 'StudioHttpError';
    this.status = status;
    this.code = code;
    this.destroyRequest = destroyRequest;
  }
}

function safeJson(value) {
  return JSON.stringify(value)
    .replaceAll('&', '\\u0026')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function contentType(filename) {
  switch (path.extname(filename).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js':
    case '.mjs': return 'text/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.avif': return 'image/avif';
    case '.woff': return 'font/woff';
    case '.woff2': return 'font/woff2';
    case '.ttf': return 'font/ttf';
    case '.otf': return 'font/otf';
    default: return 'application/octet-stream';
  }
}

function securityHeaders(csp, type) {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': csp,
    'Content-Type': type,
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': csp === UI_CSP ? 'DENY' : 'SAMEORIGIN',
  };
}

function jsonResponse(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    ...securityHeaders(UI_CSP, 'application/json; charset=utf-8'),
    ...extraHeaders,
  });
  response.end(`${safeJson(body)}\n`);
}

function plainResponse(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    ...securityHeaders(UI_CSP, 'text/plain; charset=utf-8'),
    ...extraHeaders,
  });
  response.end(body);
}

function tokenMatches(expected, candidate) {
  if (typeof candidate !== 'string') return false;
  const expectedBytes = Buffer.from(expected, 'utf8');
  const candidateBytes = Buffer.from(candidate, 'utf8');
  return expectedBytes.length === candidateBytes.length
    && timingSafeEqual(expectedBytes, candidateBytes);
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function decodedRelativePath(rawPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return undefined;
  }
  if (
    decoded.includes('\0')
    || decoded.includes('\\')
    || decoded.startsWith('/')
    || decoded.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    return undefined;
  }
  const segments = decoded.split('/').filter(Boolean);
  if (segments.length === 0) return undefined;
  return { decoded, segments };
}

async function containedFile(root, rawPath, { directoryIndex = false } = {}) {
  const relative = decodedRelativePath(rawPath);
  if (!relative) return undefined;
  const base = path.join(root, ...relative.segments);
  const candidates = directoryIndex && relative.decoded.endsWith('/')
    ? [path.join(base, 'index.html')]
    : directoryIndex
      ? [base, path.join(base, 'index.html')]
      : [base];

  for (const candidate of candidates) {
    try {
      const physicalPath = await realpath(candidate);
      const details = await stat(physicalPath);
      if (!isInside(root, physicalPath) || !details.isFile()) continue;
      return {
        bytes: await readFile(physicalPath),
        filename: physicalPath,
      };
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error?.code)) throw error;
    }
  }
  return undefined;
}

function prefixedPreviewUrl(value) {
  if (
    !value.startsWith('/')
    || value.startsWith('//')
    || value.startsWith(FINAL_PREVIEW_PREFIX)
  ) {
    return value;
  }
  return `${FINAL_PREVIEW_PREFIX.slice(0, -1)}${value}`;
}

function rewritePreviewFile(file) {
  const extension = path.extname(file.filename).toLowerCase();
  if (extension !== '.html' && extension !== '.css') return file.bytes;
  let source = file.bytes.toString('utf8');
  if (extension === '.html') {
    source = source.replace(
      /\b(href|src|action|poster)=(["'])(\/(?!\/)[^"']*)\2/giu,
      (_match, attribute, quote, value) => `${attribute}=${quote}${prefixedPreviewUrl(value)}${quote}`,
    );
    source = source.replace(
      /\bsrcset=(["'])([^"']*)\1/giu,
      (_match, quote, value) => {
        const rewritten = value.split(',').map((candidate) => {
          const parts = candidate.trim().split(/\s+/u);
          parts[0] = prefixedPreviewUrl(parts[0]);
          return parts.join(' ');
        }).join(', ');
        return `srcset=${quote}${rewritten}${quote}`;
      },
    );
  }
  source = source.replace(
    /url\(\s*(["']?)(\/(?!\/)[^)"']*)\1\s*\)/giu,
    (_match, quote, value) => `url(${quote}${prefixedPreviewUrl(value)}${quote})`,
  );
  return Buffer.from(source, 'utf8');
}

function closeHttpServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function requestLength(request) {
  const value = request.headers['content-length'];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new StudioHttpError(400, 'malformed_request', 'Malformed request');
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new StudioHttpError(413, 'request_too_large', 'Request too large', {
      destroyRequest: true,
    });
  }
  return length;
}

async function readRequestBody(request, limit) {
  const declaredLength = requestLength(request);
  if (declaredLength !== undefined && declaredLength > limit) {
    request.pause();
    throw new StudioHttpError(413, 'request_too_large', 'Request too large', {
      destroyRequest: true,
    });
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    request.on('data', (chunk) => {
      if (settled) return;
      length += chunk.length;
      if (length > limit) {
        request.pause();
        fail(new StudioHttpError(413, 'request_too_large', 'Request too large', {
          destroyRequest: true,
        }));
        return;
      }
      chunks.push(chunk);
    });
    request.once('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, length));
    });
    request.once('aborted', () => {
      fail(new StudioHttpError(400, 'malformed_request', 'Malformed request'));
    });
    request.once('error', () => {
      fail(new StudioHttpError(400, 'malformed_request', 'Malformed request'));
    });
  });
}

async function readJson(request) {
  const type = request.headers['content-type'];
  if (typeof type !== 'string' || !/^application\/json(?:\s*;|$)/iu.test(type)) {
    throw new StudioHttpError(400, 'malformed_request', 'Malformed request');
  }
  const bytes = await readRequestBody(request, JSON_LIMIT);
  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new StudioHttpError(400, 'malformed_request', 'Malformed request');
  }
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new StudioHttpError(400, 'malformed_request', 'Malformed request');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StudioHttpError(400, 'malformed_request', 'Malformed request');
  }
  return value;
}

function requiredQuery(requestUrl, key) {
  const value = requestUrl.searchParams.get(key);
  if (typeof value !== 'string' || value === '') {
    throw new StudioHttpError(400, 'malformed_request', 'Malformed request');
  }
  return value;
}

function requiredFingerprint(value) {
  if (typeof value !== 'string' || !FINGERPRINT_PATTERN.test(value)) {
    throw new StudioHttpError(400, 'malformed_request', 'Malformed request');
  }
  return value;
}

function decodedHeader(request, name, { required = false } = {}) {
  const value = request.headers[name];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value === '') {
    throw new StudioHttpError(400, 'malformed_request', 'Malformed request');
  }
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new StudioHttpError(400, 'malformed_request', 'Malformed request');
  }
  if (/[\u0000-\u001f\u007f]/u.test(decoded)) {
    throw new StudioHttpError(400, 'malformed_request', 'Malformed request');
  }
  return decoded;
}

function attachmentMimeType(request) {
  const value = request.headers['content-type'];
  if (typeof value !== 'string') {
    throw new StudioHttpError(400, 'malformed_request', 'Malformed request');
  }
  const mimeType = value.split(';', 1)[0].trim().toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(mimeType)) {
    throw new StudioHttpError(400, 'malformed_request', 'Malformed request');
  }
  return mimeType;
}

function safeDiagnostics(error) {
  if (!Array.isArray(error?.diagnostics)) return undefined;
  return error.diagnostics.slice(0, 100).map((entry = {}) => ({
    field: typeof entry.field === 'string'
      && /^(?:<frontmatter>|[a-z_]+(?:\[\d+\])?)$/u.test(entry.field)
      ? entry.field
      : '<metadata>',
    code: typeof entry.code === 'string' && /^[a-z0-9_]+$/u.test(entry.code)
      ? entry.code
      : 'invalid_publication',
    message: 'Publication metadata is invalid',
  }));
}

function publicError(error) {
  if (error instanceof StudioHttpError) {
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message } },
      destroyRequest: error.destroyRequest,
    };
  }

  const code = typeof error?.code === 'string' ? error.code : '';
  const validationNames = new Set([
    'FrontmatterParseError',
    'PublicationPreparationError',
    'PublicationValidationError',
    'TransformError',
    'VaultIndexError',
  ]);
  if (validationNames.has(error?.name)) {
    return {
      status: 422,
      body: {
        error: {
          code: 'publication_validation_failed',
          message: 'Publication validation failed',
          ...(safeDiagnostics(error) ? { diagnostics: safeDiagnostics(error) } : {}),
        },
      },
    };
  }

  if (['document_not_found', 'transaction_not_found', 'workspace_not_found'].includes(code)) {
    return {
      status: 404,
      body: { error: { code: 'not_found', message: 'Not found' } },
    };
  }
  if ([
    'destination_conflict',
    'destination_exists',
    'external_change',
    'publish_id_locked',
    'repository_changed',
    'target_changed',
    'target_conflict',
    'transaction_active',
    'transaction_already_used',
    'transaction_id_collision',
  ].includes(code)) {
    return {
      status: 409,
      body: { error: { code: code || 'conflict', message: 'Conflict' } },
    };
  }
  if (code === 'attachment_too_large') {
    return {
      status: 413,
      body: { error: { code: 'request_too_large', message: 'Request too large' } },
    };
  }
  if ([
    'invalid_alt',
    'invalid_attachment',
    'invalid_config',
    'invalid_filename',
    'invalid_input',
    'unsafe_path',
    'unsupported_attachment',
  ].includes(code)) {
    return {
      status: 400,
      body: { error: { code: 'malformed_request', message: 'Malformed request' } },
    };
  }
  return {
    status: 500,
    body: { error: { code: 'internal_error', message: 'Studio request failed' } },
  };
}

function publicationRoute(route) {
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//')) {
    throw new StudioHttpError(500, 'internal_error', 'Studio request failed');
  }
  const parsed = new URL(route, 'http://studio.invalid');
  if (parsed.origin !== 'http://studio.invalid' || parsed.search || parsed.hash) {
    throw new StudioHttpError(500, 'internal_error', 'Studio request failed');
  }
  return parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
}

async function physicalDirectory(candidate) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) {
    throw new StudioHttpError(500, 'internal_error', 'Studio request failed');
  }
  const physical = await realpath(candidate);
  const details = await stat(physical);
  if (!details.isDirectory()) {
    throw new StudioHttpError(500, 'internal_error', 'Studio request failed');
  }
  return physical;
}

function methodNotAllowed(response, methods) {
  jsonResponse(
    response,
    405,
    { error: { code: 'method_not_allowed', message: 'Method Not Allowed' } },
    { Allow: methods.join(', ') },
  );
}

export async function startStudioServer({
  config,
  publicRoot = DEFAULT_PUBLIC_ROOT,
  openBrowser,
} = {}, overrides = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('A normalized Studio config is required');
  }
  if (openBrowser !== undefined && typeof openBrowser !== 'function') {
    throw new TypeError('openBrowser must be a function');
  }

  const modules = {
    scanStudioWorkspace: defaultScanStudioWorkspace,
    readStudioDocument: defaultReadStudioDocument,
    createStudioDocument: defaultCreateStudioDocument,
    saveStudioDocument: defaultSaveStudioDocument,
    saveStudioAttachment: defaultSaveStudioAttachment,
    renderStudioPreview: defaultRenderStudioPreview,
    createStudioPublisher: defaultCreateStudioPublisher,
    ...overrides,
  };
  const publisher = modules.createStudioPublisher({ config });
  if (
    !publisher
    || typeof publisher.prepare !== 'function'
    || typeof publisher.confirm !== 'function'
    || typeof publisher.cancel !== 'function'
  ) {
    throw new TypeError('createStudioPublisher must return prepare, confirm, and cancel methods');
  }

  const physicalPublicRoot = await physicalDirectory(publicRoot);
  const pageTemplate = await readFile(path.join(physicalPublicRoot, 'index.html'), 'utf8');
  if (!pageTemplate.includes('__STUDIO_DATA__')) {
    throw new TypeError('Studio index must contain __STUDIO_DATA__');
  }

  const token = randomBytes(32).toString('base64url');
  let allowedHost;
  let previewState;
  let closingPromise;
  let resolveResult;
  let rejectResult;
  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  result.catch(() => {});

  const routes = new Map([
    ['/workspaces', ['GET']],
    ['/document', ['GET', 'POST', 'PUT']],
    ['/document/resolve-conflict', ['PUT']],
    ['/attachment', ['POST']],
    ['/preview', ['POST']],
    ['/publish/prepare', ['POST']],
    ['/publish/confirm', ['POST']],
    ['/publish/cancel', ['POST']],
  ]);

  async function handleApi(request, response, requestUrl, route) {
    const methods = routes.get(route);
    if (!methods) {
      jsonResponse(response, 404, { error: { code: 'not_found', message: 'Not found' } });
      return;
    }
    if (!methods.includes(request.method ?? '')) {
      methodNotAllowed(response, methods);
      return;
    }
    if (!tokenMatches(token, request.headers['x-studio-token'])) {
      jsonResponse(response, 403, { error: { code: 'forbidden', message: 'Forbidden' } });
      return;
    }

    if (route === '/workspaces') {
      const workspaces = await modules.scanStudioWorkspace(config);
      jsonResponse(response, 200, { workspaces });
      return;
    }
    if (route === '/document' && request.method === 'GET') {
      const document = await modules.readStudioDocument(config, {
        workspaceId: requiredQuery(requestUrl, 'workspaceId'),
        relativePath: requiredQuery(requestUrl, 'path'),
      });
      jsonResponse(response, 200, { document });
      return;
    }
    if (route === '/document' && request.method === 'POST') {
      const document = await modules.createStudioDocument(config, await readJson(request));
      jsonResponse(response, 201, { document });
      return;
    }
    if (route === '/document' && request.method === 'PUT') {
      const document = await modules.saveStudioDocument(config, await readJson(request));
      jsonResponse(response, 200, { document });
      return;
    }
    if (route === '/document/resolve-conflict') {
      const input = await readJson(request);
      const staleFingerprint = requiredFingerprint(input.staleFingerprint);
      const currentFingerprint = requiredFingerprint(input.currentFingerprint);
      if (
        staleFingerprint === currentFingerprint
        || typeof input.source !== 'string'
        || input.force === true
      ) {
        throw new StudioHttpError(400, 'malformed_request', 'Malformed request');
      }
      const current = await modules.readStudioDocument(config, {
        workspaceId: input.workspaceId,
        relativePath: input.relativePath,
      });
      if (current?.fingerprint !== currentFingerprint) {
        throw Object.assign(new Error('Conflict'), { code: 'external_change' });
      }
      const document = await modules.saveStudioDocument(config, {
        workspaceId: input.workspaceId,
        relativePath: input.relativePath,
        expectedFingerprint: currentFingerprint,
        source: input.source,
      });
      jsonResponse(response, 200, { document });
      return;
    }
    if (route === '/attachment') {
      const filename = decodedHeader(request, 'x-studio-filename', { required: true });
      const mimeType = attachmentMimeType(request);
      const alt = decodedHeader(request, 'x-studio-alt');
      const bytes = await readRequestBody(request, ATTACHMENT_LIMIT);
      const attachment = await modules.saveStudioAttachment(config, {
        bytes,
        filename,
        mimeType,
        alt,
      });
      jsonResponse(response, 201, { attachment });
      return;
    }
    if (route === '/preview') {
      const input = await readJson(request);
      if (
        typeof input.body !== 'string'
        || (
          input.metadata !== undefined
          && (
            !input.metadata
            || typeof input.metadata !== 'object'
            || Array.isArray(input.metadata)
          )
        )
      ) {
        throw new StudioHttpError(400, 'malformed_request', 'Malformed request');
      }
      const preview = await modules.renderStudioPreview(input);
      jsonResponse(response, 200, { preview });
      return;
    }
    if (route === '/publish/prepare') {
      const prepared = await publisher.prepare(await readJson(request));
      try {
        const previewRoot = await physicalDirectory(prepared?.previewRoot);
        const routePath = publicationRoute(prepared?.route);
        const current = Object.freeze({
          transactionId: prepared.transactionId,
          previewRoot,
          routePath,
        });
        previewState = current;
        const { previewRoot: _privatePreviewRoot, ...publication } = prepared;
        jsonResponse(response, 200, {
          publication: {
            ...publication,
            previewUrl: `${FINAL_PREVIEW_PREFIX.slice(0, -1)}${routePath}`,
          },
        });
      } catch (error) {
        if (typeof prepared?.transactionId === 'string') {
          await publisher.cancel({ transactionId: prepared.transactionId }).catch(() => {});
        }
        throw error;
      }
      return;
    }
    if (route === '/publish/confirm') {
      const input = await readJson(request);
      const transactionId = input.transactionId;
      const confirmed = await publisher.confirm(input);
      if (previewState?.transactionId === transactionId) previewState = undefined;
      jsonResponse(response, 200, { result: confirmed });
      return;
    }
    if (route === '/publish/cancel') {
      const input = await readJson(request);
      const transactionId = input.transactionId;
      const canceled = await publisher.cancel(input);
      if (previewState?.transactionId === transactionId) previewState = undefined;
      jsonResponse(response, 200, { result: canceled });
    }
  }

  const server = createServer(async (request, response) => {
    try {
      if (request.headers.host !== allowedHost) {
        plainResponse(response, 421, 'Misdirected Request');
        return;
      }
      const rawUrl = request.url;
      if (typeof rawUrl !== 'string' || !rawUrl.startsWith('/') || rawUrl.startsWith('//')) {
        plainResponse(response, 400, 'Malformed Request');
        return;
      }
      const origin = `http://${allowedHost}`;
      const requestUrl = new URL(rawUrl, origin);
      if (requestUrl.origin !== origin) {
        plainResponse(response, 421, 'Misdirected Request');
        return;
      }
      const { pathname } = requestUrl;

      if (pathname === STUDIO_ROUTE) {
        if (request.method !== 'GET') {
          methodNotAllowed(response, ['GET']);
          return;
        }
        response.writeHead(200, securityHeaders(UI_CSP, 'text/html; charset=utf-8'));
        response.end(pageTemplate.replace('__STUDIO_DATA__', safeJson({ token })));
        return;
      }

      if (pathname.startsWith(ASSET_PREFIX)) {
        if (request.method !== 'GET') {
          methodNotAllowed(response, ['GET']);
          return;
        }
        const file = await containedFile(
          physicalPublicRoot,
          `assets/${pathname.slice(ASSET_PREFIX.length)}`,
        );
        if (file) {
          response.writeHead(200, securityHeaders(UI_CSP, contentType(file.filename)));
          response.end(file.bytes);
          return;
        }
        plainResponse(response, 404, 'Not Found');
        return;
      }

      if (pathname.startsWith(FINAL_PREVIEW_PREFIX)) {
        if (request.method !== 'GET') {
          methodNotAllowed(response, ['GET']);
          return;
        }
        const current = previewState;
        if (current) {
          const file = await containedFile(
            current.previewRoot,
            pathname.slice(FINAL_PREVIEW_PREFIX.length),
            { directoryIndex: true },
          );
          if (file && previewState === current) {
            response.writeHead(200, securityHeaders(PREVIEW_CSP, contentType(file.filename)));
            response.end(rewritePreviewFile(file));
            return;
          }
        }
        plainResponse(response, 404, 'Not Found');
        return;
      }

      if (pathname.startsWith(API_PREFIX)) {
        await handleApi(
          request,
          response,
          requestUrl,
          pathname.slice(API_PREFIX.length - 1),
        );
        return;
      }
      plainResponse(response, 404, 'Not Found');
    } catch (error) {
      const exposed = publicError(error);
      if (!response.headersSent) {
        jsonResponse(response, exposed.status, exposed.body);
      } else if (!response.writableEnded) {
        response.end();
      }
      if (exposed.destroyRequest) {
        response.once('finish', () => request.destroy());
      }
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, LOOPBACK_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  allowedHost = `${LOOPBACK_HOST}:${address.port}`;
  const url = `http://${allowedHost}${STUDIO_ROUTE}`;

  async function close() {
    if (closingPromise) return closingPromise;
    closingPromise = (async () => {
      let cleanupError;
      const current = previewState;
      previewState = undefined;
      if (current) {
        try {
          await publisher.cancel({ transactionId: current.transactionId });
        } catch (error) {
          cleanupError = error;
        }
      }
      await closeHttpServer(server);
      if (cleanupError) {
        rejectResult(cleanupError);
        throw cleanupError;
      }
      const outcome = { closed: true };
      resolveResult(outcome);
      return outcome;
    })();
    return closingPromise;
  }

  server.once('error', (error) => rejectResult(error));
  const studio = { server, url, close, result };
  if (openBrowser) {
    try {
      await openBrowser(url);
    } catch (error) {
      await close().catch(() => {});
      throw error;
    }
  }
  return studio;
}
