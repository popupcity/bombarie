import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileContentStore } from './content-store.ts';
import { fileStore } from './state.ts';
import { addVariant, createPost, deletePost, deleteVariant, slugify, syncFolder } from './campaign.ts';

const NOW = new Date('2026-11-18T22:30:00Z');

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'variants-'));
  writeFileSync(join(root, 'channels.yml'), 'jeroen-linkedin:\n  platform: linkedin\n  kind: person\npopupcity-instagram:\n  platform: instagram\npoppo-instagram:\n  platform: instagram\nstack-substack:\n  platform: substack\n');
  mkdirSync(join(root, 'posts'));
  return { root, store: fileContentStore(root) };
}

test('a title becomes a plain slug', () => {
  assert.equal(slugify('Expo: Stad van Morgen!'), 'expo-stad-van-morgen');
  assert.equal(slugify('Café één'), 'cafe-een');
  assert.equal(slugify('???'), '');
});

test('a new post is a draft dated now and its folder carries the Amsterdam date of today', async () => {
  const { root, store } = repo();
  const made = await createPost(root, store, { title: 'Expo opening', channels: ['jeroen-linkedin'] }, NOW);
  assert.deepEqual(made, { folder: '2026-11-18-expo-opening', base: 'jeroen-linkedin' });
  assert.equal(readFileSync(join(root, 'posts', made.folder, 'jeroen-linkedin.md'), 'utf8'), '---\ntitle: Expo opening\ndate: 2026-11-18T23:30\n---\n\n');
});

test('one post can start with several channels, all with the same title and date and no text', async () => {
  const { root, store } = repo();
  const made = await createPost(root, store, { title: 'Expo', channels: ['popupcity-instagram', 'jeroen-linkedin', 'popupcity-instagram'] }, NOW);
  assert.equal(made.base, 'popupcity-instagram');
  assert.deepEqual(readdirSync(join(root, 'posts', made.folder)).sort(), ['jeroen-linkedin.md', 'popupcity-instagram.md']);
  assert.equal(readFileSync(join(root, 'posts', made.folder, 'jeroen-linkedin.md'), 'utf8'), readFileSync(join(root, 'posts', made.folder, 'popupcity-instagram.md'), 'utf8'));
  await assert.rejects(createPost(root, store, { title: 'Y', channels: [] }, NOW), /at least one/);
  await assert.rejects(createPost(root, store, { title: 'Z', channels: ['jeroen-linkedin', 'nope'] }, NOW), /unknown channel/);
  assert.equal(readdirSync(join(root, 'posts')).length, 1);
});

test('the same title on the same day gets a number, an unknown channel or empty title is refused', async () => {
  const { root, store } = repo();
  await createPost(root, store, { title: 'Expo', channels: ['jeroen-linkedin'] }, NOW);
  assert.equal((await createPost(root, store, { title: 'Expo', channels: ['jeroen-linkedin'] }, NOW)).folder, '2026-11-18-expo-2');
  await assert.rejects(createPost(root, store, { title: 'Expo', channels: ['nope'] }, NOW), /unknown channel/);
  await assert.rejects(createPost(root, store, { title: '!!', channels: ['jeroen-linkedin'] }, NOW), /title/);
});

test('a copied variant keeps text, date and images but is always a draft', async () => {
  const { root, store } = repo();
  const { folder } = await createPost(root, store, { title: 'Expo', channels: ['jeroen-linkedin'] }, NOW);
  writeFileSync(join(root, 'posts', folder, 'jeroen-linkedin.md'), '---\nstatus: planned\ndate: 2026-11-20T10:00\nimages: [a.jpg]\n---\nHallo\n');
  assert.equal(await addVariant(root, store, folder, 'jeroen-linkedin', 'popupcity-instagram'), 'popupcity-instagram');
  assert.equal(readFileSync(join(root, 'posts', folder, 'popupcity-instagram.md'), 'utf8'), '---\ndate: 2026-11-20T10:00\nimages: [a.jpg]\n---\nHallo\n');
  assert.match(readFileSync(join(root, 'posts', folder, 'jeroen-linkedin.md'), 'utf8'), /status: planned/);
});

