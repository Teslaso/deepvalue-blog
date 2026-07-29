import { build } from 'esbuild';
import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLISHER_ROOT = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ENTRY = path.join(PUBLISHER_ROOT, 'studio', 'client', 'index.js');
const EDITOR_CSS = `
.dv-markdown-editor { min-height: 24rem; }
.dv-markdown-editor .cm-editor { height: 100%; }
.dv-markdown-editor .cm-scroller { overflow: auto; }
`;

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

async function resolveOutputDirectory(outputDir) {
  const temporaryAlias = path.resolve(os.tmpdir());
  const temporaryRoot = await realpath(os.tmpdir());
  if (outputDir === undefined) {
    return mkdtemp(path.join(temporaryRoot, 'deep-value-studio-'));
  }
  const requested = path.resolve(outputDir);
  if (
    !isContained(temporaryAlias, requested)
    && !isContained(temporaryRoot, requested)
  ) {
    throw new TypeError('Studio assets must be built below the operating-system temporary directory');
  }
  await mkdir(requested, { recursive: true });
  const physical = await realpath(requested);
  if (!isContained(temporaryRoot, physical)) {
    throw new TypeError('Studio assets must be built below the operating-system temporary directory');
  }
  return physical;
}

export async function buildStudioAssets({ outputDir } = {}) {
  const target = await resolveOutputDirectory(outputDir);
  const jsPath = path.join(target, 'studio.js');
  const cssPath = path.join(target, 'studio.css');
  const sourcemap = process.env.NODE_ENV !== 'production';

  await Promise.all([
    build({
      entryPoints: [CLIENT_ENTRY],
      outfile: jsPath,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: ['es2022'],
      sourcemap,
      logLevel: 'silent',
    }),
    build({
      stdin: {
        contents: EDITOR_CSS,
        loader: 'css',
        resolveDir: PUBLISHER_ROOT,
        sourcefile: 'studio-editor.css',
      },
      outfile: cssPath,
      bundle: true,
      platform: 'browser',
      target: ['es2022'],
      sourcemap,
      logLevel: 'silent',
    }),
  ]);

  return { jsPath, cssPath };
}
