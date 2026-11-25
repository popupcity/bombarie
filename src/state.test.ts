import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { attention, checkpoint, claim, complete, fail, fileStore, unstarted } from './state.ts';
import type { Post } from './types.ts';

const now = new Date('2026-11-20T09:00:00Z');
const later = (ms: number) => new Date(now.getTime() + ms);
const fresh = () => fileStore(mkdtempSync(join(tmpdir(), 'social-state-')));

function post(id: string): Post {
  return {
    id,
    channel: 'a',
    type: null,
    status: 'planned',
    manual: false,
    date: now,
    images: [],
    mentions: {},
    text: 'x'
  };
}

test('only one of many concurrent claims wins', async () => {
  const store = fresh();
  const results = await Promise.all(Array.from({ length: 20 }, () => claim(store, 'f/a.md', now)));
  assert.equal(results.filter(Boolean).length, 1);
});

test('claim, checkpoint and complete leave a posted state', async () => {
  const store = fresh();
  assert.equal(await claim(store, 'f/a.md', now), true);
  await checkpoint(store, 'f/a.md', 'urn:li:share:1');
  assert.deepEqual(await store.get('f/a.md'), {
    status: 'posting',
    at: now.toISOString(),
    remoteId: 'urn:li:share:1'
  });
  await complete(store, 'f/a.md', 'urn:li:share:1', 'https://example.com/p', later(1000));
  assert.deepEqual(await store.get('f/a.md'), {
    status: 'posted',
    at: later(1000).toISOString(),
    remoteId: 'urn:li:share:1',
    url: 'https://example.com/p'
  });
  assert.equal(await claim(store, 'f/a.md', later(2000)), false);
});

test('transitions are refused unless the post is posting', async () => {
  const store = fresh();
  await assert.rejects(complete(store, 'f/a.md', '1', undefined, now), /no state/);
  await claim(store, 'f/a.md', now);
  await complete(store, 'f/a.md', '1', undefined, now);
  await assert.rejects(fail(store, 'f/a.md', 'boom', now), /found posted/);
});

test('failed and unconfirmed block a new claim and are reported', async () => {
  const store = fresh();
  await claim(store, 'f/failed.md', now);
  await fail(store, 'f/failed.md', 'invalid image', now);
  await claim(store, 'f/maybe.md', now);
  await checkpoint(store, 'f/maybe.md', 'rid');
  await fail(store, 'f/maybe.md', 'timeout', now, true);

  assert.equal(await claim(store, 'f/failed.md', later(1000)), false);
  assert.equal(await claim(store, 'f/maybe.md', later(1000)), false);

  const found = await attention(store, ['f/failed.md', 'f/maybe.md', 'f/none.md'], now);
  assert.deepEqual(
    found.map((a) => [a.id, a.status]),
    [
      ['f/failed.md', 'failed'],
      ['f/maybe.md', 'unconfirmed']
    ]
  );
  assert.match(found[1]!.message, /remote id rid/);
});

test('a posting state is reported only once it is stale', async () => {
  const store = fresh();
  await claim(store, 'f/a.md', now);
  assert.deepEqual(await attention(store, ['f/a.md'], later(9 * 60_000)), []);
  const found = await attention(store, ['f/a.md'], later(11 * 60_000));
  assert.equal(found[0]?.status, 'posting');
});

test('unstarted drops posts that already have a state', async () => {
  const store = fresh();
  await claim(store, 'f/a.md', now);
  const left = await unstarted(store, [post('f/a.md'), post('f/b.md')]);
  assert.deepEqual(
    left.map((p) => p.id),
    ['f/b.md']
  );
});

test('ids that escape the state directory are refused', async () => {
  const store = fresh();
  await assert.rejects(store.get('../x.md'), /invalid id/);
  await assert.rejects(store.create('/abs.md', { status: 'posting', at: 'x' }), /invalid id/);
});

test('the name that started a post travels from the claim to the posted state', async () => {
  const store = fresh();
  await claim(store, 'f/a.md', new Date('2026-11-24T10:00:00Z'), 'anna');
  await complete(store, 'f/a.md', 'r1', undefined, new Date('2026-11-24T10:01:00Z'));
  assert.equal((await store.get('f/a.md') as { by?: string }).by, 'anna');
});