test('a channel gets one variant per post, and the source must exist', async () => {
  const { root, store } = repo();
  const { folder } = await createPost(root, store, { title: 'Expo', channels: ['jeroen-linkedin'] }, NOW);
  await assert.rejects(addVariant(root, store, folder, 'jeroen-linkedin', 'jeroen-linkedin'), /already has/);
  await assert.rejects(addVariant(root, store, folder, 'poppo-instagram', 'popupcity-instagram'), /not found/);
  await assert.rejects(addVariant(root, store, '../x', 'jeroen-linkedin', 'popupcity-instagram'), /not found/);
  await assert.rejects(addVariant(root, store, folder, 'jeroen-linkedin', 'nope'), /unknown channel/);
});

test('a variant can be deleted except the last one, and images stay', async () => {
  const { root, store } = repo();
  const { folder } = await createPost(root, store, { title: 'Expo', channels: ['jeroen-linkedin'] }, NOW);
  writeFileSync(join(root, 'posts', folder, 'a.jpg'), 'x');
  await addVariant(root, store, folder, 'jeroen-linkedin', 'popupcity-instagram');
  assert.equal(await deleteVariant(root, store, fileStore(root), folder, 'jeroen-linkedin'), 'popupcity-instagram');
  assert.equal(existsSync(join(root, 'posts', folder, 'jeroen-linkedin.md')), false);
  await assert.rejects(deleteVariant(root, store, fileStore(root), folder, 'popupcity-instagram'), /at least one/);
  assert.deepEqual(readdirSync(join(root, 'posts', folder)).sort(), ['a.jpg', 'popupcity-instagram.md']);
});

test('the store creates only new post files inside posts', async () => {
  const { store } = repo();
  await assert.rejects(store.create('posts/../x.md', 'x'), /not a content path/);
  await assert.rejects(store.create('channels.md', 'x'), /not a content path/);
  await store.create('posts/a/b.md', 'x');
  await assert.rejects(store.create('posts/a/b.md', 'y'), /already exists/);
});

test('a whole post can be deleted with its images and states, unless a variant is being posted or may be live', async () => {
  const { root, store } = repo();
  const states = fileStore(root);
  const { folder } = await createPost(root, store, { title: 'Expo', channels: ['jeroen-linkedin', 'popupcity-instagram'] }, NOW);
  writeFileSync(join(root, 'posts', folder, 'a.jpg'), 'x');
  await states.create(`${folder}/popupcity-instagram.md`, { status: 'unconfirmed', at: NOW.toISOString(), message: 'x' });
  await assert.rejects(deletePost(root, store, states, folder), /may be live/);
  await assert.rejects(deleteVariant(root, store, states, folder, 'popupcity-instagram'), /may be live/);
  assert.equal(existsSync(join(root, 'posts', folder)), true);
  await states.replace(`${folder}/popupcity-instagram.md`, { status: 'posted', at: NOW.toISOString(), remoteId: '1' });
  await deletePost(root, store, states, folder);
  assert.equal(existsSync(join(root, 'posts', folder)), false);
  assert.equal(await states.get(`${folder}/popupcity-instagram.md`), null);
  await assert.rejects(deletePost(root, store, states, '../x'), /not found/);
  await assert.rejects(store.removeFolder('posts/a/b'), /not a content path/);
});

test('createPost can plan the new post on a chosen day', async () => {
  const { root, store } = repo();
  const { folder, base } = await createPost(root, store, { title: 'Expo', channels: ['jeroen-linkedin'], day: '2026-12-01' }, NOW);
  assert.match(readFileSync(join(root, 'posts', folder, `${base}.md`), 'utf8'), /date: 2026-12-01T09:00/);
  await assert.rejects(createPost(root, store, { title: 'Expo', channels: ['jeroen-linkedin'], day: 'soon' }, NOW), /not a date/);
});

