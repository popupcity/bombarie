import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { RevisionConflict, fileContentStore, revisionOf } from './content-store.ts';

function repo(): { root: string; folder: string } {
  const root = mkdtempSync(join(tmpdir(), 'store-'));
  const folder = join(root, 'posts', '2026-11-20-expo');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'a.md'), '---\ndate: 2026-11-20T10:30\n---\nOld text\n');
  return { root, folder };
}

test('read returns the text and a revision that follows the content', async () => {
  const { root } = repo();
  const store = fileContentStore(root);
  const read = await store.read('posts/2026-11-20-expo/a.md');
  assert.equal(read?.revision, revisionOf('---\ndate: 2026-11-20T10:30\n---\nOld text\n'));
  assert.equal(await store.read('posts/2026-11-20-expo/missing.md'), null);
});

test('write replaces the file when the revision matches and leaves no temp file', async () => {
  const { root, folder } = repo();
  const store = fileContentStore(root);
  const before = (await store.read('posts/2026-11-20-expo/a.md'))!;
  const { revision } = await store.write('posts/2026-11-20-expo/a.md', 'new', before.revision);
  assert.equal(readFileSync(join(folder, 'a.md'), 'utf8'), 'new');
  assert.equal(revision, revisionOf('new'));
  assert.deepEqual(readdirSync(folder), ['a.md']);
});

test('write refuses when the file changed since it was read', async () => {
  const { root, folder } = repo();
  const store = fileContentStore(root);
  const before = (await store.read('posts/2026-11-20-expo/a.md'))!;
  writeFileSync(join(folder, 'a.md'), 'edited in Obsidian');
  await assert.rejects(store.write('posts/2026-11-20-expo/a.md', 'mine', before.revision), RevisionConflict);
  assert.equal(readFileSync(join(folder, 'a.md'), 'utf8'), 'edited in Obsidian');
});

test('only post files can be addressed', async () => {
  const store = fileContentStore(repo().root);
  for (const path of ['channels.yml', 'posts/../channels.yml', 'posts/x/../../a.md', '../x.md', 'posts/x/y/z.md']) {
    await assert.rejects(store.read(path), /not a content path/);
  }
});
