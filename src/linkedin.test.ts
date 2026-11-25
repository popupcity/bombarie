import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escapeLittleText, linkedin, littleText } from './linkedin.ts';
import { ProviderError } from './types.ts';
import type { Channel, Post, SendContext } from './types.ts';

const person: Channel = { platform: 'linkedin', kind: 'person', urn: 'urn:li:person:abc' };
const org: Channel = { platform: 'linkedin', kind: 'organization', urn: 'urn:li:organization:716321' };
const credentials = { accessToken: 'secret-token' };

function post(over: Partial<Post> = {}): Post {
  return {
    id: 'f/a.md',
    channel: 'a',
    type: null,
    status: 'planned',
    manual: false,
    date: new Date('2026-11-20T09:00:00Z'),
    images: [],
    mentions: {},
    text: 'Hallo',
    ...over
  };
}

interface Call {
  url: string;
  init: RequestInit;
}

function setup(route: (url: string, init: RequestInit, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const checkpoints: string[] = [];
  const context: SendContext = {
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return route(url, init, calls.length);
    }) as unknown as typeof fetch,
    publicImage: async (path) => `https://cdn.example/${path}`,
    publicVideo: async (path) => `https://x.test/public/${path}`,
    readMedia: async () => new Uint8Array([1, 2, 3]),
    checkpoint: async (id) => {
      checkpoints.push(id);
    }
  };
  return { calls, checkpoints, context };
}

const created = (id = 'urn:li:share:1') => new Response(null, { status: 201, headers: { 'x-restli-id': id } });

const bodyOf = (call: Call | undefined) => JSON.parse(String(call?.init.body)) as Record<string, any>;

test('littleText escapes reserved characters and keeps hashtags', () => {
  assert.equal(escapeLittleText('a (b) #tag c#d'), 'a \\(b\\) #tag c\\#d');
});

test('littleText turns listed names into mentions, longest name first', () => {
  const out = littleText('Met Pop-up City en Pop-up (nieuw).', {
    'Pop-up City': 'urn:li:organization:1',
    'Pop-up': 'urn:li:organization:2'
  });
  assert.equal(out, 'Met @[Pop-up City](urn:li:organization:1) en @[Pop-up](urn:li:organization:2) \\(nieuw\\).');
});

test('a text post is sent with the right headers, author and id handling', async () => {
  const { calls, checkpoints, context } = setup(() => created());
  const result = await linkedin.send(post({ text: 'Hallo (wereld) #tag' }), person, credentials, context);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://api.linkedin.com/rest/posts');
  const headers = calls[0]?.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer secret-token');
  assert.equal(headers['LinkedIn-Version'], '202609');
  const body = bodyOf(calls[0]);
  assert.equal(body.author, 'urn:li:person:abc');
  assert.equal(body.commentary, 'Hallo \\(wereld\\) #tag');
  assert.equal(body.content, undefined);
  assert.deepEqual(result, {
    id: 'urn:li:share:1',
    url: 'https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A1/'
  });
  assert.deepEqual(checkpoints, ['urn:li:share:1']);
});

test('an organization posts as itself and mentions are written as little text', async () => {
  const { calls, context } = setup(() => created());
  await linkedin.send(
    post({ text: 'Met Pop-up City erbij.', mentions: { 'Pop-up City': 'urn:li:organization:716321' } }),
    org,
    credentials,
    context
  );
  const body = bodyOf(calls[0]);
  assert.equal(body.author, 'urn:li:organization:716321');
  assert.equal(body.commentary, 'Met @[Pop-up City](urn:li:organization:716321) erbij.');
});

test('images are uploaded first, one image as media and several as multiImage', async () => {
  const route = (url: string, _init: RequestInit, n: number) => {
    if (url.includes('initializeUpload')) {
      return new Response(JSON.stringify({ value: { uploadUrl: `https://upload.example/${n}`, image: `urn:li:image:${n}` } }), {
        status: 200
      });
    }
    if (url.startsWith('https://upload.example/')) return new Response(null, { status: 201 });
    return created();
  };

  const one = setup(route);
  await linkedin.send(post({ images: ['a.jpg'] }), person, credentials, one.context);
  assert.deepEqual(
    one.calls.map((c) => c.init.method),
    ['POST', 'PUT', 'POST']
  );
  assert.deepEqual(bodyOf(one.calls[2]).content, { media: { id: 'urn:li:image:1' } });

  const two = setup(route);
  await linkedin.send(post({ images: ['a.jpg', 'b.png'] }), person, credentials, two.context);
  assert.equal(two.calls.length, 5);
  assert.deepEqual(bodyOf(two.calls[4]).content, {
    multiImage: { images: [{ id: 'urn:li:image:1' }, { id: 'urn:li:image:3' }] }
  });
  const put = two.calls[1]?.init;
  assert.equal((put?.headers as Record<string, string>)['Content-Type'], 'image/jpeg');
  assert.equal((put?.headers as Record<string, string>).Authorization, undefined);
});