test('createPost can start with text, a link and images that are copied into the post folder', async () => {
  const { root, store } = repo();
  const bytes = new Uint8Array([1, 2, 3]);
  const { folder, base } = await createPost(root, store, { title: 'From an idea', channels: ['jeroen-linkedin'], text: 'Notes from the idea.', link: 'https://example.com', images: [{ name: 'a.png', bytes }] }, NOW);
  const raw = readFileSync(join(root, 'posts', folder, `${base}.md`), 'utf8');
  assert.match(raw, /link: https:\/\/example.com/);
  assert.match(raw, /images: \[a.png\]/);
  assert.match(raw, /Notes from the idea\./);
  assert.deepEqual(readFileSync(join(root, 'posts', folder, 'a.png')), Buffer.from(bytes));
});

test('an Instagram channel can get a story variant next to its post, with one image and no status', async () => {
  const { root, store } = repo();
  const bytes = new Uint8Array([1, 2, 3]);
  const { folder, base } = await createPost(root, store, { title: 'Reel', channels: ['popupcity-instagram'], text: 'Hello', images: [{ name: 'a.png', bytes }, { name: 'b.png', bytes }] }, NOW);
  assert.equal(await addVariant(root, store, folder, base, 'popupcity-instagram-story'), 'popupcity-instagram-story');
  const story = readFileSync(join(root, 'posts', folder, 'popupcity-instagram-story.md'), 'utf8');
  assert.match(story, /images: \[a.png\]/);
  assert.doesNotMatch(story, /status:/);
  await assert.rejects(addVariant(root, store, folder, base, 'popupcity-instagram-story'), /already has a story variant/);
  await assert.rejects(addVariant(root, store, folder, base, 'popupcity-instagram-reel'), /has no reel variant/);
});

test('only channels that have a story can add one', async () => {
  const { root, store } = repo();
  const { folder, base } = await createPost(root, store, { title: 'Post', channels: ['jeroen-linkedin'] }, NOW);
  await assert.rejects(addVariant(root, store, folder, base, 'jeroen-linkedin-story'), /LinkedIn has no story variant/);
});

