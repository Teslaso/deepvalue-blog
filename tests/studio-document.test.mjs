import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  createStudioDocument,
  readStudioDocument,
  saveStudioDocument,
} from '../publisher/lib/studio-document.mjs';

const execFileAsync = promisify(execFile);

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-document-'));
  const research = path.join(root, 'Research');
  await mkdir(research);
  return {
    root,
    research,
    config: {
      studioWorkspaces: [
        { id: 'research', label: '产业研究', path: await realpath(research) },
      ],
    },
  };
}

async function cleanup(root) {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}

function digest(source) {
  return createHash('sha256').update(Buffer.from(source, 'utf8')).digest('hex');
}

test('readStudioDocument returns exact source bytes and the complete document contract', async () => {
  const current = await fixture();
  const source = '---\r\npublish: false\r\ntitle: 铜周期\r\n---\r\n正文  \r\n';

  try {
    await writeFile(path.join(current.research, 'Copper.md'), source, 'utf8');
    const document = await readStudioDocument(current.config, {
      workspaceId: 'research',
      relativePath: 'Copper.md',
    });

    assert.equal(document.workspaceId, 'research');
    assert.equal(document.relativePath, 'Copper.md');
    assert.equal(document.source, source);
    assert.equal(document.body, '正文  \r\n');
    assert.equal(document.metadata.title, '铜周期');
    assert.equal(document.fingerprint, digest(source));
    assert.equal(typeof document.modifiedAt, 'string');
    assert.equal(document.status, 'draft');
    assert.deepEqual(document.diagnostics, []);
  } finally {
    await cleanup(current.root);
  }
});

test('saveStudioDocument rejects an external change without overwriting it', async () => {
  const current = await fixture();
  const original = '---\npublish: false\n---\noriginal\n';
  const externalVersion = '---\npublish: false\n---\nexternal\n';
  const browserVersion = '---\npublish: false\n---\nbrowser\n';
  const sourcePath = path.join(current.research, 'Copper.md');
  const id = { workspaceId: 'research', relativePath: 'Copper.md' };

  try {
    await writeFile(sourcePath, original);
    const opened = await readStudioDocument(current.config, id);
    await writeFile(sourcePath, externalVersion);

    await assert.rejects(
      saveStudioDocument(current.config, {
        ...id,
        source: browserVersion,
        expectedFingerprint: opened.fingerprint,
      }),
      (error) => error.code === 'external_change',
    );
    assert.equal(await readFile(sourcePath, 'utf8'), externalVersion);
  } finally {
    await cleanup(current.root);
  }
});

test('saveStudioDocument rechecks for an external change after writing its temporary file', async () => {
  const current = await fixture();
  const original = '---\npublish: false\n---\noriginal\n';
  const externalVersion = '---\npublish: false\n---\nlate external change\n';
  const browserVersion = '---\npublish: false\n---\nbrowser\n';
  const sourcePath = path.join(current.research, 'Copper.md');

  try {
    await writeFile(sourcePath, original);
    const moduleUrl = pathToFileURL(
      path.resolve('publisher/lib/studio-document.mjs'),
    ).href;
    const physicalSourcePath = await realpath(sourcePath);
    const childScript = `
      import { constants } from 'node:fs';
      import { mock } from 'node:test';
      import path from 'node:path';
      import * as fileSystem from 'node:fs/promises';
      let sourceOpens = 0;
      const sourcePath = ${JSON.stringify(physicalSourcePath)};
      mock.module('node:fs/promises', {
        namedExports: {
          ...fileSystem,
          open: async (...args) => {
            const candidate = path.resolve(String(args[0]));
            const writeFlags = constants.O_WRONLY | constants.O_RDWR;
            if (candidate === sourcePath && (args[1] & writeFlags) === 0) {
              sourceOpens += 1;
              if (sourceOpens === 2) {
                await fileSystem.writeFile(sourcePath, ${JSON.stringify(externalVersion)});
              }
            }
            return fileSystem.open(...args);
          },
        },
      });
      const store = await import(${JSON.stringify(moduleUrl)});
      try {
        await store.saveStudioDocument(${JSON.stringify(current.config)}, {
          workspaceId: 'research',
          relativePath: 'Copper.md',
          source: ${JSON.stringify(browserVersion)},
          expectedFingerprint: ${JSON.stringify(digest(original))},
        });
        process.exitCode = 2;
      } catch (error) {
        if (error.code !== 'external_change') throw error;
        process.stdout.write('external_change\\n');
      }
    `;
    const child = await execFileAsync(process.execPath, [
      '--experimental-test-module-mocks',
      '--input-type=module',
      '--eval',
      childScript,
    ]);

    assert.equal(child.stdout, 'external_change\n');
    assert.equal(await readFile(sourcePath, 'utf8'), externalVersion);
    assert.deepEqual(await readdir(current.research), ['Copper.md']);
  } finally {
    await cleanup(current.root);
  }
});

