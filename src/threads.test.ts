import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadChannels } from './channels.ts';
import { readTokens } from './secrets.ts';
import { finishThreads, refreshThreadsTokens, threads, threadsAuthorizeUrl } from './threads.ts';
import type { Channel, Post, SendContext } from './types.ts';
import { secretOf } from './secrets.ts';
import { seal } from './vault.ts';

const channel: Channel = { platform: 'threads', handle: 'pop' };
const post = (extra: Partial<Post> = {}): Post => ({ id: 'a/b.md', channel: 'pop', type: null, status: 'planned', manual: false, date: new Date(), images: [], mentions: {}, text: 'Hello', ...extra });
const credentials = { accessToken: 'tok', accountId: '178' };

function setup(statuses: string[] = ['FINISHED']) {
  const calls: { url: string; method: string; body: Record<string, string> }[] = [];
  let n = 0;
  const queue = [...statuses];
  const context: SendContext = {
    fetch: (async (url: string, init?: RequestInit) => {
      const body = Object.fromEntries((init?.body as URLSearchParams | undefined) ?? []);
      calls.push({ url: String(url), method: init?.method ?? 'GET', body });
      if (String(url).endsWith('/threads')) return new Response(JSON.stringify({ id: `c${(n += 1)}` }), { status: 200 });
      if (String(url).endsWith('/threads_publish')) return new Response(JSON.stringify({ id: 'm1' }), { status: 200 });
      if (String(url).includes('fields=permalink')) return new Response(JSON.stringify({ permalink: 'https://www.threads.com/@pop/post/x' }), { status: 200 });
      return new Response(JSON.stringify({ status: queue.shift() ?? 'FINISHED' }), { status: 200 });
    }) as unknown as typeof fetch,
    publicImage: async (path) => `https://x.test/public/${path}`,
    publicVideo: async (path) => `https://x.test/public/${path}`,
    readMedia: async () => new Uint8Array(),
    sleep: async () => {},
    checkpoint: async () => {}
  };
  return { calls, context };
}

test('a text post is a TEXT container with its link, then posted, and the permalink comes back', async () => {
  const { calls, context } = setup();
  const result = await threads.send(post({ link: 'https://example.com' }), channel, credentials, context);
  assert.deepEqual(result, { id: 'm1', url: 'https://www.threads.com/@pop/post/x' });
  assert.ok(calls[0]?.url.startsWith('https://graph.threads.com/v1.0/178/threads'));
  assert.equal(calls[0]?.body.media_type, 'TEXT');
  assert.equal(calls[0]?.body.text, 'Hello');
  assert.equal(calls[0]?.body.link_attachment, 'https://example.com');
  assert.equal(calls.find((c) => c.url.endsWith('/threads_publish'))?.body.creation_id, 'c1');
});

test('one picture is an IMAGE container, several pictures are a carousel of children', async () => {
  const one = setup();
  await threads.send(post({ images: ['1.jpg'] }), channel, credentials, one.context);
  assert.equal(one.calls[0]?.body.media_type, 'IMAGE');
  assert.equal(one.calls[0]?.body.image_url, 'https://x.test/public/1.jpg');
  const many = setup();
  await threads.send(post({ images: ['1.jpg', '2.jpg'] }), channel, credentials, many.context);
  const made = many.calls.filter((c) => c.url.endsWith('/threads'));
  assert.equal(made.length, 3);
  assert.equal(made[0]?.body.is_carousel_item, 'true');
  assert.equal(made[2]?.body.media_type, 'CAROUSEL');
  assert.equal(made[2]?.body.children, 'c1,c2');
  assert.equal(made[2]?.body.text, 'Hello');
});

test('a video is a VIDEO container waited for longer, and failures say what they are', async () => {
  const { calls, context } = setup(['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED']);
  await threads.send(post({ images: ['clip.mp4'] }), channel, credentials, context);
  assert.equal(calls[0]?.body.media_type, 'VIDEO');
  assert.equal(calls[0]?.body.video_url, 'https://x.test/public/clip.mp4');
  assert.equal(calls.filter((c) => c.url.includes('fields=status')).length, 3);
  await assert.rejects(threads.send(post({ images: ['clip.mp4'] }), channel, credentials, setup(Array(70).fill('IN_PROGRESS')).context), (e: { code?: string }) => e.code === 'transient');
  await assert.rejects(threads.send(post(), channel, credentials, setup(['ERROR']).context), (e: { code?: string }) => e.code === 'invalid');
});

