import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { checkAvatarUrl, downloadAvatar, saveAvatar } from './avatars.ts';
import { loadChannels } from './channels.ts';
import { refreshLinkedinAvatar } from './connect.ts';

const PICTURE = 'https://media.licdn.com/dms/image/abc/profile.jpg';

async function png(width = 300, height = 200): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#c33' } })
    .png()
    .toBuffer();
}

function serve(routes: Record<string, () => Response | Promise<Response>>, seen: { url: string; init?: RequestInit }[] = []) {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), ...(init && { init }) });
    const route = routes[String(url)];
    return route ? route() : new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

const image = async () => new Response(new Uint8Array(await png()), { status: 200, headers: { 'content-type': 'image/png' } });

test('only https urls on a LinkedIn image host are accepted', () => {
  assert.equal(checkAvatarUrl(PICTURE).hostname, 'media.licdn.com');
  assert.equal(checkAvatarUrl('https://licdn.com/a.jpg').hostname, 'licdn.com');
  for (const bad of [
    'http://media.licdn.com/a.jpg',
    'https://evil.com/a.jpg',
    'https://licdn.com.evil.com/a.jpg',
    'https://notlicdn.com/a.jpg',
    'file:///etc/passwd',
    'nonsense'
  ]) {
    assert.throws(() => checkAvatarUrl(bad), /avatar/);
  }
});

test('downloadAvatar refuses redirects, non-images and oversized files', async () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  const bytes = await downloadAvatar(PICTURE, serve({ [PICTURE]: image }, seen));
  assert.ok(bytes.length > 0);
  assert.equal((seen[0]?.init as RequestInit).redirect, 'error');

  await assert.rejects(downloadAvatar(PICTURE, serve({ [PICTURE]: () => new Response('x', { status: 403 }) })), /\(403\)/);
  await assert.rejects(
    downloadAvatar(PICTURE, serve({ [PICTURE]: () => new Response('<html>', { headers: { 'content-type': 'text/html' } }) })),
    /not an image/
  );
  await assert.rejects(
    downloadAvatar(
      PICTURE,
      serve({ [PICTURE]: () => new Response('x', { headers: { 'content-type': 'image/png', 'content-length': String(6 * 1024 * 1024) } }) })
    ),
    /too large/
  );
});

test('saveAvatar writes a 256px square jpeg and refuses unsafe names', async () => {
  const root = mkdtempSync(join(tmpdir(), 'social-avatar-'));
  const relative = await saveAvatar(root, 'jeroen-linkedin', await png(400, 200));
  assert.equal(relative, 'avatars/jeroen-linkedin.jpg');
  const meta = await sharp(join(root, relative)).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['jpeg', 256, 256]);

  for (const bad of ['../x', 'a/b', '.hidden', '', 'a b']) {
    await assert.rejects(saveAvatar(root, bad, await png()), /unsafe channel name/);
  }
  await assert.rejects(saveAvatar(root, 'ok', new Uint8Array([1, 2, 3])));
});

test('refreshLinkedinAvatar stores the picture and records it in channels.yml', async () => {
  const root = mkdtempSync(join(tmpdir(), 'social-avatar-'));
  const channelsFile = join(root, 'channels.yml');
  writeFileSync(channelsFile, '# mine\njeroen-linkedin:\n  platform: linkedin\n  kind: person\n');

  const fetchImpl = serve({
    'https://api.linkedin.com/v2/userinfo': () =>
      new Response(JSON.stringify({ sub: 'abc', name: 'Jeroen', picture: PICTURE }), { status: 200 }),
    [PICTURE]: image
  });
  const saved = await refreshLinkedinAvatar({ root, channel: 'jeroen-linkedin', accessToken: 't', fetchImpl });

  assert.equal(saved, 'avatars/jeroen-linkedin.jpg');
  assert.ok(existsSync(join(root, saved)));
  assert.equal(
    readFileSync(channelsFile, 'utf8'),
    '# mine\njeroen-linkedin:\n  platform: linkedin\n  kind: person\n  avatar: avatars/jeroen-linkedin.jpg\n'
  );
  assert.equal(loadChannels(root)['jeroen-linkedin']?.avatar, 'avatars/jeroen-linkedin.jpg');
});

test('a profile without a picture changes nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'social-avatar-'));
  const channelsFile = join(root, 'channels.yml');
  const original = 'a-linkedin:\n  platform: linkedin\n';
  writeFileSync(channelsFile, original);
  const fetchImpl = serve({ 'https://api.linkedin.com/v2/userinfo': () => new Response(JSON.stringify({ sub: 'abc' }), { status: 200 }) });

  assert.equal(await refreshLinkedinAvatar({ root, channel: 'a-linkedin', accessToken: 't', fetchImpl }), null);
  assert.equal(readFileSync(channelsFile, 'utf8'), original);
  assert.equal(existsSync(join(root, 'avatars')), false);
});