async function failure(route: () => Response | Promise<Response>, images: string[] = []) {
  const { context, checkpoints } = setup(route);
  const err = await linkedin.send(post({ images }), person, credentials, context).then(
    () => null,
    (e: unknown) => e
  );
  assert.ok(err instanceof ProviderError, String(err));
  assert.deepEqual(checkpoints, []);
  return err;
}

test('failures are classified by whether the post may exist', async () => {
  assert.equal((await failure(() => new Response('bad', { status: 400 }))).code, 'invalid');
  assert.equal((await failure(() => new Response('', { status: 401 }))).code, 'auth');
  assert.equal((await failure(() => new Response('', { status: 429 }))).code, 'rate');
  assert.equal((await failure(() => new Response('', { status: 503 }))).code, 'unconfirmed');
  assert.equal(
    (
      await failure(() => {
        throw new Error('socket hang up');
      })
    ).code,
    'unconfirmed'
  );
  assert.equal((await failure(() => new Response(null, { status: 201 }))).code, 'unconfirmed');
});

test('a server error before the post exists is transient, not unconfirmed', async () => {
  const err = await failure(() => new Response('', { status: 500 }), ['a.jpg']);
  assert.equal(err.code, 'transient');
});

test('unsupported and oversized images are refused before any call', async () => {
  const webp = setup(() => created());
  await assert.rejects(linkedin.send(post({ images: ['a.webp'] }), person, credentials, webp.context), /JPEG, PNG or GIF/);
  assert.equal(webp.calls.length, 0);

  const big = setup(() => created());
  big.context.readMedia = async () => new Uint8Array(8 * 1024 * 1024 + 1);
  await assert.rejects(linkedin.send(post({ images: ['a.jpg'] }), person, credentials, big.context), /over 8 MB/);
  assert.equal(big.calls.length, 0);
});

test('validate reports channel, text, image and mention problems', () => {
  assert.deepEqual(linkedin.validate(post(), person), []);
  assert.match(linkedin.validate(post(), { platform: 'linkedin', kind: 'person' })[0] ?? '', /not linked to a LinkedIn profile/);
  assert.match(linkedin.validate(post(), { ...org, urn: 'urn:li:person:x' })[0] ?? '', /urn:li:organization:/);
  assert.ok(linkedin.validate(post({ text: 'x'.repeat(3001) }), person).some((i) => i.includes('3000')));
  assert.ok(linkedin.validate(post({ images: ['a.webp'] }), person).some((i) => i.includes('JPEG')));
  assert.ok(linkedin.validate(post({ mentions: { Nobody: 'urn:li:person:1' } }), person).some((i) => i.includes('does not appear')));
});

test('a PDF is uploaded as a document, checked until it is available and posted with the title', async () => {
  let checks = 0;
  const { calls, context } = setup((url, init) => {
    if (url.includes('/rest/documents?action=initializeUpload')) return Response.json({ value: { uploadUrl: 'https://upload.example/d', document: 'urn:li:document:9' } });
    if (url === 'https://upload.example/d') return new Response(null, { status: 201 });
    if (url.includes('/rest/documents/')) return Response.json({ status: (checks += 1) < 2 ? 'PROCESSING' : 'AVAILABLE' });
    return created();
  });
  context.sleep = async () => {};
  await linkedin.send(post({ images: ['deck.pdf'], title: 'Our deck' }), person, credentials, context);
  assert.deepEqual(calls.map((call) => call.url.split('?')[0]), ['https://api.linkedin.com/rest/documents', 'https://upload.example/d', 'https://api.linkedin.com/rest/documents/urn%3Ali%3Adocument%3A9', 'https://api.linkedin.com/rest/documents/urn%3Ali%3Adocument%3A9', 'https://api.linkedin.com/rest/posts']);
  assert.deepEqual(bodyOf(calls.at(-1)).content, { media: { title: 'Our deck', id: 'urn:li:document:9' } });
});

test('a failed PDF is an invalid error, and a PDF cannot be mixed with images', async () => {
  const { context } = setup((url) => {
    if (url.includes('initializeUpload')) return Response.json({ value: { uploadUrl: 'https://upload.example/d', document: 'urn:li:document:9' } });
    if (url === 'https://upload.example/d') return new Response(null, { status: 201 });
    return Response.json({ status: 'PROCESSING_FAILED' });
  });
  await assert.rejects(linkedin.send(post({ images: ['deck.pdf'] }), person, credentials, context), /could not process the PDF/);
  assert.ok(linkedin.validate(post({ images: ['deck.pdf', 'a.jpg'] }), person).some((issue) => /cannot be combined/.test(issue)));
  assert.deepEqual(linkedin.validate(post({ images: ['deck.pdf'] }), person), []);
});

