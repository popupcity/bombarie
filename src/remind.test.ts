import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileStore } from './state.ts';
import { remind, reminderText, telegram } from './remind.ts';
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

test('reminderText names the post, the time, the text and the link', () => {
  assert.equal(
    reminderText(post('f/a.md')),
    'Post now: popupcity-instagram (story)\n2026-11-20 09:55\n\nStory met link\n\nLink: https://popupcity.net'
  );
  assert.equal(
    reminderText(post('f/a.md', { type: null, link: undefined as never, text: 'x'.repeat(1200) }))
      .split('\n')
      .at(-1),
    `${'x'.repeat(1000)}…`
  );
});

test('a manual post is reminded once', async () => {
  const store = fresh();
  const sent: string[] = [];
  const deps = { store, now, notify: async (t: string) => void sent.push(t) };

  assert.deepEqual(await remind([post('f/a.md')], deps), [{ id: 'f/a.md', status: 'reminded' }]);
  assert.deepEqual(await remind([post('f/a.md')], deps), []);
  assert.equal(sent.length, 1);
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
    { store: fresh(), now, notify: async (t) => void sent.push(t) }
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
    notify: async () => {
      if (fail) throw new Error('Telegram request failed');
    }
  };
  assert.deepEqual(await remind([post('f/a.md')], deps), [{ id: 'f/a.md', status: 'error', message: 'Telegram request failed' }]);
  assert.equal(await store.get('f/a.md'), null);
  fail = false;
  assert.deepEqual(await remind([post('f/a.md')], deps), [{ id: 'f/a.md', status: 'reminded' }]);
});

test('a dry run previews the message and changes nothing', async () => {
  const store = fresh();
  let sent = 0;
  const [result] = await remind([post('f/a.md')], {
    store,
    now,
    dryRun: true,
    notify: async () => void (sent += 1)
  });
  assert.equal(result?.status, 'would-remind');
  assert.match(result?.message ?? '', /^Post now: popupcity-instagram \(story\)/);
  assert.equal(sent, 0);
  assert.equal(await store.get('f/a.md'), null);
});

test('telegram posts to the bot api and never leaks the token in errors', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const ok = telegram('SECRET', '42', (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch);
  await ok('hello');
  assert.equal(calls[0]?.url, 'https://api.telegram.org/botSECRET/sendMessage');
  assert.deepEqual(calls[0]?.body, { chat_id: '42', text: 'hello', disable_web_page_preview: true });

  const refused = telegram('SECRET', '42', (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch);
  await assert.rejects(refused('x'), (err: Error) => err.message === 'Telegram sendMessage failed (401)');

  const down = telegram('SECRET', '42', (async () => {
    throw new TypeError('fetch failed: https://api.telegram.org/botSECRET/sendMessage');
  }) as unknown as typeof fetch);
  await assert.rejects(down('x'), (err: Error) => !err.message.includes('SECRET'));
});
