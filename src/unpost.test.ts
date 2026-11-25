import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { facebook } from './facebook.ts';
import { instagram } from './instagram.ts';
import { linkedin } from './linkedin.ts';
import { fileStore } from './state.ts';
import { canUnpost, unpost } from './unpost.ts';

const channels = { jeroen: { platform: 'linkedin', kind: 'person', urn: 'urn:li:person:a' }, page: { platform: 'facebook', page: '1' }, ig: { platform: 'instagram' } } as never;
const providers = { linkedin, facebook, instagram };
const credentials = async () => ({ accessToken: 'tok' });

function setup(status: number, body = '') {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(status === 204 ? null : body, { status });
  }) as unknown as typeof fetch;
  const store = fileStore(mkdtempSync(join(tmpdir(), 'unpost-')));
  return { calls, store, deps: { store, channels, providers, credentials, fetch: fetchImpl, now: new Date('2026-11-19T12:00:00Z') } };
}

test('only LinkedIn and Facebook can delete', () => {
  assert.equal(canUnpost(providers, 'linkedin'), true);
  assert.equal(canUnpost(providers, 'facebook'), true);
  assert.equal(canUnpost(providers, 'instagram'), false);
});

test('a posted LinkedIn post is deleted and the state becomes deleted', async () => {
  const { calls, store, deps } = setup(204);
  await store.create('f/jeroen.md', { status: 'posted', at: 'x', remoteId: 'urn:li:share:1', url: 'https://x' });
  await unpost('f/jeroen.md', 'jeroen', deps);
  assert.equal(calls[0]!.init.method, 'DELETE');
  assert.equal(calls[0]!.url, 'https://api.linkedin.com/rest/posts/urn%3Ali%3Ashare%3A1');
  assert.deepEqual(await store.get('f/jeroen.md'), { status: 'deleted', at: '2026-11-19T12:00:00.000Z', remoteId: 'urn:li:share:1', url: 'https://x' });
});

test('a post LinkedIn no longer has counts as deleted', async () => {
  const { store, deps } = setup(404, 'not found');
  await store.create('f/jeroen.md', { status: 'posted', at: 'x', remoteId: 'urn:li:share:1' });
  await unpost('f/jeroen.md', 'jeroen', deps);
  assert.equal((await store.get('f/jeroen.md'))?.status, 'deleted');
});

test('a Facebook post is deleted with a DELETE on its id', async () => {
  const { calls, store, deps } = setup(200, '{"success":true}');
  await store.create('f/page.md', { status: 'posted', at: 'x', remoteId: '1_2' });
  await unpost('f/page.md', 'page', deps);
  assert.equal(calls[0]!.init.method, 'DELETE');
  assert.match(calls[0]!.url, /graph\.facebook\.com\/v23\.0\/1_2\?access_token=tok$/);
});

test('a failure keeps the post posted; unposted, Instagram and unknown posts are refused', async () => {
  const { store, deps } = setup(403, 'no');
  await store.create('f/jeroen.md', { status: 'posted', at: 'x', remoteId: 'urn:li:share:1' });
  await assert.rejects(unpost('f/jeroen.md', 'jeroen', deps), /connect the channel again/);
  assert.equal((await store.get('f/jeroen.md'))?.status, 'posted');
  await assert.rejects(unpost('f/none.md', 'jeroen', deps), /only a posted post/);
  await store.create('f/ig.md', { status: 'posted', at: 'x', remoteId: '9' });
  await assert.rejects(unpost('f/ig.md', 'ig', deps), /cannot delete/);
});
