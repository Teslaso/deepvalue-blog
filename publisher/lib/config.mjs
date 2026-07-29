import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  resolveExistingContainedPath,
  resolveMissingContainedPath,
} from './studio-paths.mjs';

const DEFAULT_ENTRY_OUTPUT_DIR = 'src/content/entries';
const DEFAULT_MEDIA_OUTPUT_DIR = 'public/media';
const DEFAULT_IGNORE_FOLDERS = ['.obsidian', '.trash'];

function diagnostic(filename, field, message, code) {
  return { filename, field, message, ...(code ? { code } : {}) };
}

function isInside(root, candidate, { allowRoot = true } = {}) {
  const relative = path.relative(root, candidate);
  if (relative === '') return allowRoot;
  return !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

async function realpathAllowMissing(candidate) {
  const suffix = [];
  let current = candidate;

  while (true) {
    try {
      const resolved = await realpath(current);
      return path.resolve(resolved, ...suffix);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

async function resolveContainedPath({
  rawPath,
  root,
  field,
  filename,
  label,
  allowRoot = true,
}) {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    return {
      error: diagnostic(filename, field, `${label} must be a non-empty path`, 'invalid_path'),
    };
  }

  const candidate = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(root, rawPath);

  if (!isInside(root, candidate, { allowRoot })) {
    return {
      error: diagnostic(filename, field, `${label} resolves outside its allowed root`, 'path_escape'),
    };
  }

  try {
    const physicalCandidate = await realpathAllowMissing(candidate);
    if (!isInside(root, physicalCandidate, { allowRoot })) {
      return {
        error: diagnostic(filename, field, `${label} resolves outside its allowed root through a symlink`, 'path_escape'),
      };
    }
    return { value: physicalCandidate };
  } catch (error) {
    return {
      error: diagnostic(filename, field, `${label} could not be resolved: ${error.message}`, 'path_error'),
    };
  }
}

function normalizeStringList(value, fallback) {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === 'string' && item.trim() !== '')) return null;
  return value.map((item) => item.trim());
}

function studioDiagnosticFromPathError(filename, field, error) {
  return diagnostic(filename, field, error.message, error.code ?? 'path_error');
}

async function validateStudioConfig({ config, normalizedVaultRoot, filename, diagnostics }) {
  const hasWorkspaces = config.studioWorkspaces !== undefined;
  const hasAttachmentRoot = config.studioAttachmentRoot !== undefined;
  if (!hasWorkspaces && !hasAttachmentRoot) {
    return { studioWorkspaces: [], studioAttachmentRoot: undefined };
  }

  const studioWorkspaces = [];
  if (!hasWorkspaces) {
    diagnostics.push(diagnostic(
      filename,
      'studioWorkspaces',
      'Studio workspaces are required when a studio attachment destination is configured',
      'required',
    ));
  } else if (!Array.isArray(config.studioWorkspaces)) {
    diagnostics.push(diagnostic(
      filename,
      'studioWorkspaces',
      'Studio workspaces must be an array',
      'invalid_type',
    ));
  } else {
    const workspaceIds = new Set();
    for (const [index, workspace] of config.studioWorkspaces.entries()) {
      const field = `studioWorkspaces[${index}]`;
      if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) {
        diagnostics.push(diagnostic(filename, field, 'Studio workspace must be an object', 'invalid_type'));
        continue;
      }

      const idField = `${field}.id`;
      if (typeof workspace.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(workspace.id)) {
        diagnostics.push(diagnostic(
          filename,
          idField,
          'Studio workspace ID must use lowercase letters, numbers, and single hyphens',
          'invalid_workspace_id',
        ));
      }
      if (typeof workspace.id === 'string') {
        if (workspaceIds.has(workspace.id)) {
          diagnostics.push(diagnostic(
            filename,
            idField,
            `Studio workspace ID "${workspace.id}" must be unique`,
            'duplicate_workspace_id',
          ));
        }
        workspaceIds.add(workspace.id);
      }

      const labelField = `${field}.label`;
      if (typeof workspace.label !== 'string' || workspace.label.trim() === '') {
        diagnostics.push(diagnostic(
          filename,
          labelField,
          'Studio workspace label must be a non-empty string',
          'invalid_workspace_label',
        ));
      }

      const pathField = `${field}.path`;
      if (typeof workspace.path === 'string' && path.isAbsolute(workspace.path)) {
        diagnostics.push(diagnostic(
          filename,
          pathField,
          'Studio workspace path must be relative to the Vault',
          'absolute_path',
        ));
        continue;
      }
      if (!normalizedVaultRoot) continue;

      try {
        const resolvedPath = await resolveExistingContainedPath({
          root: normalizedVaultRoot,
          rawPath: workspace.path,
          label: 'Studio workspace path',
          allowRoot: false,
        });
        if (
          typeof workspace.id === 'string'
          && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(workspace.id)
          && typeof workspace.label === 'string'
          && workspace.label.trim() !== ''
        ) {
          studioWorkspaces.push({
            id: workspace.id,
            label: workspace.label.trim(),
            path: resolvedPath,
          });
        }
      } catch (error) {
        diagnostics.push(studioDiagnosticFromPathError(filename, pathField, error));
      }
    }
  }

  let studioAttachmentRoot;
  if (!hasAttachmentRoot) {
    diagnostics.push(diagnostic(
      filename,
      'studioAttachmentRoot',
      'Studio attachment destination is required when studio workspaces are configured',
      'required',
    ));
  } else if (typeof config.studioAttachmentRoot === 'string' && path.isAbsolute(config.studioAttachmentRoot)) {
    diagnostics.push(diagnostic(
      filename,
      'studioAttachmentRoot',
      'Studio attachment destination must be relative to the Vault',
      'absolute_path',
    ));
  } else if (normalizedVaultRoot) {
    try {
      studioAttachmentRoot = await resolveMissingContainedPath({
        root: normalizedVaultRoot,
        rawPath: config.studioAttachmentRoot,
        label: 'Studio attachment destination',
        allowRoot: false,
      });
    } catch (error) {
      diagnostics.push(studioDiagnosticFromPathError(filename, 'studioAttachmentRoot', error));
    }
  }

  return { studioWorkspaces, studioAttachmentRoot };
}