test('a failed temporary-file rename leaves the original byte-identical and cleans the temporary sibling', async () => {
  const current = await fixture();
  const original = '---\npublish: false\n---\noriginal bytes  \n';
  const replacement = '---\npublish: false\n---\nreplacement\n';
  const sourcePath = path.join(current.research, 'Copper.md');

  try {
    await writeFile(sourcePath, original);
    const moduleUrl = pathToFileURL(
      path.resolve('publisher/lib/studio-document.mjs'),
    ).href;
    const childScript = `
      import { mock } from 'node:test';
      import * as fileSystem from 'node:fs/promises';
      mock.module('node:fs/promises', {
        namedExports: {
          ...fileSystem,
          rename: async () => {
            const error = new Error('injected rename failure');
            error.code = 'EIO';
            throw error;
          },
        },
      });
      const store = await import(${JSON.stringify(moduleUrl)});
      const config = ${JSON.stringify(current.config)};
      const id = { workspaceId: 'research', relativePath: 'Copper.md' };
      const opened = await store.readStudioDocument(config, id);
      try {
        await store.saveStudioDocument(config, {
          ...id,
          source: ${JSON.stringify(replacement)},
          expectedFingerprint: opened.fingerprint,
        });
        process.exitCode = 2;
      } catch (error) {
        if (error.code !== 'EIO') throw error;
        process.stdout.write('rename_failed\\n');
      }
    `;
    const child = await execFileAsync(process.execPath, [
      '--experimental-test-module-mocks',
      '--input-type=module',
      '--eval',
      childScript,
    ]);

    assert.equal(child.stdout, 'rename_failed\n');
    assert.equal(await readFile(sourcePath, 'utf8'), original);
    assert.deepEqual(await readdir(current.research), ['Copper.md']);
  } finally {
    await cleanup(current.root);
  }
});

test('saveStudioDocument atomically writes mode 0600 and retains a locked publish_id', async () => {
  const current = await fixture();
  const source = '---\npublish: true\npublish_id: copper-cycle\ntitle: Old\n---\nold\n';
  const sourcePath = path.join(current.research, 'Copper.md');
  const id = { workspaceId: 'research', relativePath: 'Copper.md' };

  try {
    await writeFile(sourcePath, source);
    await chmod(sourcePath, 0o644);
    const opened = await readStudioDocument(current.config, id);
    const saved = await saveStudioDocument(current.config, {
      ...id,
      patch: { title: 'New' },
      body: 'new\n',
      expectedFingerprint: opened.fingerprint,
    });

    assert.equal(saved.metadata.publish_id, 'copper-cycle');
    assert.equal(saved.metadata.title, 'New');
    assert.equal(saved.body, 'new\n');
    assert.equal((await lstat(sourcePath)).mode & 0o777, 0o600);

    await assert.rejects(
      saveStudioDocument(current.config, {
        ...id,
        source: saved.source.replace('copper-cycle', 'replacement-id'),
        expectedFingerprint: saved.fingerprint,
      }),
      (error) => error.code === 'publish_id_locked',
    );
    assert.equal((await readFile(sourcePath, 'utf8')).includes('copper-cycle'), true);
  } finally {
    await cleanup(current.root);
  }
});

