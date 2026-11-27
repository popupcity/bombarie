import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fromCsv, toCsv } from './csv.ts';
import { collectStats, collectThreads, readStats, statsFile } from './stats.ts';

const fresh = () => mkdtempSync(join(tmpdir(), 'social-stats-'));
const credentials = { accessToken: 'tok', accountId: '178' };

function threads(followers: number, likes: Record<string, number> = {}) {
  const asked: string[] = [];
  const fetchImpl = (async (url: string) => {
    const { pathname, searchParams } = new URL(url);
    const path = pathname.replace('/v1.0/', '');
    asked.push(`${path} ${searchParams.get('metric') ?? ''}`.trim());
    const answer = (body: unknown) => new Response(JSON.stringify(body));
    if (path === '178/threads') {
      if (!searchParams.get('after')) return answer({ data: [{ id: 'new', timestamp: '2026-11-26T10:00:00+0000', permalink: 'https://t.test/new', media_type: 'IMAGE', text: 'Fresh, "quoted"\nsecond line' }], paging: { next: 'x', cursors: { after: 'c1' } } });
      return answer({ data: [{ id: 'old', timestamp: '2024-01-05T10:00:00+0000', permalink: 'https://t.test/old', media_type: 'TEXT_POST' }, { id: 'r', timestamp: '2024-01-06T10:00:00+0000', permalink: 'https://t.test/r', media_type: 'REPOST_FACADE' }] });
    }
    if (path === '178/threads_insights') {
      if (searchParams.get('metric') === 'followers_count') return answer({ data: [{ name: 'followers_count', total_value: { value: followers } }] });
      return answer({ data: [{ name: 'views', values: [{ value: 7, end_time: '2026-11-26T08:00:00+0000' }, { value: 3, end_time: '2026-11-27T08:00:00+0000' }] }] });
    }
    return answer({ data: [{ name: 'views', values: [{ value: 10 }] }, { name: 'likes', values: [{ value: likes[path.split('/')[0]!] ?? 1 }] }] });
  }) as unknown as typeof fetch;
  return { asked, fetchImpl };
}

test('a table survives commas, quotes and line breaks', () => {
  const rows = [{ a: 'x,y', b: 'say "hi"\nagain' }, { a: '', b: 'z' }];
  assert.deepEqual(fromCsv(toCsv(['a', 'b'], rows)), rows);
});

test('followers are kept per day, views are filled per day, and every post gets its latest numbers', async () => {
  const root = fresh();
  await collectThreads(root, 'pop', credentials, threads(895).fetchImpl, new Date('2026-11-27T12:00:00Z'));
  assert.equal(readFileSync(statsFile(root, 'pop', 'days'), 'utf8'), 'date,followers,views\n2026-11-26,,7\n2026-11-27,895,3\n');
  assert.deepEqual(readStats(root, 'pop', 'posts').map((row) => [row.url, row.type, row.text, row.views, row.likes, row.updated]), [
    ['https://t.test/old', 'TEXT_POST', '', '10', '1', '2026-11-27'],
    ['https://t.test/new', 'IMAGE', 'Fresh, "quoted"', '10', '1', '2026-11-27']
  ]);
});

test('a later day adds a line, keeps what was measured, and asks old posts only once a week', async () => {
  const root = fresh();
  await collectThreads(root, 'pop', credentials, threads(895).fetchImpl, new Date('2026-11-27T12:00:00Z'));
  await collectThreads(root, 'pop', credentials, threads(999).fetchImpl, new Date('2026-11-27T18:00:00Z'));
  const next = threads(901, { new: 5, old: 9 });
  await collectThreads(root, 'pop', credentials, next.fetchImpl, new Date('2026-11-28T00:05:00Z'));
  assert.deepEqual(readStats(root, 'pop', 'days').map((row) => [row.date, row.followers]), [['2026-11-26', ''], ['2026-11-27', '895'], ['2026-11-28', '901']]);
  assert.deepEqual(readStats(root, 'pop', 'posts').map((row) => row.likes), ['1', '5']);
  assert.equal(next.asked.some((path) => path.startsWith('old/insights')), false);
});

test('collecting happens once a day, and a failure is tried again after an hour', async () => {
  const root = fresh();
  const channels = { pop: { platform: 'threads' as const }, other: { platform: 'linkedin' as const } };
  let calls = 0;
  const failing = (async () => {
    calls += 1;
    return new Response('{"error":{"message":"no"}}', { status: 400 });
  }) as unknown as typeof fetch;
  const run = (fetchImpl: typeof fetch, time: string) => collectStats(root, channels, async () => credentials, fetchImpl, new Date(time));
  assert.equal((await run(failing, '2026-11-27T08:00:00Z')).length, 1);
  await run(failing, '2026-11-27T08:30:00Z');
  assert.equal(calls, 1);
  const good = threads(895);
  assert.deepEqual(await run(good.fetchImpl, '2026-11-27T09:01:00Z'), []);
  const asked = good.asked.length;
  await run(good.fetchImpl, '2026-11-27T20:00:00Z');
  assert.equal(good.asked.length, asked);
});
