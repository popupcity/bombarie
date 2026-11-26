import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileContentStore } from './content-store.ts';
import { MAX_IMAGE_BYTES, cleanName, renameImage, saveImage, sniff, tidyName } from './media.ts';

const png = (extra = 0) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, extra]);
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const folder = '2026-11-20-expo';

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'media-'));
  const dir = join(root, 'posts', folder);
  mkdirSync(dir, { recursive: true });
  return { store: fileContentStore(root), dir };
}

test('the content decides, not the extension', () => {
  assert.equal(sniff(png()), 'png');
  assert.equal(sniff(jpg), 'jpg');
  assert.equal(sniff(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), 'gif');
  assert.equal(sniff(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), 'webp');
  assert.equal(sniff(new TextEncoder().encode('<svg onload=alert(1)>')), null);
});

test('names lose paths and odd characters', () => {
  assert.equal(cleanName('../../etc/cover.jpg'), 'cover.jpg');
  assert.equal(cleanName('.hidden.jpg'), 'hidden.jpg');
  assert.equal(cleanName('foto é.png'), 'foto -.png');
});

test('an image is written next to the posts and the final name is returned', async () => {
  const { store, dir } = repo();
  assert.equal(await saveImage(store, folder, 'cover.png', png()), 'cover.png');
  assert.deepEqual(readdirSync(dir), ['cover.png']);
});

test('the same file again reuses the name, a different file with that name gets a new one', async () => {
  const { store, dir } = repo();
  await saveImage(store, folder, 'cover.png', png(1));
  assert.equal(await saveImage(store, folder, 'cover.png', png(1)), 'cover.png');
  assert.equal(await saveImage(store, folder, 'cover.png', png(2)), 'cover-2.png');
  assert.equal(await saveImage(store, folder, 'cover.png', png(3)), 'cover-3.png');
  assert.deepEqual(readdirSync(dir).sort(), ['cover-2.png', 'cover-3.png', 'cover.png']);
});

test('non-images, empty, oversized and oddly named files are refused and nothing is written', async () => {
  const { store, dir } = repo();
  await assert.rejects(saveImage(store, folder, 'x.png', new TextEncoder().encode('hello')), /only JPEG/);
  await assert.rejects(saveImage(store, folder, 'x.png', new Uint8Array()), /empty/);
  await assert.rejects(saveImage(store, folder, 'x.png', new Uint8Array(MAX_IMAGE_BYTES + 1).fill(0xff)), /10 MB/);
  await assert.rejects(saveImage(store, folder, 'notes.txt', png()), /not usable/);
  assert.deepEqual(readdirSync(dir), []);
});

test('the extension follows the content', async () => {
  const { store } = repo();
  assert.equal(await saveImage(store, folder, 'foto.png', jpg), 'foto.jpg');
});

test('the store only writes images inside a post folder', async () => {
  const { store } = repo();
  for (const path of ['posts/x/../../a.png', 'posts/a.png', 'channels.png', 'posts/x/y.md']) {
    await assert.rejects(store.writeFile(path, png()), /not a content path/);
  }
  await assert.rejects(store.list('posts'), /not a content path/);
});

test('a PDF is accepted for a post, with its own size limit, and refused for an idea', async () => {
  const { fileContentStore } = await import('./content-store.ts');
  const { mkdtempSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'media-'));
  mkdirSync(join(root, 'posts', 'f'), { recursive: true });
  mkdirSync(join(root, 'ideas', 'f'), { recursive: true });
  const store = fileContentStore(root);
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
  assert.equal(await saveImage(store, 'f', 'Deck 2026.pdf', pdf), 'deck-2026.pdf');
  await assert.rejects(saveImage(store, 'f', 'idea.pdf', pdf, 'ideas'), /not to an idea/);
  await assert.rejects(saveImage(store, 'f', 'fake.pdf', new Uint8Array([1, 2, 3, 4, 5])), /only JPEG/);
});

