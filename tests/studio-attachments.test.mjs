import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { saveStudioAttachment } from '../publisher/lib/studio-attachments.mjs';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
const AVIF = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0x00, 0x00, 0x00, 0x00]);
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00', 'binary');

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-attachments-'));
  const vaultRoot = path.join(root, 'vault');
  const studioAttachmentRoot = path.join(vaultRoot, 'Attachments/Studio');
  await mkdir(studioAttachmentRoot, { recursive: true });
  const physicalVaultRoot = await realpath(vaultRoot);
  return {
    root,
    vaultRoot: physicalVaultRoot,
    config: {
      vaultRoot: physicalVaultRoot,
      studioAttachmentRoot: path.join(physicalVaultRoot, 'Attachments/Studio'),
    },
  };
}

async function removeFixture(root) {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}

test('saveStudioAttachment identifies supported image formats by magic bytes and returns the Obsidian embed contract', async () => {
  const fixture = await createFixture();

  try {
    const formats = [
      ['png', PNG, 'png'],
      ['jpeg', JPEG, 'jpg'],
      ['webp', WEBP, 'webp'],
      ['avif', AVIF, 'avif'],
      ['gif', GIF, 'gif'],
    ];

    for (const [name, bytes, extension] of formats) {
      const saved = await saveStudioAttachment(fixture.config, {
        bytes,
        filename: `${name} chart.claimed-extension`,
        mimeType: 'application/octet-stream',
        alt: '炼化利润图',
      });

      assert.match(saved.relativePath, new RegExp(`^Attachments/Studio/${name}-chart-[a-f0-9]{8}\\.${extension}$`, 'u'));
      assert.equal(saved.embed, `![[${saved.relativePath}|炼化利润图]]`);
      assert.equal(saved.size, bytes.length);
      assert.match(saved.sha256, /^[a-f0-9]{64}$/u);
      assert.deepEqual(await readFile(path.join(fixture.vaultRoot, saved.relativePath)), bytes);
    }
  } finally {
    await removeFixture(fixture.root);
  }
});

test('saveStudioAttachment rejects MIME-only spoofing and unsupported attachment content', async () => {
  const fixture = await createFixture();

  try {
    for (const bytes of [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      Buffer.from('%PDF-1.7\n'),
      Buffer.from('ID3\x04\x00\x00', 'binary'),
      Buffer.alloc(0),
    ]) {
      await assert.rejects(
        saveStudioAttachment(fixture.config, {
          bytes,
          filename: 'claimed-image.png',
          mimeType: 'image/png',
          alt: '图',
        }),
      );
    }

    await assert.rejects(
      saveStudioAttachment(fixture.config, {
        bytes: Buffer.alloc((20 * 1024 * 1024) + 1, 1),
        filename: 'oversized.png',
        mimeType: 'image/png',
        alt: '图',
      }),
    );
  } finally {
    await removeFixture(fixture.root);
  }
});

test('saveStudioAttachment rejects unsafe filenames rather than allowing path traversal', async () => {
  const fixture = await createFixture();

  try {
    for (const filename of ['../outside.png', 'nested/file.png', 'nested\\file.png', '/absolute.png']) {
      await assert.rejects(
        saveStudioAttachment(fixture.config, { bytes: PNG, filename, mimeType: 'image/png', alt: '图' }),
      );
    }
  } finally {
    await removeFixture(fixture.root);
  }
});

test('saveStudioAttachment rejects a symlinked attachment destination', async () => {
  const fixture = await createFixture();
  const outside = path.join(fixture.root, 'outside');

  try {
    await mkdir(outside);
    await rm(fixture.config.studioAttachmentRoot, { recursive: true });
    await symlink(outside, fixture.config.studioAttachmentRoot);

    await assert.rejects(
      saveStudioAttachment(fixture.config, {
        bytes: PNG,
        filename: 'chart.png',
        mimeType: 'image/png',
        alt: '图',
      }),
    );
    assert.equal((await lstat(fixture.config.studioAttachmentRoot)).isSymbolicLink(), true);
  } finally {
    await removeFixture(fixture.root);
  }
});

test('saveStudioAttachment reuses an identical destination and never overwrites different bytes', async () => {
  const fixture = await createFixture();

  try {
    const input = {
      bytes: PNG,
      filename: 'Refining margin!!.png',
      mimeType: 'image/png',
      alt: '炼化利润图',
    };
    const first = await saveStudioAttachment(fixture.config, input);
    const second = await saveStudioAttachment(fixture.config, input);
    assert.deepEqual(second, first);

    await writeFile(path.join(fixture.vaultRoot, first.relativePath), Buffer.from('different'));
    await assert.rejects(saveStudioAttachment(fixture.config, input));
    assert.deepEqual(await readFile(path.join(fixture.vaultRoot, first.relativePath)), Buffer.from('different'));
  } finally {
    await removeFixture(fixture.root);
  }
});

test('saveStudioAttachment rejects aliases that would make its Obsidian embed ambiguous or injectable', async () => {
  const fixture = await createFixture();

  try {
    for (const alt of ['chart]]', 'chart|caption', 'chart\n# injected', 'chart\rnext', 'chart\x01']) {
      await assert.rejects(
        saveStudioAttachment(fixture.config, {
          bytes: PNG,
          filename: 'chart.png',
          mimeType: 'image/png',
          alt,
        }),
        (error) => error.code === 'invalid_alt',
      );
    }
    assert.deepEqual(await readdir(fixture.config.studioAttachmentRoot), []);
  } finally {
    await removeFixture(fixture.root);
  }
});

test('saveStudioAttachment lowercases before filtering Unicode filename characters', async () => {
  const fixture = await createFixture();

  try {
    const saved = await saveStudioAttachment(fixture.config, {
      bytes: PNG,
      filename: 'İ.png',
      mimeType: 'image/png',
      alt: '图',
    });
    assert.match(saved.relativePath, /^Attachments\/Studio\/i-[a-f0-9]{8}\.png$/u);
  } finally {
    await removeFixture(fixture.root);
  }
});

test('saveStudioAttachment preserves caller bytes and converges concurrent identical saves on one file', async () => {
  const fixture = await createFixture();
  const bytes = Buffer.from(PNG);
  const originalBytes = Buffer.from(bytes);
  const input = {
    bytes,
    filename: '炼化 利润.png',
    mimeType: 'image/png',
    alt: '炼化利润图',
  };

  try {
    const saved = await Promise.all(Array.from({ length: 8 }, () => saveStudioAttachment(fixture.config, input)));
    assert.deepEqual(bytes, originalBytes);
    assert.equal(new Set(saved.map(({ relativePath }) => relativePath)).size, 1);
    assert.match(saved[0].relativePath, /^Attachments\/Studio\/炼化-利润-[a-f0-9]{8}\.png$/u);
    assert.deepEqual(await readdir(fixture.config.studioAttachmentRoot), [path.basename(saved[0].relativePath)]);
  } finally {
    await removeFixture(fixture.root);
  }
});
