import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileStore } from './state.ts';
import { remind, reminderMessages } from './remind.ts';
import { telegram } from './telegram.ts';
import type { Post } from './types.ts';

const now = new Date('2026-11-20T09:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const fresh = () => fileStore(mkdtempSync(join(tmpdir(), 'social-remind-')));

function post(id: string, over: Partial<Post> = {}): Post {
  return {
    id,
    channel: 'popupcity-instagram',
    type: 'story',
    status: 'planned',
    manual: true,
    date: minutesAgo(5),
    images: [],
    mentions: {},
    text: 'Story met link',
    link: 'https://popupcity.net',
    ...over
  };
}

const channels = { 'popupcity-instagram': { platform: 'instagram' as const, name: 'Pop-Up City' } };

test('a reminder is a heading with the title, then only the text to copy with the View link under it', () => {
  const [head, body] = reminderMessages(post('f/a.md'), { channels, title: 'Opening', base: 'https://x.test' });
  assert.deepEqual(head, { text: "Time to post on Pop-Up City's Instagram (story):\n\nOpening", bold: 'Opening' });
  assert.deepEqual(body, { text: 'Story met link\n\nhttps://popupcity.net', view: 'https://x.test/posts/f/a' });
});

test('without text or title there is one message, with the View link', () => {
  assert.deepEqual(reminderMessages(post('f/a.md', { type: null, text: '', link: undefined as never }), { channels, base: 'https://x.test' }), [
    { text: "Time to post on Pop-Up City's Instagram:", view: 'https://x.test/posts/f/a' }
  ]);
});

test('a message gets a bold title and a button, and a link as text when the address is not https', async () => {
  const bodies: Record<string, unknown>[] = [];
  const send = telegram('t', '1', (async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response('{}');
  }) as typeof fetch);
  await send({ text: 'Head\n\nTitle', bold: 'Title', view: 'https://x.test/a' });
  await send({ text: 'Local', view: 'http://localhost/a' });
  assert.deepEqual(bodies[0]?.entities, [{ type: 'bold', offset: 6, length: 5 }]);
  assert.deepEqual(bodies[0]?.reply_markup, { inline_keyboard: [[{ text: 'View', url: 'https://x.test/a' }]] });
  assert.equal(bodies[1]?.text, 'Local\n\nhttp://localhost/a');
  assert.equal(bodies[1]?.reply_markup, undefined);
});

test('a manual post is reminded once', async () => {
  const store = fresh();
  const sent: string[] = [];
  const deps = { store, now, channels, notify: async (message: { text: string }) => void sent.push(message.text) };

  assert.deepEqual(await remind([post('f/a.md')], deps), [{ id: 'f/a.md', status: 'reminded' }]);
  assert.deepEqual(await remind([post('f/a.md')], deps), []);
  assert.equal(sent.length, 2);
  assert.equal((await store.get('f/a.md'))?.status, 'reminded');
});

test('only planned manual posts within the window are reminded', async () => {
  const sent: string[] = [];
  const results = await remind(
    [
      post('f/draft.md', { status: 'draft' }),
      post('f/auto.md', { manual: false }),
      post('f/future.md', { date: new Date(now.getTime() + 60_000) }),
      post('f/old.md', { date: minutesAgo(25 * 60) }),
      post('f/ok.md', { date: minutesAgo(23 * 60) })
    ],
    { store: fresh(), now, channels, notify: async (message) => void sent.push(message.text) }
  );
  assert.deepEqual(
    results.map((r) => r.id),
    ['f/ok.md']
  );
});

test('a failed send leaves no state so the next run tries again', async () => {
  const store = fresh();
  let fail = true;
  const deps = {
    store,
    now,
    channels,
    notify: async () => {
      if (fail) throw new Error('Telegram request failed');
    }
  };
  assert.deepEqual(await remind([post('f/a.md')], deps), [{ id: 'f/a.md', status: 'error', message: 'Telegram request failed' }]);
  assert.equal(await store.get('f/a.md'), null);
  fail = false;
  assert.deepEqual(await remind([post('f/a.md')], deps), [{ id: 'f/a.md', status: 'reminded' }]);
});

test('a second message that fails does not repeat the first one', async () => {
  const store = fresh();
  const sent: string[] = [];
  const deps = {
    store,
    now,
    channels,
    notify: async (message: { text: string }) => {
      if (sent.length > 0) throw new Error('Telegram request failed');
      sent.push(message.text);
    }
  };
  assert.equal((await remind([post('f/a.md')], deps))[0]?.status, 'error');
  assert.deepEqual(await remind([post('f/a.md')], deps), []);
  assert.equal(sent.length, 1);
});

test('a dry run previews the message and changes nothing', async () => {
  const store = fresh();
  let sent = 0;
  const [result] = await remind([post('f/a.md')], {
    store,
    now,
    channels,
    dryRun: true,
    notify: async () => void (sent += 1)
  });
  assert.equal(result?.status, 'would-remind');
  assert.match(result?.message ?? '', /^Time to post on Pop-Up City's Instagram \(story\):/);
  assert.equal(sent, 0);
  assert.equal(await store.get('f/a.md'), null);
});

test('telegram posts to the bot api and never leaks the token in errors', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const ok = telegram('SECRET', '42', (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch);
  await ok({ text: 'hello' });
  assert.equal(calls[0]?.url, 'https://api.telegram.org/botSECRET/sendMessage');
  assert.deepEqual(calls[0]?.body, { chat_id: '42', text: 'hello', disable_web_page_preview: true });

  const refused = telegram('SECRET', '42', (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch);
  await assert.rejects(refused({ text: 'x' }), (err: Error) => err.message === 'Telegram sendMessage failed (401)');

  const down = telegram('SECRET', '42', (async () => {
    throw new TypeError('fetch failed: https://api.telegram.org/botSECRET/sendMessage');
  }) as unknown as typeof fetch);
  await assert.rejects(down({ text: 'x' }), (err: Error) => !err.message.includes('SECRET'));
});