test('a changed title renames the folder, keeps the date, and moves images and state', async () => {
  const { root, store } = repo();
  const states = fileStore(root);
  const { folder } = await createPost(root, store, { title: 'Expo', channels: ['jeroen-linkedin'], images: [{ name: 'a.png', bytes: new Uint8Array([1]) }] }, NOW);
  await states.create(`${folder}/jeroen-linkedin.md`, { status: 'posted' } as never);
  assert.equal(await syncFolder(root, store, states, folder), folder);
  const file = join(root, 'posts', folder, 'jeroen-linkedin.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace('title: Expo', 'title: Grote opening'));
  const next = await syncFolder(root, store, states, folder);
  assert.equal(next, '2026-11-18-grote-opening');
  assert.ok(existsSync(join(root, 'posts', next, 'a.png')));
  assert.ok(!existsSync(join(root, 'posts', folder)));
  assert.equal((await states.get(`${next}/jeroen-linkedin.md`))?.status, 'posted');
  assert.equal(await states.get(`${folder}/jeroen-linkedin.md`), null);
});

test('a title clash gets a number, and a post that is being posted keeps its folder', async () => {
  const { root, store } = repo();
  const states = fileStore(root);
  await createPost(root, store, { title: 'Expo', channels: ['jeroen-linkedin'] }, NOW);
  const { folder } = await createPost(root, store, { title: 'Other', channels: ['jeroen-linkedin'] }, NOW);
  const file = join(root, 'posts', folder, 'jeroen-linkedin.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace('title: Other', 'title: Expo'));
  await states.create(`${folder}/jeroen-linkedin.md`, { status: 'posting' } as never);
  await assert.rejects(syncFolder(root, store, states, folder), /being posted/);
  await states.remove(`${folder}/jeroen-linkedin.md`);
  assert.equal(await syncFolder(root, store, states, folder), '2026-11-18-expo-2');
  assert.equal(await syncFolder(root, store, states, '2026-11-18-expo-2'), '2026-11-18-expo-2');
});

test('a post without a title starts as an untitled draft, and the folder follows the title once it is typed', async () => {
  const { root, store } = repo();
  const states = fileStore(root);
  const made = await createPost(root, store, { title: '', channels: ['jeroen-linkedin'] }, NOW);
  assert.equal(made.folder, '2026-11-18-untitled');
  const file = join(root, 'posts', made.folder, 'jeroen-linkedin.md');
  assert.equal(readFileSync(file, 'utf8'), '---\ndate: 2026-11-18T23:30\n---\n\n');
  assert.equal((await createPost(root, store, { title: '  ', channels: ['jeroen-linkedin'] }, NOW)).folder, '2026-11-18-untitled-2');
  assert.equal(await syncFolder(root, store, states, made.folder), made.folder);
  writeFileSync(file, readFileSync(file, 'utf8').replace('---\n\n', 'title: Zomerexpo\n---\n\n'));
  assert.equal(await syncFolder(root, store, states, made.folder), '2026-11-18-zomerexpo');
});

test('a variant for another platform does not take a PDF along, LinkedIn does', async () => {
  const { root, store } = repo();
  const made = await createPost(root, store, { title: 'Deck', channels: ['jeroen-linkedin'], images: [{ name: 'deck.pdf', bytes: new Uint8Array([1]) }, { name: 'a.png', bytes: new Uint8Array([2]) }] }, NOW);
  await addVariant(root, store, made.folder, 'jeroen-linkedin', 'popupcity-instagram');
  const file = (name: string) => readFileSync(join(root, 'posts', made.folder, `${name}.md`), 'utf8');
  assert.match(file('popupcity-instagram'), /images: \[a\.png\]/);
  assert.match(file('jeroen-linkedin'), /deck\.pdf/);
});

test('a new post can start as an Instagram story, other platforms have none', async () => {
  const { root, store } = repo();
  const made = await createPost(root, store, { title: 'S', channels: ['popupcity-instagram-story'] }, NOW);
  assert.equal(made.base, 'popupcity-instagram-story');
  await assert.rejects(createPost(root, store, { title: 'T', channels: ['jeroen-linkedin-story'] }, NOW), /no story variant/);
});

test('the folder date follows the post date until the first publication', async () => {
  const { root, store } = repo();
  const states = fileStore(root);
  const { folder } = await createPost(root, store, { title: 'Expo', channels: ['jeroen-linkedin'] }, NOW);
  const file = (name: string) => join(root, 'posts', name, 'jeroen-linkedin.md');
  writeFileSync(file(folder), readFileSync(file(folder), 'utf8').replace('date: 2026-11-18T23:30', 'date: 2026-12-01T09:00'));
  const moved = await syncFolder(root, store, states, folder);
  assert.equal(moved, '2026-12-01-expo');
  await states.create(`${moved}/jeroen-linkedin.md`, { status: 'posted' } as never);
  writeFileSync(file(moved), readFileSync(file(moved), 'utf8').replace('date: 2026-12-01T09:00', 'date: 2026-12-05T09:00'));
  assert.equal(await syncFolder(root, store, states, moved), moved);
});

test('a Substack post is an article, or a note with its type', async () => {
  const { root, store } = repo();
  assert.equal((await createPost(root, store, { title: 'N', channels: ['stack-substack-note'] }, NOW)).base, 'stack-substack-note');
  assert.equal((await createPost(root, store, { title: 'M', channels: ['stack-substack'] }, NOW)).base, 'stack-substack');
  await assert.rejects(createPost(root, store, { title: 'O', channels: ['stack-substack-article'] }, NOW), /no article variant/);
});