test('the rules: 500 characters, text or a picture, one video, no PDF, no story, a connected account', () => {
  assert.deepEqual(threads.validate(post(), channel), []);
  assert.ok(threads.validate(post({ text: 'x'.repeat(501) }), channel).some((issue) => /over 500/.test(issue)));
  assert.ok(threads.validate(post({ text: '' }), channel).some((issue) => /text or a picture/.test(issue)));
  assert.ok(threads.validate(post({ images: ['a.mp4', 'b.jpg'] }), channel).some((issue) => /video cannot be combined/.test(issue)));
  assert.ok(threads.validate(post({ images: ['a.pdf'] }), channel).some((issue) => /PDF/.test(issue)));
  assert.ok(threads.validate(post({ type: 'story' }), channel).some((issue) => /no stories/.test(issue)));
  assert.ok(threads.validate(post(), { platform: 'threads' }).some((issue) => /not linked/.test(issue)));
  assert.match(threadsAuthorizeUrl('app', 'https://x.test/cb', 's'), /^https:\/\/threads\.com\/oauth\/authorize\?client_id=app&redirect_uri=https%3A%2F%2Fx\.test%2Fcb&scope=threads_basic%2Cthreads_content_publish%2Cthreads_manage_replies%2Cthreads_manage_insights&response_type=code&state=s$/);
});

test('connecting exchanges the code twice, saves the long-lived token and the username, and refuses another account', async () => {
  const root = mkdtempSync(join(tmpdir(), 'threads-'));
  mkdirSync(join(root, 'channels'), { recursive: true });
  writeFileSync(join(root, 'channels', 'channels.yml'), 'pop-threads:\n  platform: threads\n');
  const tokens = join(root, 'tokens.json');
  const seen: string[] = [];
  const fetchImpl = (async (url: string) => {
    seen.push(String(url).split('?')[0]!);
    if (String(url).endsWith('/oauth/access_token')) return Response.json({ access_token: 'short', user_id: 17841 });
    if (String(url).includes('/access_token?')) return Response.json({ access_token: 'long', expires_in: 5183944 });
    if (String(url).includes('fields=id%2Cusername')) return Response.json({ id: '17841', username: 'pop' });
    return Response.json({});
  }) as unknown as typeof fetch;
  const args = { root, name: 'pop-threads', channel: loadChannels(root)['pop-threads']!, clientId: 'app', clientSecret: 'sec', code: 'c', redirectUri: 'https://x.test/cb', tokens, now: new Date('2026-11-23T10:00:00Z'), fetchImpl };
  const done = await finishThreads(args);
  assert.equal(done.username, 'pop');
  const saved = (await readTokens(tokens))['pop-threads'];
  assert.equal(saved?.accessToken, 'long');
  assert.equal(saved?.accountId, '17841');
  assert.equal(saved?.expiresAt?.toISOString().slice(0, 10), '2027-01-22');
  assert.match(readFileSync(join(root, 'channels', 'channels.yml'), 'utf8'), /handle: pop/);
  await assert.rejects(finishThreads({ ...args, channel: { platform: 'threads', handle: 'someone' } }), /not @someone|@pop, not @someone/);
});

test('the user id comes from the profile as text, because the token response carries it as a number too big for JavaScript', async () => {
  const root = mkdtempSync(join(tmpdir(), 'threads-'));
  mkdirSync(join(root, 'channels'), { recursive: true });
  writeFileSync(join(root, 'channels', 'channels.yml'), 'pop-threads:\n  platform: threads\n');
  const tokens = join(root, 'tokens.json');
  const fetchImpl = (async (url: string) => {
    if (String(url).endsWith('/oauth/access_token')) return new Response('{"access_token":"short","user_id":40033573892957919}');
    if (String(url).includes('/access_token?')) return Response.json({ access_token: 'long', expires_in: 5183944 });
    if (String(url).includes('fields=id%2Cusername')) return new Response('{"id":"40033573892957919","username":"pop"}');
    return Response.json({});
  }) as unknown as typeof fetch;
  await finishThreads({ root, name: 'pop-threads', channel: loadChannels(root)['pop-threads']!, clientId: 'app', clientSecret: 'sec', code: 'c', redirectUri: 'https://x.test/cb', tokens, now: new Date('2026-11-23T10:00:00Z'), fetchImpl });
  assert.equal((await readTokens(tokens))['pop-threads']?.accountId, '40033573892957919');
});

test('a token is renewed only in its last two weeks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'threads-'));
  const tokens = join(root, 'tokens.json');
  const now = new Date('2026-11-23T10:00:00Z');
  writeFileSync(tokens, seal({ soon: { accessToken: 'a', expiresAt: '2026-12-01T00:00:00Z' }, later: { accessToken: 'b', expiresAt: '2027-01-20T00:00:00Z' }, gone: { accessToken: 'c', expiresAt: '2026-11-01T00:00:00Z' } }, secretOf(tokens)), { mode: 0o600 });
  const asked: string[] = [];
  const fetchImpl = (async (url: string) => {
    asked.push(String(url));
    return Response.json({ access_token: 'renewed', expires_in: 5184000 });
  }) as unknown as typeof fetch;
  assert.deepEqual(await refreshThreadsTokens(tokens, ['soon', 'later', 'gone', 'missing'], fetchImpl, now), ['soon']);
  assert.equal(asked.length, 1);
  assert.equal((await readTokens(tokens)).soon?.accessToken, 'renewed');
  assert.equal((await readTokens(tokens)).later?.accessToken, 'b');
});