test('malformed current frontmatter cannot disable the textual publish_id lock', async () => {
  const current = await fixture();
  const original = `---
publish_id: stable-id
tags: [unterminated
original
`;
  const replacement = original.replace('stable-id', 'replacement-id');
  const sourcePath = path.join(current.research, 'Broken.md');
  const id = { workspaceId: 'research', relativePath: 'Broken.md' };

  try {
    await writeFile(sourcePath, original);
    const opened = await readStudioDocument(current.config, id);

    await assert.rejects(
      saveStudioDocument(current.config, {
        ...id,
        source: replacement,
        expectedFingerprint: opened.fingerprint,
      }),
      (error) => error.code === 'publish_id_locked',
    );
    assert.equal(await readFile(sourcePath, 'utf8'), original);
  } finally {
    await cleanup(current.root);
  }
});

test('createStudioDocument derives a safe filename and adds a numeric collision suffix', async () => {
  const current = await fixture();

  try {
    await writeFile(path.join(current.research, 'Copper Thesis.md'), 'existing');
    const created = await createStudioDocument(current.config, {
      workspaceId: 'research',
      title: '../Copper: Thesis',
      metadata: { publish: false, topic: 'Copper' },
      body: 'new draft\n',
    });

    assert.equal(created.relativePath, 'Copper Thesis 2.md');
    assert.equal(created.metadata.title, '../Copper: Thesis');
    assert.equal(created.body, 'new draft\n');
    assert.equal((await lstat(path.join(current.research, created.relativePath))).mode & 0o777, 0o600);
  } finally {
    await cleanup(current.root);
  }
});

test('createStudioDocument reserves filename headroom for its randomized temporary sibling', async () => {
  const current = await fixture();
  const longTitle = '铜'.repeat(100);

  try {
    const created = await createStudioDocument(current.config, {
      workspaceId: 'research',
      title: longTitle,
      metadata: { publish: false },
      body: 'long filename draft\n',
    });

    assert.equal(created.metadata.title, longTitle);
    assert.equal(Buffer.byteLength(created.relativePath, 'utf8') <= 160, true);
    assert.equal(await readFile(path.join(current.research, created.relativePath), 'utf8'), created.source);
  } finally {
    await cleanup(current.root);
  }
});

test('createStudioDocument cleanup leaves a replaced temporary leaf untouched', async () => {
  const current = await fixture();
  const replacement = 'unrelated replacement leaf';

  try {
    const moduleUrl = pathToFileURL(
      path.resolve('publisher/lib/studio-document.mjs'),
    ).href;
    const targetPath = path.join(await realpath(current.research), 'Leaf.md');
    const childScript = `
      import { mock } from 'node:test';
      import * as fileSystem from 'node:fs/promises';
      let temporaryPath;
      let replaced = false;
      const targetPath = ${JSON.stringify(targetPath)};
      mock.module('node:fs/promises', {
        namedExports: {
          ...fileSystem,
          lstat: async (candidate, ...args) => {
            const value = String(candidate);
            if (value.includes('.studio-tmp-')) temporaryPath = value;
            if (!replaced && value === targetPath && temporaryPath) {
              replaced = true;
              await fileSystem.rm(temporaryPath, { force: true });
              await fileSystem.writeFile(temporaryPath, ${JSON.stringify(replacement)});
            }
            return fileSystem.lstat(candidate, ...args);
          },
        },
      });
      const store = await import(${JSON.stringify(moduleUrl)});
      const created = await store.createStudioDocument(${JSON.stringify(current.config)}, {
        workspaceId: 'research',
        title: 'Leaf',
        metadata: { publish: false },
        body: 'draft\\n',
      });
      process.stdout.write(created.relativePath + '\\n');
    `;
    const child = await execFileAsync(process.execPath, [
      '--experimental-test-module-mocks',
      '--input-type=module',
      '--eval',
      childScript,
    ]);

    assert.equal(child.stdout, 'Leaf.md\n');
    const temporaryNames = (await readdir(current.research))
      .filter((name) => name.includes('.studio-tmp-'));
    assert.equal(temporaryNames.length, 1);
    assert.equal(
      await readFile(path.join(current.research, temporaryNames[0]), 'utf8'),
      replacement,
    );
  } finally {
    await cleanup(current.root);
  }
});

