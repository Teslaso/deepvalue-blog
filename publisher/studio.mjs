import { spawn } from 'node:child_process';
import {
  cp,
  mkdtemp,
  rm,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadPublishConfig as defaultLoadPublishConfig } from './lib/config.mjs';
import { buildStudioAssets as defaultBundleClientAssets } from './build-studio.mjs';
import { startStudioServer as defaultStartStudioServer } from './studio-server.mjs';

const PUBLISHER_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(PUBLISHER_ROOT, '..');
const STUDIO_SOURCE_ROOT = path.join(PUBLISHER_ROOT, 'studio');

function defaultOpenBrowser(url) {
  const command = process.platform === 'darwin'
    ? { executable: 'open', args: [url] }
    : process.platform === 'win32'
      ? { executable: 'cmd.exe', args: ['/d', '/s', '/c', 'start', '', url] }
      : { executable: 'xdg-open', args: [url] };
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export async function buildStudioAssets({
  sourceRoot = STUDIO_SOURCE_ROOT,
  bundleClientAssets = defaultBundleClientAssets,
} = {}) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'deep-value-studio-'));
  const publicRoot = path.join(temporaryRoot, 'public');
  try {
    await cp(sourceRoot, publicRoot, { recursive: true, force: false });
    // 浏览器 bundle 输出到 publicRoot/assets（位于 OS 临时目录内），
    // 由服务端 /_studio/assets/* 路由提供；client/ 源文件不会被路由暴露。
    await bundleClientAssets({ outputDir: path.join(publicRoot, 'assets') });
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    publicRoot,
    cleanup: () => rm(temporaryRoot, { recursive: true, force: true }),
  };
}

function parseArguments(argv) {
  let open = true;
  for (const argument of argv) {
    if (argument === '--no-open') {
      open = false;
      continue;
    }
    throw new TypeError(`Unknown Studio option: ${argument}`);
  }
  return { open };
}

function requireStudioWorkspace(config) {
  if (!Array.isArray(config?.studioWorkspaces) || config.studioWorkspaces.length === 0) {
    const error = new Error(
      '写作台尚未配置：请在 publish.config.local.json 的 studioWorkspaces 中添加至少一个写作目录。',
    );
    error.code = 'studio_workspaces_required';
    throw error;
  }
}

export async function runStudio(argv = [], overrides = {}) {
  const dependencies = {
    repoRoot: DEFAULT_REPO_ROOT,
    loadPublishConfig: defaultLoadPublishConfig,
    buildStudioAssets,
    startStudioServer: defaultStartStudioServer,
    openBrowser: defaultOpenBrowser,
    write: (message) => process.stdout.write(`${message}\n`),
    processSignals: true,
    signalProcess: process,
    ...overrides,
  };
  const options = parseArguments(argv);
  const config = await dependencies.loadPublishConfig({ repoRoot: dependencies.repoRoot });
  requireStudioWorkspace(config);
  const assets = await dependencies.buildStudioAssets();
  let studio;
  let outcome;
  let primaryError;
  const signalHandlers = new Map();

  try {
    const browserOpener = options.open
      ? async (url) => {
          try {
            await dependencies.openBrowser(url);
          } catch {
            dependencies.write(`浏览器未能自动打开，请手动访问：${url}`);
          }
        }
      : undefined;
    studio = await dependencies.startStudioServer({
      config,
      publicRoot: assets.publicRoot,
      openBrowser: browserOpener,
    });
    dependencies.write(`Deep Value 写作台：${studio.url}`);

    if (dependencies.processSignals) {
      for (const signal of ['SIGINT', 'SIGTERM']) {
        const handler = () => {
          studio.close().catch(() => {});
        };
        signalHandlers.set(signal, handler);
        dependencies.signalProcess.once(signal, handler);
      }
    }
    outcome = await studio.result;
  } catch (error) {
    primaryError = error;
  }

  let closeError;
  let cleanupError;
  try {
    for (const [signal, handler] of signalHandlers) {
      try {
        dependencies.signalProcess.off(signal, handler);
      } catch (error) {
        closeError ??= error;
      }
    }
    if (studio) {
      try {
        await studio.close();
      } catch (error) {
        closeError ??= error;
      }
    }
  } finally {
    try {
      await assets.cleanup();
    } catch (error) {
      cleanupError = error;
    }
  }

  if (primaryError) throw primaryError;
  if (closeError) throw closeError;
  if (cleanupError) throw cleanupError;
  return outcome;
}

const directInvocation = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (directInvocation) {
  runStudio(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Deep Value 写作台启动失败：${error?.message ?? '未知错误'}\n`);
    process.exitCode = 1;
  });
}