test('replies are posted one after the other, each answering the one before', async () => {
  const { calls, context } = setup();
  const result = await threads.send(post({ replies: ['Second.', 'Third.'] }), channel, credentials, context);
  assert.equal(result.warning, undefined);
  const replies = calls.filter((c) => c.url.endsWith('/threads') && c.body.reply_to_id !== undefined);
  assert.equal(replies.length, 2);
  assert.equal(replies[0]?.body.text, 'Second.');
  assert.equal(replies[0]?.body.reply_to_id, 'm1');
  assert.equal(calls.filter((c) => c.url.endsWith('/threads_publish')).length, 3);
});

test('a failing reply leaves the post up and comes back as a warning', async () => {
  const { context } = setup();
  const base = context.fetch;
  let publishes = 0;
  context.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/threads_publish') && (publishes += 1) === 2) return new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 400 });
    return base(url, init);
  }) as unknown as typeof fetch;
  const result = await threads.send(post({ replies: ['Second.'] }), channel, credentials, context);
  assert.equal(result.id, 'm1');
  assert.match(result.warning ?? '', /^Posted, but reply 1 of 1 failed/);
});

test('empty and overlong replies are refused before anything is sent', () => {
  assert.deepEqual(threads.validate(post({ replies: ['ok'] }), channel), []);
  assert.deepEqual(threads.validate(post({ replies: ['ok', ''] }), channel), ['reply 2 is empty']);
  assert.match(threads.validate(post({ replies: ['x'.repeat(501)] }), channel)[0] ?? '', /reply 1 is over 500/);
});

test('a later reply continues the chain from the last reply sent', async () => {
  const { calls, context } = setup();
  const result = await threads.reply!({ remoteId: 'm1', texts: ['More.'], offset: 1, last: 'r9' }, channel, credentials, context.fetch);
  assert.equal(result.sent, 1);
  assert.equal(result.warning, undefined);
  assert.equal(calls.find((c) => c.url.endsWith('/threads'))?.body.reply_to_id, 'r9');
  assert.ok(typeof result.last === 'string' && result.last !== 'r9');
});

test('a reply with one image is an IMAGE reply, with more a CAROUSEL under the same parent', async () => {
  const { calls, context } = setup();
  await threads.send(post({ replies: ['One.', 'Two.'], replyImages: [['a.jpg'], ['b.jpg', 'c.jpg']] }), channel, credentials, context);
  const made = calls.filter((c) => c.url.endsWith('/threads')).map((c) => c.body);
  assert.deepEqual([made[1]?.media_type, made[1]?.text, made[1]?.reply_to_id, made[1]?.image_url], ['IMAGE', 'One.', 'm1', 'https://x.test/public/a.jpg']);
  assert.deepEqual(made.slice(2, 4).map((body) => [body.is_carousel_item, body.reply_to_id]), [['true', undefined], ['true', undefined]]);
  assert.deepEqual([made[4]?.media_type, made[4]?.text, made[4]?.reply_to_id, made[4]?.children], ['CAROUSEL', 'Two.', 'm1', 'c3,c4']);
});

test('a reply takes images or one video, no PDF, and a reply added later gets the files that belong to it', async () => {
  const issues = (names: string[]) => threads.validate(post({ replies: ['x'], replyImages: [names] }), channel);
  assert.deepEqual([issues(['a.mp4']), issues(['a.mp4', 'b.jpg']), issues(['a.pdf'])], [[], ['a video in a reply cannot be combined with other files'], ['Threads does not take a PDF in a reply']]);
  const { calls, context } = setup();
  await threads.reply!({ remoteId: 'r9', texts: ['Later.'], offset: 1, images: [['late.jpg']], publicImage: context.publicImage }, channel, credentials, context.fetch);
  assert.equal(calls[0]?.body.image_url, 'https://x.test/public/late.jpg');
});

test('a reply with a video is a VIDEO reply under its parent', async () => {
  const { calls, context } = setup();
  await threads.send(post({ replies: ['Watch.'], replyImages: [['clip.mp4']] }), channel, credentials, context);
  const made = calls.filter((c) => c.url.endsWith('/threads')).map((c) => c.body);
  assert.deepEqual([made[1]?.media_type, made[1]?.video_url, made[1]?.reply_to_id, made[1]?.text], ['VIDEO', 'https://x.test/public/clip.mp4', 'm1', 'Watch.']);
});
