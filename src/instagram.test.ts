import assert from 'node:assert/strict';
import { test } from 'node:test';
import { instagram } from './instagram.ts';
import type { Channel, Post, SendContext } from './types.ts';

const channel: Channel = { platform: 'instagram', handle: 'pop' };
const post = (extra: Partial<Post> = {}): Post => ({ id: 'a/b.md', channel: 'pop', type: null, status: 'planned', manual: false, date: new Date(), images: ['1.jpg'], mentions: {}, text: 'Hello', ...extra });
const credentials = { accessToken: 'tok', accountId: '178' };

function setup(statuses: string[] = ['FINISHED']) {
  const calls: { url: string; body: Record<string, string> }[] = [];
  let n = 0;
  const queue = [...statuses];
  const context: SendContext = {
    fetch: (async (url: string, init?: RequestInit) => {
      const body = Object.fromEntries((init?.body as URLSearchParams | undefined) ?? []);
      calls.push({ url: String(url), body });
      if (String(url).endsWith('/media')) return new Response(JSON.stringify({ id: `c${(n += 1)}` }), { status: 200 });
      if (String(url).endsWith('/media_publish')) return new Response(JSON.stringify({ id: 'm1' }), { status: 200 });
      if (String(url).includes('fields=permalink')) return new Response(JSON.stringify({ permalink: 'https://instagram.com/p/x/' }), { status: 200 });
      return new Response(JSON.stringify({ status_code: queue.shift() ?? 'FINISHED' }), { status: 200 });
    }) as unknown as typeof fetch,
    publicImage: async (path) => `https://x.test/public/${path}`,
    publicVideo: async (path) => `https://x.test/public/${path}`,
    readMedia: async () => new Uint8Array(),
    sleep: async () => {},
    checkpoint: async () => {}
  };
  return { calls, context };
}

test('a single image becomes a container with the caption, then is posted', async () => {
  const { calls, context } = setup();
  const result = await instagram.send(post(), channel, credentials, context);
  assert.deepEqual(result, { id: 'm1', url: 'https://instagram.com/p/x/' });
  assert.equal(calls[0]?.body.image_url, 'https://x.test/public/1.jpg');
  assert.equal(calls[0]?.body.caption, 'Hello');
  assert.equal(calls.find((c) => c.url.endsWith('/media_publish'))?.body.creation_id, 'c1');
});

test('several images make a carousel of children', async () => {
  const { calls, context } = setup();
  await instagram.send(post({ images: ['1.jpg', '2.jpg'] }), channel, credentials, context);
  const media = calls.filter((c) => c.url.endsWith('/media'));
  assert.equal(media.length, 3);
  assert.equal(media[0]?.body.is_carousel_item, 'true');
  assert.equal(media[2]?.body.media_type, 'CAROUSEL');
  assert.equal(media[2]?.body.children, 'c1,c2');
});

test('a story is a STORIES container without a caption', async () => {
  const { calls, context } = setup();
  await instagram.send(post({ type: 'story' }), channel, credentials, context);
  assert.equal(calls[0]?.body.media_type, 'STORIES');
  assert.equal(calls[0]?.body.caption, undefined);
});

test('a container that fails to process is invalid, one that never finishes is retried', async () => {
  await assert.rejects(instagram.send(post(), channel, credentials, setup(['ERROR']).context), (e: { code?: string }) => e.code === 'invalid');
  await assert.rejects(instagram.send(post(), channel, credentials, setup(Array(30).fill('IN_PROGRESS')).context), (e: { code?: string }) => e.code === 'transient');
});

test('validate asks for an image and refuses a story with a link', () => {
  assert.match(instagram.validate(post({ images: [] }), channel).join(), /needs an image/);
  assert.match(instagram.validate(post({ type: 'story', link: 'https://x.test' }), channel).join(), /link sticker/);
  assert.deepEqual(instagram.validate(post(), channel), []);
  assert.match(instagram.validate(post(), { platform: 'instagram' }).join(), /not linked/);
});

test('a video is a REELS container with the caption and a cover, waited for longer, then posted', async () => {
  const { calls, context } = setup(['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED']);
  const result = await instagram.send(post({ images: ['clip.mp4'] }), channel, credentials, context);
  assert.equal(result.id, 'm1');
  assert.equal(calls[0]?.body.media_type, 'REELS');
  assert.equal(calls[0]?.body.video_url, 'https://x.test/public/clip.mp4');
  assert.equal(calls[0]?.body.caption, 'Hello');
  assert.equal(calls[0]?.body.share_to_feed, 'true');
  assert.equal(calls[0]?.body.cover_url, 'https://x.test/public/clip.mp4.cover.jpg');
  assert.equal(calls.filter((c) => c.url.includes('status_code')).length, 3);
  assert.equal(calls.find((c) => c.url.endsWith('/media_publish'))?.body.creation_id, 'c1');
});

test('a video story is a STORIES container with a video and no caption, a video cannot be mixed with images', async () => {
  const { calls, context } = setup();
  await instagram.send(post({ type: 'story', images: ['clip.mp4'] }), channel, credentials, context);
  assert.equal(calls[0]?.body.media_type, 'STORIES');
  assert.equal(calls[0]?.body.video_url, 'https://x.test/public/clip.mp4');
  assert.equal(calls[0]?.body.caption, undefined);
  assert.equal(calls[0]?.body.cover_url, undefined);
  assert.deepEqual(instagram.validate(post({ images: ['clip.mp4'] }), channel), []);
  assert.ok(instagram.validate(post({ images: ['clip.mp4', '1.jpg'] }), channel).some((issue) => /video cannot be combined/.test(issue)));
  assert.ok(instagram.validate(post({ images: ['deck.pdf'] }), channel).some((issue) => /PDF/.test(issue)));
});

test('a video that Instagram never finishes is retried, and one it rejects is invalid', async () => {
  await assert.rejects(instagram.send(post({ images: ['clip.mp4'] }), channel, credentials, setup(Array(70).fill('IN_PROGRESS')).context), (e: { code?: string }) => e.code === 'transient');
  await assert.rejects(instagram.send(post({ images: ['clip.mp4'] }), channel, credentials, setup(['ERROR']).context), (e: { message?: string }) => /could not process the video/.test(e.message ?? ''));
});
