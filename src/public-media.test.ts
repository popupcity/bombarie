import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { publicPath, renderPublic } from './public-media.ts';

const png = (width = 8, height = 8) => sharp({ create: { width, height, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();

async function project() {
  const root = mkdtempSync(join(tmpdir(), 'public-'));
  mkdirSync(join(root, 'posts', 'f'), { recursive: true });
  writeFileSync(join(root, 'posts', 'f', 'a.png'), await png(800, 1000));
  writeFileSync(join(root, 'posts', 'f', 'clip.mp4'), 'video bytes');
  return root;
}

const split = (path: string) => path.split('/').map(decodeURIComponent);

test('a signed path serves the picture as a JPEG, straight from the post folder', async () => {
  const root = await project();
  const found = await renderPublic(root, 'secret', split(publicPath('secret', 'jpg', 'f', 'a.png')));
  assert.equal(found?.type, 'image/jpeg');
  assert.deepEqual([(await sharp(found!.bytes).metadata()).format, (await sharp(found!.bytes).metadata()).width], ['jpeg', 800]);
});

test('a story becomes a 1080 x 1920 frame: the picture fits inside and a blurred copy fills the rest', async () => {
  const root = await project();
  const found = await renderPublic(root, 'secret', split(publicPath('secret', 'story', 'f', 'a.png')));
  const meta = await sharp(found!.bytes).metadata();
  assert.deepEqual([meta.width, meta.height, meta.format], [1080, 1920, 'jpeg']);
});

test('a video is served as it is', async () => {
  const root = await project();
  const found = await renderPublic(root, 'secret', split(publicPath('secret', 'mp4', 'f', 'clip.mp4')));
  assert.equal(found?.type, 'video/mp4');
  assert.equal(found?.bytes.toString(), 'video bytes');
});

test('a wrong signature, another secret, a changed name or a path outside the post is refused', async () => {
  const root = await project();
  const good = split(publicPath('secret', 'jpg', 'f', 'a.png'));
  assert.equal(await renderPublic(root, 'other', good), null);
  assert.equal(await renderPublic(root, 'secret', ['x'.repeat(32), ...good.slice(1)]), null);
  assert.equal(await renderPublic(root, 'secret', [good[0]!, good[1]!, good[2]!, 'b.png']), null);
  assert.equal(await renderPublic(root, 'secret', [good[0]!, 'png', 'f', 'a.png']), null);
  assert.equal(await renderPublic(root, 'secret', split(publicPath('secret', 'jpg', '..', 'channels.yml'))), null);
  assert.equal(await renderPublic(root, 'secret', split(publicPath('secret', 'jpg', 'f', 'missing.png'))), null);
});
