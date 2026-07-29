import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
} from 'node:fs/promises';
import path from 'node:path';

import {
  isPathInside,
  resolveMissingContainedPath,
} from './studio-paths.mjs';

const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;

export class StudioAttachmentError extends Error {
  constructor(message, code = 'attachment_error', cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'StudioAttachmentError';
    this.code = code;
  }
}

function attachmentError(message, code, cause) {
  return new StudioAttachmentError(message, code, cause);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hasPrefix(bytes, prefix) {
  return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

function imageExtension(bytes) {
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return 'jpg';
  if (hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return 'gif';
  if (
    hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46])
    && bytes.length >= 12
    && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
  ) return 'webp';
  if (
    bytes.length >= 12
    && Buffer.from(bytes.subarray(4, 8)).toString('ascii') === 'ftyp'
    && ['avif', 'avis'].includes(Buffer.from(bytes.subarray(8, 12)).toString('ascii'))
  ) return 'avif';
  return undefined;
}

function validBytes(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw attachmentError('Studio attachment bytes must be a byte array', 'invalid_input');
  }
  const bytes = Buffer.from(value);
  if (bytes.length === 0) throw attachmentError('Studio attachments cannot be empty', 'invalid_attachment');
  if (bytes.length > MAX_ATTACHMENT_SIZE) {
    throw attachmentError('Studio attachments cannot exceed 20 MiB', 'attachment_too_large');
  }
  return bytes;
}

function safeBasename(filename) {
  if (
    typeof filename !== 'string'
    || filename.trim() === ''
    || filename.includes('\0')
    || filename !== path.posix.basename(filename)
    || filename !== path.win32.basename(filename)
    || path.isAbsolute(filename)
    || path.win32.isAbsolute(filename)
  ) {
    throw attachmentError('Studio attachment filename must not contain a path', 'unsafe_path');
  }

  const stem = filename.replace(/\.[^.]*$/u, '').normalize('NFKC').toLowerCase();
  const basename = [...stem]
    .map((character) => (/^[\p{L}\p{N}]$/u.test(character) ? character : '-'))
    .join('')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');
  if (basename === '') {
    throw attachmentError('Studio attachment filename must contain letters or numbers', 'invalid_filename');
  }
  return basename;
}

function safeEmbedAlt(alt, fallback) {
  if (alt === undefined) return fallback;
  if (typeof alt !== 'string' || /[\]|\x00-\x1f\x7f]/u.test(alt)) {
    throw attachmentError('Studio attachment alias contains unsafe Obsidian syntax', 'invalid_alt');
  }
  return alt;
}

async function requiredDirectory(candidate, label) {
  let details;
  try {
    details = await lstat(candidate);
  } catch (error) {
    throw attachmentError(`${label} could not be inspected`, 'unsafe_path', error);
  }
  if (details.isSymbolicLink() || !details.isDirectory()) {
    throw attachmentError(`${label} must be a physical directory`, 'unsafe_path');
  }
  return details;
}

async function createContainedDirectory(vaultRoot, attachmentRoot) {
  const relative = path.relative(vaultRoot, attachmentRoot);
  let current = vaultRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw attachmentError('Studio attachment destination could not be created', 'unsafe_path', error);
    }
    await requiredDirectory(current, 'Studio attachment destination');
    const physicalCurrent = await realpath(current).catch((error) => {
      throw attachmentError('Studio attachment destination could not be resolved', 'unsafe_path', error);
    });
    if (!isPathInside(vaultRoot, physicalCurrent, { allowRoot: false })) {
      throw attachmentError('Studio attachment destination escapes the Vault', 'unsafe_path');
    }
  }
}

async function attachmentDestination(config) {
  if (
    !config
    || typeof config.vaultRoot !== 'string'
    || !path.isAbsolute(config.vaultRoot)
    || typeof config.studioAttachmentRoot !== 'string'
    || !path.isAbsolute(config.studioAttachmentRoot)
  ) {
    throw attachmentError('A normalized Vault and Studio attachment destination are required', 'invalid_config');
  }

  const vaultRoot = path.resolve(config.vaultRoot);
  const attachmentRoot = path.resolve(config.studioAttachmentRoot);
  await requiredDirectory(vaultRoot, 'Vault root');
  const physicalVaultRoot = await realpath(vaultRoot).catch((error) => {
    throw attachmentError('Vault root could not be resolved', 'unsafe_path', error);
  });
  if (physicalVaultRoot !== vaultRoot || !isPathInside(vaultRoot, attachmentRoot, { allowRoot: false })) {
    throw attachmentError('Studio attachment destination must be contained by the physical Vault', 'unsafe_path');
  }

  try {
    const resolved = await resolveMissingContainedPath({
      root: vaultRoot,
      rawPath: attachmentRoot,
      label: 'Studio attachment destination',
      allowRoot: false,
    });
    if (resolved !== attachmentRoot) {
      throw attachmentError('Studio attachment destination must be a physical Vault path', 'unsafe_path');
    }
  } catch (error) {
    if (error instanceof StudioAttachmentError) throw error;
    throw attachmentError('Studio attachment destination is not safely contained', 'unsafe_path', error);
  }

  await createContainedDirectory(vaultRoot, attachmentRoot);
  await requiredDirectory(attachmentRoot, 'Studio attachment destination');
  return { vaultRoot, attachmentRoot };
}

async function writeNewOrReuse(destination, bytes) {
  const temporaryPath = path.join(path.dirname(destination), `.studio-upload-${randomUUID()}`);
  let handle;
  try {
    handle = await open(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;

    try {
      await link(temporaryPath, destination);
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw attachmentError('Studio attachment could not be saved', 'write_error', error);
      }
    }

    let existingDetails;
    try {
      existingDetails = await lstat(destination);
    } catch (error) {
      throw attachmentError('Studio attachment destination changed during save', 'unsafe_path', error);
    }
    if (existingDetails.isSymbolicLink() || !existingDetails.isFile()) {
      throw attachmentError('Studio attachment destination must be a regular file', 'unsafe_path');
    }
    const existingBytes = await readFile(destination);
    if (!existingBytes.equals(bytes)) {
      throw attachmentError('A different Studio attachment already occupies this destination', 'destination_conflict');
    }
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

export async function saveStudioAttachment(config, { bytes: rawBytes, filename, mimeType: _mimeType, alt } = {}) {
  const bytes = validBytes(rawBytes);
  const extension = imageExtension(bytes);
  if (!extension) {
    throw attachmentError('Studio attachments must be PNG, JPEG, WebP, AVIF, or GIF images', 'unsupported_attachment');
  }
  const basename = safeBasename(filename);
  const embedAlt = safeEmbedAlt(alt, basename);
  const { vaultRoot, attachmentRoot } = await attachmentDestination(config);
  const digest = sha256(bytes);
  const fileName = `${basename}-${digest.slice(0, 8)}.${extension}`;
  const destination = path.join(attachmentRoot, fileName);
  const relativePath = path.relative(vaultRoot, destination).split(path.sep).join('/');

  if (!isPathInside(vaultRoot, destination, { allowRoot: false }) || relativePath.startsWith('../')) {
    throw attachmentError('Studio attachment destination escapes the Vault', 'unsafe_path');
  }
  await writeNewOrReuse(destination, bytes);

  return {
    relativePath,
    embed: `![[${relativePath}|${embedAlt}]]`,
    size: bytes.length,
    sha256: digest,
  };
}
