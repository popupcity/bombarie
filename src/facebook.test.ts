import assert from 'node:assert/strict';
import { test } from 'node:test';
import { facebook } from './facebook.ts';
import type { Channel, Post, SendContext } from './types.ts';

const channel: Channel = { platform: 'facebook', page: '55' };
const post = (extra: Partial<Post> = {}): Post => ({ id: 'a/b.md', channel: 'pop', type: null, status: 'planned', manual: false, date: new Date(), images: [], mentions: {}, text: 'Hello', ...extra });
const credentials = { accessToken: 'pagetok', accountId: '55' };

function setup() {
  const calls: { url: string; body: URLSearchParams | FormData | undefined }[] = [];
  const context: SendContext = {
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body as URLSearchParams | FormData | undefined });
      if (String(url).endsWith('/photos')) return new Response(JSON.stringify({ id: `p${calls.length}`, post_id: '55_9' }), { status: 200 });
      return new Response(JSON.stringify({ id: '55_7' }), { status: 200 });
    }) as unknown as typeof fetch,
    publicImage: async (path) => path,
    publicVideo: async (path) => `https://x.test/public/${path}`,
    readMedia: async () => new Uint8Array([1, 2, 3]),
    checkpoint: async () => {}
  };
  return { calls, context };
}

test('text goes to the feed with the link', async () => {
  const { calls, context } = setup();
  const result = await facebook.send(post({ link: 'https://x.test' }), channel, credentials, context);
  assert.deepEqual(result, { id: '55_7', url: 'https://www.facebook.com/55_7' });
  assert.match(calls[0]!.url, /\/55\/feed$/);
  const body = calls[0]!.body as URLSearchParams;
  assert.equal(body.get('message'), 'Hello');
  assert.equal(body.get('link'), 'https://x.test');
  assert.equal(body.get('access_token'), 'pagetok');
});

test('one image is uploaded as a photo with the text as caption', async () => {
  const { calls, context } = setup();
  const result = await facebook.send(post({ images: ['1.jpg'] }), channel, credentials, context);
  assert.equal(result.id, '55_9');
  assert.match(calls[0]!.url, /\/55\/photos$/);
  const body = calls[0]!.body as FormData;
  assert.equal(body.get('caption'), 'Hello');
  assert.equal(body.get('published'), 'true');
  assert.ok(body.get('source') instanceof Blob);
});

test('several images are uploaded without being posted and attached to one feed post', async () => {
  const { calls, context } = setup();
  await facebook.send(post({ images: ['1.jpg', '2.png'] }), channel, credentials, context);
  assert.equal((calls[0]!.body as FormData).get('published'), 'false');
  assert.match(calls[2]!.url, /\/55\/feed$/);
  const body = calls[2]!.body as URLSearchParams;
  assert.equal(body.get('attached_media[0]'), JSON.stringify({ media_fbid: 'p1' }));
  assert.equal(body.get('attached_media[1]'), JSON.stringify({ media_fbid: 'p2' }));
});

test('validate needs a linked page, content, and refuses stories and odd files', () => {
  assert.deepEqual(facebook.validate(post(), channel), []);
  assert.match(facebook.validate(post(), { platform: 'facebook' }).join(), /not linked/);
  assert.match(facebook.validate(post({ text: '' }), channel).join(), /needs text or an image/);
  assert.match(facebook.validate(post({ type: 'story' }), channel).join(), /stories/);
  assert.match(facebook.validate(post({ images: ['a.bmp'] }), channel).join(), /must be JPEG/);
});
