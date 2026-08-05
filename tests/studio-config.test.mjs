import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ConfigValidationError,
  validatePublishConfig,
} from '../publisher/lib/config.mjs';
import {
  isPathInside,
  resolveExistingContainedPath,
  resolveMissingContainedPath,
} from '../publisher/lib/studio-paths.mjs';

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-config-'));
  const repoRoot = path.join(root, 'repo');
  const vaultRoot = path.join(root, 'vault');
  await mkdir(path.join(repoRoot, 'src/content/entries'), { recursive: true });
  await mkdir(path.join(repoRoot, 'public/media'), { recursive: true });
  await mkdir(path.join(vaultRoot, 'Attachments'), { recursive: true });
  await mkdir(path.join(vaultRoot, 'Publishing/Research'), { recursive: true });
  return { root, repoRoot, vaultRoot };
}

async function removeFixture(root) {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}

function validConfig(vaultRoot) {
  return {
    vaultRoot,
    entryOutputDir: 'src/content/entries',
    mediaOutputDir: 'public/media',
    attachmentRoots: ['Attachments'],
    ignoreFolders: ['.obsidian', '.trash'],
    includeInlineHashtags: true,
  };
}

test('validatePublishConfig resolves physical studio workspaces and an absent attachment destination', async () => {
  const fixture = await createFixture();

  try {
    const config = await validatePublishConfig({
      ...validConfig(fixture.vaultRoot),
      studioWorkspaces: [
        { id: 'research', label: '产业研究', path: 'Publishing/Research' },
      ],
      studioAttachmentRoot: 'Attachments/Studio',
    }, { repoRoot: fixture.repoRoot });

    assert.deepEqual(config.studioWorkspaces, [{
      id: 'research',
      label: '产业研究',
      path: await realpath(path.join(fixture.vaultRoot, 'Publishing/Research')),
      recursive: true,
    }]);
    assert.equal(
      config.studioAttachmentRoot,
      path.join(await realpath(path.join(fixture.vaultRoot, 'Attachments')), 'Studio'),
    );
  } finally {
    await removeFixture(fixture.root);
  }
});

test('validatePublishConfig allows a non-recursive workspace at the Vault root', async () => {
  const fixture = await createFixture();

  try {
    const config = await validatePublishConfig({
      ...validConfig(fixture.vaultRoot),
      studioWorkspaces: [
        { id: 'root', label: '根目录', path: '.', recursive: false },
      ],
      studioAttachmentRoot: 'Attachments/Studio',
    }, { repoRoot: fixture.repoRoot });

    assert.deepEqual(config.studioWorkspaces, [{
      id: 'root',
      label: '根目录',
      path: await realpath(fixture.vaultRoot),
      recursive: false,
    }]);

    await assert.rejects(
      validatePublishConfig({
        ...validConfig(fixture.vaultRoot),
        studioWorkspaces: [
          { id: 'bad', label: '错误类型', path: 'Publishing/Research', recursive: 'yes' },
        ],
        studioAttachmentRoot: 'Attachments/Studio',
      }, { repoRoot: fixture.repoRoot }),
      (error) => error.diagnostics.some(({ code }) => code === 'invalid_type'),
    );
  } finally {
    await removeFixture(fixture.root);
  }
});

test('validatePublishConfig preserves old Publisher configuration compatibility', async () => {
  const fixture = await createFixture();

  try {
    const config = await validatePublishConfig(validConfig(fixture.vaultRoot), {
      repoRoot: fixture.repoRoot,
    });

    assert.deepEqual(config.studioWorkspaces, []);
    assert.equal(config.studioAttachmentRoot, undefined);
  } finally {
    await removeFixture(fixture.root);
  }
});

test('validatePublishConfig rejects duplicate studio workspace IDs and invalid workspace metadata', async () => {
  const fixture = await createFixture();

  try {
    await assert.rejects(
      validatePublishConfig({
        ...validConfig(fixture.vaultRoot),
        studioWorkspaces: [
          { id: 'Research', label: '', path: 'Publishing/Research' },
          { id: 'Research', label: '重复', path: 'Publishing/Research' },
        ],
        studioAttachmentRoot: 'Attachments/Studio',
      }, { repoRoot: fixture.repoRoot }),
      (error) => {
        assert.equal(error instanceof ConfigValidationError, true);
        assert.deepEqual(
          error.diagnostics.map(({ field, code }) => ({ field, code })),
          [
            { field: 'studioWorkspaces[0].id', code: 'invalid_workspace_id' },
            { field: 'studioWorkspaces[0].label', code: 'invalid_workspace_label' },
            { field: 'studioWorkspaces[1].id', code: 'invalid_workspace_id' },
            { field: 'studioWorkspaces[1].id', code: 'duplicate_workspace_id' },
          ],
        );
        return true;
      },
    );
  } finally {
    await removeFixture(fixture.root);
  }
});

