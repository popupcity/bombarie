import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { instagram } from './instagram.ts';
import { linkedin } from './linkedin.ts';
import { canReply, canRemoveReply, postReplies, removeReply } from './reply.ts';
import { fileStore } from './state.ts';

const channels = { jeroen: { platform: 'linkedin', kind: 'person', urn: 'urn:li:person:a' }, ig: { platform: 'instagram' } } as never;
const providers = { linkedin, instagram };
const credentials = async () => ({ accessToken: 'tok' });

function setup(status = 201) {
  const calls: { url: string; method: string; body: Record<string, any> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : {} });
    return new Response(status === 201 ? null : '{"message":"no"}', { status, headers: { 'x-restli-id': 'urn:li:comment:1' } });
  }) as unknown as typeof fetch;
  const store = fileStore(mkdtempSync(join(tmpdir(), 'reply-')));
  return { calls, store, deps: { store, channels, providers, credentials, fetch: fetchImpl, now: new Date('2026-11-25T12:00:00Z') } };
}

test('only LinkedIn and Threads providers take comments later', () => {
  assert.equal(canReply(providers, 'linkedin'), true);
  assert.equal(canReply(providers, 'instagram'), false);
});

test('only the comments not sent yet go out, and the count is kept', async () => {
  const { calls, store, deps } = setup();
  await store.create('f/jeroen.md', { status: 'posted', at: 'x', remoteId: 'urn:li:share:7', replies: { count: 1 } });
  const result = await postReplies('f/jeroen.md', 'jeroen', ['Sent before.', 'New one.'], deps);
  assert.deepEqual(result, { sent: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.body.message.text, 'New one.');
  const state = await store.get('f/jeroen.md');
  assert.deepEqual(state?.status === 'posted' ? state.replies : null, { count: 2, ids: ['', 'urn:li:comment:1'] });
  assert.deepEqual(await postReplies('f/jeroen.md', 'jeroen', ['Sent before.', 'New one.'], deps), { sent: 0 });
  await assert.rejects(postReplies('f/jeroen.md', 'jeroen', ['Sent before.', 'New one.', '  '], deps), /empty/);
});

test('a refused comment is reported and the count stays', async () => {
  const { store, deps } = setup(403);
  await store.create('f/jeroen.md', { status: 'posted', at: 'x', remoteId: 'urn:li:share:7' });
  const result = await postReplies('f/jeroen.md', 'jeroen', ['Comment.'], deps);
  assert.equal(result.sent, 0);
  assert.match(result.warning ?? '', /^reply 1 of 1 failed/);
  const state = await store.get('f/jeroen.md');
  assert.deepEqual(state?.status === 'posted' ? state.replies : null, { count: 0, ids: [] });
});

test('a post marked as posted by hand, an unposted one and another platform are refused', async () => {
  const { store, deps } = setup();
  await store.create('f/hand.md', { status: 'posted', at: 'x', remoteId: 'manual' });
  await assert.rejects(postReplies('f/hand.md', 'jeroen', ['x'], deps), /by hand/);
  await assert.rejects(postReplies('f/none.md', 'jeroen', ['x'], deps), /only a posted post/);
  await store.create('f/ig.md', { status: 'posted', at: 'x', remoteId: '1' });
  await assert.rejects(postReplies('f/ig.md', 'ig', ['x'], deps), /cannot take replies/);
});

test('a posted comment can be deleted from LinkedIn and here, or only here', async () => {
  const { calls, store, deps } = setup();
  await store.create('f/jeroen.md', { status: 'posted', at: 'x', remoteId: 'urn:li:share:7', replies: { count: 3, ids: ['101', '', '103'] } });
  assert.equal(canRemoveReply(providers, 'linkedin'), true);
  await removeReply('f/jeroen.md', 'jeroen', 0, true, deps);
  assert.equal(calls[0]?.method, 'DELETE');
  assert.equal(calls[0]?.url, 'https://api.linkedin.com/v2/socialActions/urn%3Ali%3Ashare%3A7/comments/101?actor=urn%3Ali%3Aperson%3Aa');
  await assert.rejects(removeReply('f/jeroen.md', 'jeroen', 0, true, deps), /id of this reply is not known/);
  await removeReply('f/jeroen.md', 'jeroen', 0, false, deps);
  assert.equal(calls.length, 1);
  const state = await store.get('f/jeroen.md');
  assert.deepEqual(state?.status === 'posted' ? state.replies : null, { count: 1, ids: ['103'], last: '103' });
  await assert.rejects(removeReply('f/jeroen.md', 'jeroen', 5, false, deps), /not posted from here/);
});
