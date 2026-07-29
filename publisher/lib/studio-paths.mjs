import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

export class StudioPathError extends Error {
  constructor(message, code = 'path_error') {
    super(message);
    this.name = 'StudioPathError';
    this.code = code;
  }
}

export function isPathInside(root, candidate, { allowRoot = true } = {}) {
  const relative = path.relative(root, candidate);
  if (relative === '') return allowRoot;
  return !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function resolveCandidate(root, rawPath, label, allowRoot) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new StudioPathError(`${label} requires an absolute root`, 'invalid_root');
  }
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    throw new StudioPathError(`${label} must be a non-empty path`, 'invalid_path');
  }

  const candidate = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(root, rawPath);
  if (!isPathInside(root, candidate, { allowRoot })) {
    throw new StudioPathError(`${label} resolves outside its allowed root`, 'path_escape');
  }
  return candidate;
}

async function physicalRoot(root, label) {
  try {
    return await realpath(root);
  } catch (error) {
    throw new StudioPathError(`${label} root could not be resolved: ${error.message}`, 'path_error');
  }
}

async function closestExistingPhysicalPath(candidate, label) {
  const suffix = [];
  let current = candidate;

  while (true) {
    try {
      const resolved = await realpath(current);
      return path.resolve(resolved, ...suffix);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new StudioPathError(`${label} could not be resolved: ${error.message}`, 'path_error');
      }

      try {
        await lstat(current);
        throw new StudioPathError(`${label} contains an unresolved symlink`, 'path_error');
      } catch (lstatError) {
        if (lstatError instanceof StudioPathError) throw lstatError;
        if (lstatError?.code !== 'ENOENT') {
          throw new StudioPathError(`${label} could not be inspected: ${lstatError.message}`, 'path_error');
        }
      }

      const parent = path.dirname(current);
      if (parent === current) {
        throw new StudioPathError(`${label} could not be resolved: ${error.message}`, 'path_error');
      }
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

export async function resolveExistingContainedPath({
  root,
  rawPath,
  label,
  allowRoot = true,
}) {
  const candidate = resolveCandidate(root, rawPath, label, allowRoot);
  const [physicalRootPath, physicalCandidate] = await Promise.all([
    physicalRoot(root, label),
    realpath(candidate).catch((error) => {
      throw new StudioPathError(`${label} must exist and be resolvable: ${error.message}`, 'missing_path');
    }),
  ]);

  if (!isPathInside(physicalRootPath, physicalCandidate, { allowRoot })) {
    throw new StudioPathError(`${label} resolves outside its allowed root through a symlink`, 'path_escape');
  }
  return physicalCandidate;
}

export async function resolveMissingContainedPath({
  root,
  rawPath,
  label,
  allowRoot = true,
}) {
  const candidate = resolveCandidate(root, rawPath, label, allowRoot);
  const physicalRootPath = await physicalRoot(root, label);
  const physicalCandidate = await closestExistingPhysicalPath(candidate, label);

  if (!isPathInside(physicalRootPath, physicalCandidate, { allowRoot })) {
    throw new StudioPathError(`${label} resolves outside its allowed root through a symlink`, 'path_escape');
  }
  return physicalCandidate;
}