test('validatePublishConfig rejects studio traversal, absolute paths, and symlink escapes', async () => {
  const fixture = await createFixture();
  const outside = path.join(fixture.root, 'outside');

  try {
    await mkdir(outside);
    await symlink(outside, path.join(fixture.vaultRoot, 'Escaped'));

    await assert.rejects(
      validatePublishConfig({
        ...validConfig(fixture.vaultRoot),
        studioWorkspaces: [
          { id: 'traversal', label: 'Traversal', path: '../Private' },
          { id: 'absolute', label: 'Absolute', path: path.join(fixture.vaultRoot, 'Publishing/Research') },
          { id: 'symlink', label: 'Symlink', path: 'Escaped' },
        ],
        studioAttachmentRoot: 'Escaped/Studio',
      }, { repoRoot: fixture.repoRoot }),
      (error) => {
        assert.equal(error instanceof ConfigValidationError, true);
        assert.equal(error.diagnostics.filter(({ code }) => code === 'path_escape').length, 3);
        assert.equal(error.diagnostics.filter(({ code }) => code === 'absolute_path').length, 1);
        return true;
      },
    );
  } finally {
    await removeFixture(fixture.root);
  }
});

test('validatePublishConfig rejects a regular file as a studio workspace', async () => {
  const fixture = await createFixture();

  try {
    await writeFile(path.join(fixture.vaultRoot, 'Publishing/Workspace.md'), '# Not a directory\n');

    await assert.rejects(
      validatePublishConfig({
        ...validConfig(fixture.vaultRoot),
        studioWorkspaces: [
          { id: 'research', label: '产业研究', path: 'Publishing/Workspace.md' },
        ],
        studioAttachmentRoot: 'Attachments/Studio',
      }, { repoRoot: fixture.repoRoot }),
      (error) => {
        assert.equal(error instanceof ConfigValidationError, true);
        assert.deepEqual(
          error.diagnostics.map(({ field, code }) => ({ field, code })),
          [{ field: 'studioWorkspaces[0].path', code: 'invalid_directory' }],
        );
        return true;
      },
    );
  } finally {
    await removeFixture(fixture.root);
  }
});

test('validatePublishConfig rejects a regular file as the studio attachment destination', async () => {
  const fixture = await createFixture();

  try {
    await writeFile(path.join(fixture.vaultRoot, 'Attachments/Studio'), 'not a directory\n');

    await assert.rejects(
      validatePublishConfig({
        ...validConfig(fixture.vaultRoot),
        studioWorkspaces: [
          { id: 'research', label: '产业研究', path: 'Publishing/Research' },
        ],
        studioAttachmentRoot: 'Attachments/Studio',
      }, { repoRoot: fixture.repoRoot }),
      (error) => {
        assert.equal(error instanceof ConfigValidationError, true);
        assert.deepEqual(
          error.diagnostics.map(({ field, code }) => ({ field, code })),
          [{ field: 'studioAttachmentRoot', code: 'invalid_directory' }],
        );
        return true;
      },
    );
  } finally {
    await removeFixture(fixture.root);
  }
});

test('studio path helpers keep lexical and physical paths inside their root', async () => {
  const fixture = await createFixture();

  try {
    const physicalVault = await realpath(fixture.vaultRoot);
    assert.equal(isPathInside(physicalVault, path.join(physicalVault, 'Publishing')), true);
    assert.equal(isPathInside(physicalVault, physicalVault, { allowRoot: false }), false);
    assert.equal(isPathInside(physicalVault, path.join(physicalVault, '..', 'Private')), false);
    assert.equal(
      await resolveExistingContainedPath({
        root: physicalVault,
        rawPath: 'Publishing/Research',
        label: 'Workspace',
        allowRoot: false,
      }),
      path.join(physicalVault, 'Publishing/Research'),
    );
    assert.equal(
      await resolveMissingContainedPath({
        root: physicalVault,
        rawPath: 'Attachments/Studio',
        label: 'Attachment destination',
        allowRoot: false,
      }),
      path.join(physicalVault, 'Attachments/Studio'),
    );
  } finally {
    await removeFixture(fixture.root);
  }
});

test('validatePublishConfig resolves an optional absolute staging parent and rejects invalid values', async () => {
  const fixture = await createFixture();

  try {
    const stagingParent = path.join(fixture.root, 'staging');
    await mkdir(stagingParent);

    const withStaging = await validatePublishConfig({
      ...validConfig(fixture.vaultRoot),
      stagingParent,
    }, { repoRoot: fixture.repoRoot });
    assert.equal(withStaging.stagingParent, await realpath(stagingParent));

    await assert.rejects(
      validatePublishConfig({
        ...validConfig(fixture.vaultRoot),
        stagingParent: 'relative/staging',
      }, { repoRoot: fixture.repoRoot }),
      (error) => error.diagnostics.some(({ code }) => code === 'invalid_path'),
    );

    const fileStaging = path.join(fixture.root, 'staging-file');
    await writeFile(fileStaging, 'not a directory');
    await assert.rejects(
      validatePublishConfig({
        ...validConfig(fixture.vaultRoot),
        stagingParent: fileStaging,
      }, { repoRoot: fixture.repoRoot }),
      (error) => error.diagnostics.some(({ code }) => code === 'invalid_directory'),
    );
  } finally {
    await removeFixture(fixture.root);
  }
});
