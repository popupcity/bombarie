import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { announce, report } from './notify.ts';
import { claim, complete, fileStore, rearm } from './state.ts';
import { runNow } from './run.ts';
import type { Message } from './telegram.ts';
import type { Post } from './types.ts';

const now = new Date('2026-11-20T09:00:00Z');
const channels = { 'jeroen-linkedin': { platform: 'linkedin' as const, name: 'Jeroen' } };
const post = (id: string, minutesAgo = 1, over: Partial<Post> = {}): Post => ({ id, channel: 'jeroen-linkedin', type: null, status: 'planned', manual: false, date: new Date(now.getTime() - minutesAgo * 60_000), images: [], mentions: {}, text: 'x', title: 'Opening', ...over });

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'social-notify-'));
  const sent: Message[] = [];
  return { sent, deps: { root, store: fileStore(root), channels, now, base: 'https://x.test', notify: async (message: Message) => void sent.push(message) } };
}

test('a posted post links to the platform and carries the warning and the picture', async () => {
  const { sent, deps } = setup();
  await claim(deps.store, 'f/jeroen-linkedin.md', now);
  await complete(deps.store, 'f/jeroen-linkedin.md', 'r1', 'https://platform.test/p', now);
  const photo = new Uint8Array([1]);
  await report([post('f/jeroen-linkedin.md')], [{ id: 'f/jeroen-linkedin.md', status: 'posted', message: 'Posted, but reply 1 of 1 failed' }], { ...deps, photo: async () => photo });
  assert.deepEqual(sent, [{ text: "Posted as Jeroen on LinkedIn: Opening\nPosted, but reply 1 of 1 failed", bold: 'Opening', view: 'https://platform.test/p', photo }]);
});

test('failures link to the post here, and outcomes that will be tried again say nothing', async () => {
  const { sent, deps } = setup();
  const posts = ['a', 'b', 'c', 'd'].map((name) => post(`${name}/jeroen-linkedin.md`));
  await report(posts, [
    { id: posts[0]!.id, status: 'failed', message: 'no' },
    { id: posts[1]!.id, status: 'unconfirmed', message: 'timeout' },
    { id: posts[2]!.id, status: 'retry', message: 'later' },
    { id: posts[3]!.id, status: 'skipped', message: 'already claimed' }
  ], deps);
  assert.deepEqual(sent.map((message) => message.text.split('\n')[0]), ['Not posted as Jeroen on LinkedIn: Opening', 'Check whether this was posted as Jeroen on LinkedIn: Opening']);
  assert.equal(sent[0]?.view, 'https://x.test/posts/a/jeroen-linkedin');
});

test('an announcement after Post now says only how that post went', async () => {
  const { sent, deps } = setup();
  const posts = [post('a/jeroen-linkedin.md'), post('b/jeroen-linkedin.md', 90)];
  await announce(posts, [{ id: posts[0]!.id, status: 'failed', message: 'no' }], deps);
  assert.deepEqual(sent.map((message) => message.text.split(' as ')[0]), ['Not posted']);
});

test('a late post is told once, again after a new date, and not when it is old', async () => {
  const { sent, deps } = setup();
  const late = post('a/jeroen-linkedin.md', 90);
  const old = post('b/jeroen-linkedin.md', 48 * 60);
  await report([late, old], [], deps);
  await report([late, old], [], deps);
  assert.equal(sent.length, 1);
  assert.match(sent[0]!.text, /^Not posted as Jeroen on LinkedIn: Opening\nSkipped, more than an hour late\.$/);
  const moved = { ...late, date: new Date(now.getTime() + 60_000) };
  await rearm(deps.store, moved.id, moved);
  await report([moved], [], { ...deps, now: new Date(moved.date.getTime() + 90 * 60_000) });
  assert.equal(sent.length, 2);
});

test('a failed message is reported back and a late post is tried again', async () => {
  const { deps } = setup();
  const late = post('a/jeroen-linkedin.md', 90);
  assert.deepEqual(await report([late], [], { ...deps, notify: async () => Promise.reject(new Error('Telegram request failed')) }), ['Telegram request failed']);
  const sent: Message[] = [];
  await report([late], [], { ...deps, notify: async (message) => void sent.push(message) });
  assert.equal(sent.length, 1);
});

test('a late post that was told can still be posted by hand', async () => {
  const { deps } = setup();
  const late = post('a/jeroen-linkedin.md', 90);
  await report([late], [], deps);
  assert.equal((await deps.store.get(late.id))?.status, 'skipped');
  let sentOut = 0;
  const outcome = await runNow(late, {
    store: deps.store,
    channels,
    now,
    providers: { linkedin: { platform: 'linkedin', validate: () => [], send: async () => ({ id: 'r', url: 'https://platform.test/r', sent: (sentOut += 1) }) } },
    credentials: async () => ({ accessToken: 't' }),
    context: () => ({}) as never
  } as never);
  assert.deepEqual([outcome.status, sentOut, (await deps.store.get(late.id))?.status], ['posted', 1, 'posted']);
});
