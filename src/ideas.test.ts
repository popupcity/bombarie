import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileContentStore } from './content-store.ts';
import { addIdeaImage, cleanLink, createIdea, deleteIdea, ideaTitle, listIdeas, readIdea, removeIdeaImage, saveIdea, setIdeaStatus, titleFrom } from './ideas.ts';
import { saveImage } from './media.ts';
import sharp from 'sharp';

const NOW = new Date('2026-11-19T10:00:00Z');
const repo = () => {
  const root = mkdtempSync(join(tmpdir(), 'ideas-'));
  return { root, store: fileContentStore(root) };
};

test('an idea starts as new, in a folder that carries its date', async () => {
  const { root, store } = repo();
  const folder = await createIdea(root, store, { title: 'Expo about third places', text: 'Ask the curator.' }, NOW);
  assert.equal(folder, '2026-11-19-expo-about-third-places');
  assert.deepEqual(readIdea(root, folder), { folder, title: 'Expo about third places', text: 'Ask the curator.', status: 'new', images: [] });
  assert.equal(readFileSync(join(root, 'ideas', folder, 'idea.md'), 'utf8'), '---\ntitle: Expo about third places\n---\nAsk the curator.\n');
});

test('a clash on the same day gets a number, and an empty title is refused', async () => {
  const { root, store } = repo();
  await createIdea(root, store, { title: 'Same' }, NOW);
  assert.equal(await createIdea(root, store, { title: 'Same' }, NOW), '2026-11-19-same-2');
  await assert.rejects(createIdea(root, store, { title: '!!' }, NOW), /title/);
});

test('approve, post and drop change only the status, and new removes the key', async () => {
  const { root, store } = repo();
  const folder = await createIdea(root, store, { title: 'Idea', link: 'https://example.com/a?b=1' }, NOW);
  await setIdeaStatus(root, store, folder, 'approved');
  assert.equal(readIdea(root, folder)?.status, 'approved');
  assert.equal(readIdea(root, folder)?.link, 'https://example.com/a?b=1');
  await setIdeaStatus(root, store, folder, 'made', '2026-11-19-idea');
  assert.deepEqual([readIdea(root, folder)?.status, readIdea(root, folder)?.post], ['made', '2026-11-19-idea']);
  await setIdeaStatus(root, store, folder, 'new');
  assert.equal(readIdea(root, folder)?.status, 'new');
  assert.doesNotMatch(readFileSync(join(root, 'ideas', folder, 'idea.md'), 'utf8'), /status|post:/);
});

test('saving edits the title, link and text, and an empty link removes it', async () => {
  const { root, store } = repo();
  const folder = await createIdea(root, store, { title: 'Old', link: 'https://example.com' }, NOW);
  const renamed = await saveIdea(root, store, folder, { title: 'New title', text: 'Some notes', link: '' });
  assert.equal(renamed, '2026-11-19-new-title');
  assert.equal(readIdea(root, folder), null);
  assert.deepEqual(readIdea(root, renamed), { folder: renamed, title: 'New title', text: 'Some notes', status: 'new', images: [] });
  assert.equal(await saveIdea(root, store, renamed, { title: 'New title!', text: 'Some notes', link: '' }), renamed);
  await assert.rejects(saveIdea(root, store, renamed, { title: 'x', text: '', link: 'not a link' }), /web address/);
});

test('ideas are listed newest first, and deleting removes the whole folder', async () => {
  const { root, store } = repo();
  const a = await createIdea(root, store, { title: 'A' }, new Date('2026-11-18T10:00:00Z'));
  const b = await createIdea(root, store, { title: 'B' }, NOW);
  assert.deepEqual(listIdeas(root).map((idea) => idea.folder), [b, a]);
  await deleteIdea(root, store, a);
  assert.deepEqual(listIdeas(root).map((idea) => idea.folder), [b]);
  await assert.rejects(deleteIdea(root, store, 'nope'), /not found/);
});

test('a pasted address becomes the link and the domain becomes the title; links must be http', () => {
  assert.deepEqual(titleFrom('https://www.example.com/story?x=1'), { title: 'example.com', link: 'https://www.example.com/story?x=1' });
  assert.deepEqual(titleFrom('Look at https://example.com'), { title: 'Look at https://example.com' });
  assert.deepEqual(titleFrom('  Just words '), { title: 'Just words' });
  assert.deepEqual(titleFrom('A thought\n\nwith more\non two lines '), { title: 'A thought', text: 'with more\non two lines' });
  assert.deepEqual(titleFrom('https://example.com\nworth a look'), { title: 'example.com', link: 'https://example.com/', text: 'worth a look' });
  assert.equal(cleanLink(''), undefined);
  assert.throws(() => cleanLink('javascript:alert(1)'), /web address/);
  assert.throws(() => cleanLink('example.com'), /web address/);
});

test('images are saved in the idea folder, listed once, and removed with their file', async () => {
  const { root, store } = repo();
  const folder = await createIdea(root, store, { title: 'With pictures' }, NOW);
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#f00' } }).png().toBuffer();
  const name = await saveImage(store, folder, 'shot.png', new Uint8Array(png), 'ideas');
  await addIdeaImage(root, store, folder, name);
  await addIdeaImage(root, store, folder, name);
  assert.deepEqual(readIdea(root, folder)?.images, ['shot.png']);
  assert.ok(await store.readFile(`ideas/${folder}/shot.png`));
  await removeIdeaImage(root, store, folder, 'shot.png');
  assert.deepEqual(readIdea(root, folder)?.images, []);
  assert.equal(await store.readFile(`ideas/${folder}/shot.png`), null);
  await assert.rejects(removeIdeaImage(root, store, folder, 'shot.png'), /not found/);
});

test('an idea can be only an image: no title is stored and the folder name comes from the file', async () => {
  const { root, store } = repo();
  const folder = await createIdea(root, store, { name: 'Instagram 4x5 (22).png' }, NOW);
  assert.equal(folder, '2026-11-19-instagram-4x5-22');
  assert.equal(readIdea(root, folder)?.title, '');
  assert.doesNotMatch(readFileSync(join(root, 'ideas', folder, 'idea.md'), 'utf8'), /title:/);
  await assert.rejects(createIdea(root, store, {}, NOW), /title.*or add an image/);
  await assert.rejects(saveIdea(root, store, folder, { title: '', text: '', link: '' }), /or add an image/);
  await saveIdea(root, store, folder, { title: '', text: 'Just a note', link: '' });
  assert.equal(ideaTitle(readIdea(root, folder)!), 'Just a note');
});

test('saving quietly keeps the folder name, saving normally renames it', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileContentStore } = await import('./content-store.ts');
  const { saveIdea } = await import('./ideas.ts');
  const root = mkdtempSync(join(tmpdir(), 'ideas-quiet-'));
  mkdirSync(join(root, 'ideas', '2026-11-25-old'), { recursive: true });
  writeFileSync(join(root, 'ideas', '2026-11-25-old', 'idea.md'), '---\ntitle: Old\n---\nText\n');
  const store = fileContentStore(root);
  assert.equal(await saveIdea(root, store, '2026-11-25-old', { title: 'Brand new', text: 'Text', link: '' }, true), '2026-11-25-old');
  assert.equal(await saveIdea(root, store, '2026-11-25-old', { title: 'Brand new', text: 'Text', link: '' }), '2026-11-25-brand-new');
});
