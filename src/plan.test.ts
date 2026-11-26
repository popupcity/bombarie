import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dateLabel, due, postsNow, readiness } from './plan.ts';
import type { Readiness } from './plan.ts';
import type { Post } from './types.ts';

function post(id: string, date: string, over: Partial<Post> = {}): Post {
  return {
    id,
    channel: 'a',
    type: null,
    status: 'planned',
    manual: false,
    date: new Date(date),
    images: [],
    mentions: {},
    text: 'x',
    ...over
  };
}

const ids = (posts: Post[]) => posts.map((p) => p.id);

test('due splits planned, non-manual posts into ready and late', () => {
  const now = new Date('2026-11-20T09:00:00Z');
  const { ready, late } = due(
    [
      post('recent', '2026-11-20T08:30:00Z'),
      post('exact', '2026-11-20T09:00:00Z'),
      post('edge', '2026-11-20T08:00:00Z'),
      post('late', '2026-11-20T07:59:59Z'),
      post('future', '2026-11-20T09:00:01Z'),
      post('draft', '2026-11-20T08:30:00Z', { status: 'draft' }),
      post('manual', '2026-11-20T08:30:00Z', { manual: true })
    ],
    now
  );
  assert.deepEqual(ids(ready), ['recent', 'exact', 'edge']);
  assert.deepEqual(ids(late), ['late']);
});

const now = new Date('2026-11-18T10:00:00+01:00');
const text = (length: number, limit?: number, kind: 'text' | 'unknown' = 'text') => ({
  length,
  ...(limit !== undefined && { limit }),
  segments: [{ kind, text: 'x'.repeat(length) }]
});
const ok: Readiness = { manual: false, date: '2026-11-20T10:00', images: 0, preview: text(12, 3000), connection: null, now };

test('a complete post is ready', () => {
  assert.equal(readiness(ok), null);
});

test('the first thing that is missing is named, in plain words', () => {
  assert.equal(readiness({ ...ok, date: '' }), 'Pick a date and time.');
  assert.equal(readiness({ ...ok, date: '2026-11-18T08:00' }), 'Pick a time in the future.');
  assert.equal(readiness({ ...ok, preview: text(0) }), 'Add text or media first.');
  assert.equal(readiness({ ...ok, preview: text(0), images: 1 }), null);
  assert.equal(readiness({ ...ok, preview: text(3001, 3000) }), 'Shorten the text by 1 character.');
  assert.equal(readiness({ ...ok, preview: text(3005, 3000) }), 'Shorten the text by 5 characters.');
  assert.match(readiness({ ...ok, preview: text(5, 3000, 'unknown') }) ?? '', /no entity yet/);
  assert.match(readiness({ ...ok, connection: 'posting to Instagram is not built yet' }) ?? '', /^Posting to Instagram is not built yet\. Set Posting to Manual, or connect/);
});

test('a date within the last hour is still fine, and a reminder only needs a date', () => {
  assert.equal(readiness({ ...ok, date: '2026-11-18T09:30' }), null);
  assert.equal(readiness({ ...ok, manual: true, preview: text(0), date: '2026-11-18T08:00', connection: 'x' }), null);
  assert.equal(readiness({ ...ok, manual: true, date: '' }), 'Pick a date and time.');
});

test('a draft with a date that has come posts now; a future date is planned', () => {
  const now = new Date('2026-11-20T09:00:00Z');
  const base = { manual: false, connected: true, now };
  assert.equal(postsNow({ ...base, date: '2026-11-20T10:00' }), true);
  assert.equal(postsNow({ ...base, date: '2026-11-18T10:00' }), true);
  assert.equal(postsNow({ ...base, date: '2026-11-20T10:01' }), false);
  assert.equal(postsNow({ ...base, date: '' }), false);
  assert.equal(postsNow({ ...base, date: '2026-11-18T10:00', manual: true }), false);
  assert.equal(postsNow({ ...base, date: '2026-11-18T10:00', connected: false }), false);
});

test('a draft that posts now shows Now as its date, a planned one its time', () => {
  const now = new Date('2026-11-20T09:00:00Z');
  assert.equal(dateLabel('2026-11-18T10:00', false, now), 'Now');
  assert.notEqual(dateLabel('2026-11-18T10:00', true, now), 'Now');
  assert.notEqual(dateLabel('2026-11-25T10:00', false, now), 'Now');
});