export class ConfigValidationError extends Error {
  constructor(diagnostics) {
    super(diagnostics.map(({ filename, field, message }) => `${filename}: ${field}: ${message}`).join('\n'));
    this.name = 'ConfigValidationError';
    this.diagnostics = diagnostics;
  }
}

export async function validatePublishConfig(rawConfig, {
  filename = 'publish.config.local.json',
  repoRoot = process.cwd(),
} = {}) {
  const diagnostics = [];
  const config = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
    ? rawConfig
    : {};

  let normalizedRepoRoot;
  try {
    const repoStats = await stat(path.resolve(repoRoot));
    if (!repoStats.isDirectory()) throw new Error('not a directory');
    normalizedRepoRoot = await realpath(path.resolve(repoRoot));
  } catch (error) {
    throw new ConfigValidationError([
      diagnostic(filename, 'repoRoot', `Repository root must exist and be a directory: ${error.message}`, 'missing_directory'),
    ]);
  }

  let normalizedVaultRoot;
  if (typeof config.vaultRoot !== 'string' || !path.isAbsolute(config.vaultRoot)) {
    diagnostics.push(diagnostic(filename, 'vaultRoot', 'Vault root must be an absolute path', 'invalid_path'));
  } else {
    try {
      const vaultStats = await stat(config.vaultRoot);
      if (!vaultStats.isDirectory()) throw new Error('path is not a directory');
      normalizedVaultRoot = await realpath(config.vaultRoot);
    } catch (error) {
      diagnostics.push(diagnostic(
        filename,
        'vaultRoot',
        `Vault root must exist and be a directory: ${error.message}`,
        'missing_directory',
      ));
    }
  }

  if (
    normalizedVaultRoot
    && (
      isInside(normalizedRepoRoot, normalizedVaultRoot)
      || isInside(normalizedVaultRoot, normalizedRepoRoot)
    )
  ) {
    diagnostics.push(diagnostic(
      filename,
      'vaultRoot',
      'Vault root and repository root must not contain or equal one another',
      'nested_roots',
    ));
  }

  const entryResult = await resolveContainedPath({
    rawPath: config.entryOutputDir ?? DEFAULT_ENTRY_OUTPUT_DIR,
    root: normalizedRepoRoot,
    field: 'entryOutputDir',
    filename,
    label: 'Entry output directory',
    allowRoot: false,
  });
  if (entryResult.error) diagnostics.push(entryResult.error);

  const mediaResult = await resolveContainedPath({
    rawPath: config.mediaOutputDir ?? DEFAULT_MEDIA_OUTPUT_DIR,
    root: normalizedRepoRoot,
    field: 'mediaOutputDir',
    filename,
    label: 'Media output directory',
    allowRoot: false,
  });
  if (mediaResult.error) diagnostics.push(mediaResult.error);

  const rawAttachmentRoots = config.attachmentRoots ?? ['.'];
  const attachmentRoots = [];
  if (!Array.isArray(rawAttachmentRoots) || rawAttachmentRoots.length === 0) {
    diagnostics.push(diagnostic(
      filename,
      'attachmentRoots',
      'Attachment roots must be a non-empty array of paths',
      'invalid_type',
    ));
  } else if (normalizedVaultRoot) {
    for (const [index, attachmentRoot] of rawAttachmentRoots.entries()) {
      const result = await resolveContainedPath({
        rawPath: attachmentRoot,
        root: normalizedVaultRoot,
        field: `attachmentRoots[${index}]`,
        filename,
        label: 'Attachment root',
      });
      if (result.error) diagnostics.push(result.error);
      else attachmentRoots.push(result.value);
    }
  }

  const ignoreFolders = normalizeStringList(config.ignoreFolders, DEFAULT_IGNORE_FOLDERS);
  if (!ignoreFolders) {
    diagnostics.push(diagnostic(
      filename,
      'ignoreFolders',
      'Ignored folders must be an array of non-empty strings',
      'invalid_type',
    ));
  }

  const includeInlineHashtags = config.includeInlineHashtags ?? true;
  if (typeof includeInlineHashtags !== 'boolean') {
    diagnostics.push(diagnostic(
      filename,
      'includeInlineHashtags',
      'includeInlineHashtags must be a boolean',
      'invalid_type',
    ));
  }

  const studioConfig = await validateStudioConfig({
    config,
    normalizedVaultRoot,
    filename,
    diagnostics,
  });

  if (diagnostics.length > 0) throw new ConfigValidationError(diagnostics);

  return {
    repoRoot: normalizedRepoRoot,
    vaultRoot: normalizedVaultRoot,
    entryOutputDir: entryResult.value,
    mediaOutputDir: mediaResult.value,
    attachmentRoots,
    ignoreFolders,
    includeInlineHashtags,
    ...studioConfig,
  };
}

export async function loadPublishConfig({
  configPath,
  repoRoot = process.cwd(),
} = {}) {
  const resolvedConfigPath = path.resolve(configPath ?? path.join(repoRoot, 'publish.config.local.json'));
  let raw;
  try {
    raw = await readFile(resolvedConfigPath, 'utf8');
  } catch (error) {
    throw new ConfigValidationError([
      diagnostic(resolvedConfigPath, '<root>', `Could not read configuration: ${error.message}`, 'read_error'),
    ]);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ConfigValidationError([
      diagnostic(resolvedConfigPath, '<root>', `Configuration must be valid JSON: ${error.message}`, 'invalid_json'),
    ]);
  }

  return validatePublishConfig(parsed, { filename: resolvedConfigPath, repoRoot });
}