test('a video is uploaded in parts with their ETags, finalized, waited for and posted', async () => {
  let checks = 0;
  const { calls, context } = setup((url) => {
    if (url.includes('/rest/videos?action=initializeUpload')) {
      return Response.json({ value: { video: 'urn:li:video:7', uploadToken: 'tok', uploadInstructions: [{ uploadUrl: 'https://upload.example/p1', firstByte: 0, lastByte: 1 }, { uploadUrl: 'https://upload.example/p2', firstByte: 2, lastByte: 2 }] } });
    }
    if (url.startsWith('https://upload.example/p')) return new Response(null, { status: 200, headers: { etag: `"etag-${url.slice(-1)}"` } });
    if (url.includes('action=finalizeUpload')) return new Response(null, { status: 200 });
    if (url.includes('/rest/videos/')) return Response.json({ status: (checks += 1) < 2 ? 'PROCESSING' : 'AVAILABLE' });
    return created();
  });
  context.sleep = async () => {};
  await linkedin.send(post({ images: ['clip.mp4'] }), person, credentials, context);
  const init = bodyOf(calls[0]).initializeUploadRequest;
  assert.deepEqual(init, { owner: 'urn:li:person:abc', fileSizeBytes: 3, uploadCaptions: false, uploadThumbnail: false });
  assert.deepEqual(bodyOf(calls.find((call) => call.url.includes('finalizeUpload'))).finalizeUploadRequest, { video: 'urn:li:video:7', uploadToken: 'tok', uploadedPartIds: ['etag-1', 'etag-2'] });
  assert.deepEqual(bodyOf(calls.at(-1)).content, { media: { id: 'urn:li:video:7' } });
});

test('a failed video is an invalid error, broken upload instructions are refused and a video cannot be mixed with images', async () => {
  const failing = setup((url) => {
    if (url.includes('initializeUpload')) return Response.json({ value: { video: 'urn:li:video:7', uploadToken: '', uploadInstructions: [{ uploadUrl: 'https://upload.example/p1', firstByte: 0, lastByte: 2 }] } });
    if (url.startsWith('https://upload.example/')) return new Response(null, { status: 200, headers: { etag: 'e' } });
    if (url.includes('action=finalizeUpload')) return new Response(null, { status: 200 });
    return Response.json({ status: 'PROCESSING_FAILED', processingFailureReason: 'BAD_CODEC' });
  });
  await assert.rejects(linkedin.send(post({ images: ['clip.mp4'] }), person, credentials, failing.context), /could not process the video: BAD_CODEC/);
  const gap = setup((url) => (url.includes('initializeUpload') ? Response.json({ value: { video: 'urn:li:video:7', uploadInstructions: [{ uploadUrl: 'https://upload.example/p1', firstByte: 1, lastByte: 2 }] } }) : created()));
  await assert.rejects(linkedin.send(post({ images: ['clip.mp4'] }), person, credentials, gap.context), /invalid upload instructions/);
  assert.ok(linkedin.validate(post({ images: ['clip.mp4', 'a.jpg'] }), person).some((issue) => /video cannot be combined/.test(issue)));
  assert.deepEqual(linkedin.validate(post({ images: ['clip.mp4'] }), person), []);
});

test('comments are posted under the new post, as the author', async () => {
  const { calls, context } = setup((url) => (url.includes('/socialActions/') ? created('urn:li:comment:1') : created('urn:li:share:7')));
  const result = await linkedin.send(post({ replies: ['First comment.', 'Second.'] }), person, credentials, context);
  assert.equal(result.warning, undefined);
  const comments = calls.filter((call) => call.url.includes('/socialActions/'));
  assert.equal(comments.length, 2);
  assert.equal(comments[0]?.url, 'https://api.linkedin.com/v2/socialActions/urn%3Ali%3Ashare%3A7/comments');
  assert.deepEqual(bodyOf(comments[0]), { actor: 'urn:li:person:abc', object: 'urn:li:share:7', message: { text: 'First comment.' } });
  assert.equal((comments[0]?.init.headers as Record<string, string>)['LinkedIn-Version'], undefined);
  assert.equal((comments[0]?.init.headers as Record<string, string>)['X-Restli-Protocol-Version'], '2.0.0');
});

test('a refused comment leaves the post up and comes back as a warning', async () => {
  const { context } = setup((url) => (url.includes('/socialActions/') ? new Response('{"message":"no"}', { status: 403 }) : created('urn:li:share:7')));
  const result = await linkedin.send(post({ replies: ['Comment.'] }), person, credentials, context);
  assert.equal(result.id, 'urn:li:share:7');
  assert.match(result.warning ?? '', /^Posted, but comment 1 of 1 failed/);
  assert.match(result.warning ?? '', /may not allow comments/);
});

test('empty and overlong comments are refused before anything is sent', () => {
  assert.ok(linkedin.validate(post({ replies: ['ok', ''] }), person).includes('comment 2 is empty'));
  assert.ok(linkedin.validate(post({ replies: ['x'.repeat(1251)] }), person).some((issue) => issue.includes('1250')));
});
