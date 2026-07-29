import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { watch, writeFileSync } from 'node:fs';
import {
  chmod,
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
  renameStudioDocument,
  saveStudioDocument,
} from '../publisher/lib/studio-document.mjs';

const execFileAsync = promisify(execFile);

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-document-'));
  const research = path.join(root, 'Research');
  const journal = path.join(root, 'Journal');
  await mkdir(research);
  await mkdir(journal);
  return {
    root,
    research,
    journal,
    config: {
      studioWorkspaces: [
        { id: 'research', label: '产业研究', path: await realpath(research) },
        { id: 'journal', label: '研究日志', path: await realpath(journal) },
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
  let watcher;

  try {
    await writeFile(sourcePath, original);
    const opened = await readStudioDocument(current.config, {
      workspaceId: 'research',
      relativePath: 'Copper.md',
    });
    const changed = new Promise((resolve, reject) => {
      let acted = false;
      watcher = watch(current.research, (eventType, filename) => {
        if (acted || !String(filename).includes('.studio-tmp-')) return;
        acted = true;
        try {
          writeFileSync(sourcePath, externalVersion);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });

    await assert.rejects(
      saveStudioDocument(current.config, {
        workspaceId: 'research',
        relativePath: 'Copper.md',
        source: browserVersion,
        expectedFingerprint: opened.fingerprint,
      }),
      (error) => error.code === 'external_change',
    );
    await changed;
    assert.equal(await readFile(sourcePath, 'utf8'), externalVersion);
    assert.deepEqual(await readdir(current.research), ['Copper.md']);
  } finally {
    watcher?.close();
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

test('renameStudioDocument stays in the source workspace and refuses collisions', async () => {
  const current = await fixture();
  const source = '---\npublish: false\ntitle: Copper\n---\nbody\n';

  try {
    await mkdir(path.join(current.research, 'Nested'));
    await writeFile(path.join(current.research, 'Nested', 'Copper.md'), source);
    await writeFile(path.join(current.research, 'Nested', 'Taken.md'), 'taken');
    const opened = await readStudioDocument(current.config, {
      workspaceId: 'research',
      relativePath: 'Nested/Copper.md',
    });

    const renamed = await renameStudioDocument(current.config, {
      workspaceId: 'research',
      relativePath: 'Nested/Copper.md',
      title: 'Copper Cycle',
      expectedFingerprint: opened.fingerprint,
    });
    assert.equal(renamed.relativePath, 'Nested/Copper Cycle.md');
    assert.equal(await readFile(path.join(current.research, 'Nested', 'Copper Cycle.md'), 'utf8'), source);

    await assert.rejects(
      renameStudioDocument(current.config, {
        workspaceId: 'research',
        relativePath: 'Nested/Copper Cycle.md',
        newRelativePath: '../Journal/Moved.md',
        expectedFingerprint: renamed.fingerprint,
      }),
      (error) => error.code === 'unsafe_path',
    );
    await assert.rejects(
      renameStudioDocument(current.config, {
        workspaceId: 'research',
        relativePath: 'Nested/Copper Cycle.md',
        title: 'Taken',
        expectedFingerprint: renamed.fingerprint,
      }),
      (error) => error.code === 'destination_exists',
    );
    assert.equal((await readdir(current.journal)).length, 0);
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