test('readStudioDocument rejects a hard-link alias into the configured workspace', async () => {
  const current = await fixture();
  const outsideSource = path.join(current.root, 'Private.md');

  try {
    await writeFile(outsideSource, 'outside private body');
    await link(outsideSource, path.join(current.research, 'Alias.md'));

    await assert.rejects(
      readStudioDocument(current.config, {
        workspaceId: 'research',
        relativePath: 'Alias.md',
      }),
      (error) => error.code === 'unsafe_path',
    );
  } finally {
    await cleanup(current.root);
  }
});

test('saveStudioDocument closes the workspace handle when parent guard acquisition fails', async () => {
  const current = await fixture();

  try {
    await mkdir(path.join(current.research, 'Nested'));
    await writeFile(path.join(current.research, 'Nested', 'Copper.md'), 'original');
    const moduleUrl = pathToFileURL(
      path.resolve('publisher/lib/studio-document.mjs'),
    ).href;
    const blockedParent = await realpath(path.join(current.research, 'Nested'));
    const childScript = `
      import { constants } from 'node:fs';
      import { mock } from 'node:test';
      import path from 'node:path';
      import * as fileSystem from 'node:fs/promises';
      const tracked = [];
      const blockedParent = ${JSON.stringify(blockedParent)};
      mock.module('node:fs/promises', {
        namedExports: {
          ...fileSystem,
          open: async (...args) => {
            if (
              path.resolve(String(args[0])) === blockedParent
              && (args[1] & (constants.O_DIRECTORY ?? 0)) !== 0
            ) {
              const error = new Error('injected parent open failure');
              error.code = 'EACCES';
              throw error;
            }
            const handle = await fileSystem.open(...args);
            tracked.push(handle);
            return handle;
          },
        },
      });
      const store = await import(${JSON.stringify(moduleUrl)});
      try {
        await store.saveStudioDocument(${JSON.stringify(current.config)}, {
          workspaceId: 'research',
          relativePath: 'Nested/Copper.md',
          source: 'replacement',
          expectedFingerprint: '${'0'.repeat(64)}',
        });
        process.exitCode = 2;
      } catch {
        const closed = await Promise.all(tracked.map(async (handle) => {
          try {
            await handle.stat();
            return false;
          } catch (error) {
            return error.code === 'EBADF';
          }
        }));
        process.stdout.write(closed.every(Boolean) ? 'all_closed\\n' : 'handle_leaked\\n');
      }
    `;
    const child = await execFileAsync(process.execPath, [
      '--experimental-test-module-mocks',
      '--input-type=module',
      '--eval',
      childScript,
    ]);

    assert.equal(child.stdout, 'all_closed\n');
  } finally {
    await cleanup(current.root);
  }
});

test('document operations reject symlinked documents and a workspace replaced during use', async () => {
  const current = await fixture();
  const outside = path.join(current.root, 'Outside');
  const displaced = path.join(current.root, 'Research-original');
  const outsideSource = path.join(outside, 'Private.md');

  try {
    await mkdir(outside);
    await writeFile(outsideSource, 'private');
    await symlink(outsideSource, path.join(current.research, 'Linked.md'));
    await assert.rejects(
      readStudioDocument(current.config, {
        workspaceId: 'research',
        relativePath: 'Linked.md',
      }),
      (error) => error.code === 'unsafe_path',
    );

    await rename(current.research, displaced);
    await symlink(outside, current.research);
    await assert.rejects(
      readStudioDocument(current.config, {
        workspaceId: 'research',
        relativePath: 'Private.md',
      }),
      (error) => error.code === 'unsafe_path',
    );
    assert.equal(await readFile(outsideSource, 'utf8'), 'private');
  } finally {
    await cleanup(current.root);
  }
});