test('renaming a file keeps its extension and updates every variant that lists it', async () => {
  const { store, dir } = repo();
  await saveImage(store, folder, 'IMG_1.png', png(1));
  await saveImage(store, folder, 'other.png', png(2));
  writeFileSync(join(dir, 'a.md'), '---\nmedia: [img-1.png, other.png]\n---\n');
  writeFileSync(join(dir, 'b.md'), '---\nmedia: [other.png]\n---\n');
  assert.equal(await renameImage(store, folder, 'img-1.png', 'Expo opening'), 'Expo opening.png');
  assert.equal(await renameImage(store, folder, 'Expo opening.png', 'hero'), 'hero.png');
  assert.match(readFileSync(join(dir, 'a.md'), 'utf8'), /media: \[hero.png, other.png\]/);
  assert.match(readFileSync(join(dir, 'b.md'), 'utf8'), /media: \[other.png\]/);
  assert.deepEqual(readdirSync(dir).sort(), ['a.md', 'b.md', 'hero.png', 'other.png']);
  await assert.rejects(renameImage(store, folder, 'hero.png', 'other'), /already exists/);
  await assert.rejects(renameImage(store, folder, 'hero.png', '..'), /not usable/);
  await assert.rejects(renameImage(store, folder, 'nope.png', 'x'), /not found/);
});

test('an uploaded name becomes lower case with hyphens, and a PDF cover keeps its suffix', () => {
  assert.equal(tidyName('IMG_4471 (2).PNG'), 'img-4471-2.png');
  assert.equal(tidyName('Instagram 4×5 (26).png'), 'instagram-4-5-26.png');
  assert.equal(tidyName('Café één.JPG'), 'cafe-een.jpg');
  assert.equal(tidyName('../../Etc/Pass wd.webp'), 'pass-wd.webp');
  assert.equal(tidyName('???.png'), 'image.png');
  assert.equal(tidyName('Deck 2026.pdf.cover.jpg'), 'deck-2026.pdf.cover.jpg');
});

test('an MP4 is accepted for a post with its own limit, a QuickTime file is told to convert, and an idea takes no video', async () => {
  const { store, dir } = repo();
  mkdirSync(join(dir, '..', '..', 'ideas', folder), { recursive: true });
  const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
  const mov = new Uint8Array([0, 0, 0, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20, 0, 0, 0, 0]);
  assert.equal(sniff(mp4), 'mp4');
  assert.equal(sniff(mov), null);
  assert.equal(await saveImage(store, folder, 'My Clip.MP4', mp4), 'my-clip.mp4');
  await assert.rejects(saveImage(store, folder, 'x.mov', mov), /convert/i);
  await assert.rejects(saveImage(store, folder, 'x.mp4', mp4, 'ideas'), /not to an idea/);
  assert.equal(tidyName('My Clip.mp4.cover.jpg'), 'my-clip.mp4.cover.jpg');
});

test('a byte range is cut to the file, a suffix counts from the end, a bad one is unsatisfiable', async () => {
  const { byteRange } = await import('./media.ts');
  assert.deepEqual(byteRange('bytes=0-9', 100), { first: 0, last: 9 });
  assert.deepEqual(byteRange('bytes=90-', 100), { first: 90, last: 99 });
  assert.deepEqual(byteRange('bytes=-10', 100), { first: 90, last: 99 });
  assert.deepEqual(byteRange('bytes=50-500', 100), { first: 50, last: 99 });
  assert.equal(byteRange('bytes=100-', 100), 'unsatisfiable');
  assert.equal(byteRange('bytes=-', 100), null);
  assert.equal(byteRange(null, 100), null);
});

test('an unused file goes with its cover, a used or unknown one stays', async () => {
  const { removeUnusedFile } = await import('./media.ts');
  const { store, dir } = repo();
  writeFileSync(join(dir, 'a.mp4'), 'x');
  writeFileSync(join(dir, 'a.mp4.cover.jpg'), 'x');
  writeFileSync(join(dir, 'b.png'), 'x');
  await assert.rejects(removeUnusedFile(store, folder, 'b.png', ['b.png']), /still uses/);
  await assert.rejects(removeUnusedFile(store, folder, '../x.png', []), /not found/);
  await removeUnusedFile(store, folder, 'a.mp4', []);
  assert.deepEqual(await store.list(`posts/${folder}`), ['b.png']);
});
