import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fromCsv, toCsv } from './csv.ts';
import { collectFacebook, collectInstagram, collectTags, collectStats, collectStories, collectThreads, readStats, statsFile, writeStats } from './stats.ts';

const fresh = () => mkdtempSync(join(tmpdir(), 'social-stats-'));
const credentials = { accessToken: 'tok', accountId: '178' };
const credentials99 = { accessToken: 'tok', accountId: '99' };

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
  assert.equal((await run(failing, '2026-11-27T08:00:00Z')).length, 2);
  await run(failing, '2026-11-27T08:30:00Z');
  assert.equal(calls, 2);
  const good = threads(895);
  assert.deepEqual(await run(good.fetchImpl, '2026-11-27T09:01:00Z'), []);
  const asked = good.asked.length;
  await run(good.fetchImpl, '2026-11-27T20:00:00Z');
  assert.equal(good.asked.length, asked);
});

function instagram(options: { limitAfter?: number; stories?: boolean; refuses?: boolean } = {}) {
  const asked: string[] = [];
  let numbered = 0;
  const fetchImpl = (async (url: string) => {
    const { pathname, searchParams } = new URL(url);
    const path = pathname.replace('/v23.0/', '');
    const metric = searchParams.get('metric') ?? '';
    asked.push(`${path} ${metric}`.trim());
    const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (path === '99') return answer({ followers_count: 6373 });
    if (path === '99/insights') {
      if (searchParams.get('breakdown') === 'follow_type') return answer({ data: [{ name: 'reach', total_value: { breakdowns: [{ results: [{ dimension_values: ['FOLLOWER'], value: 50 }, { dimension_values: ['NON_FOLLOWER'], value: 30 }] }] } }] });
      if (metric === 'views') return answer({ data: [{ name: 'views', total_value: { value: 19 } }] });
      return answer({ data: [{ name: metric, values: [{ value: metric === 'reach' ? 156 : 2, end_time: '2026-11-27T08:00:00+0000' }] }] });
    }
    if (path === '99/media') return answer({ data: [1, 2, 3].map((n) => ({ id: `m${n}`, timestamp: `2026-11-2${n}T10:00:00+0000`, permalink: `https://i.test/${n}`, media_type: 'VIDEO', media_product_type: n === 3 ? 'REELS' : 'FEED', caption: `Post ${n}\nmore`, like_count: n, comments_count: 0 })) });
    if (path === '99/stories') return answer({ data: options.stories === false ? [] : [{ id: 's1', timestamp: '2026-11-27T09:00:00+0000', permalink: 'https://i.test/s1', media_type: 'IMAGE' }] });
    numbered += 1;
    if (options.limitAfter !== undefined && numbered > options.limitAfter) return answer({ error: { message: 'limit', code: 4 } }, 400);
    if (path === 'm1/insights') return answer({ error: { message: 'Invalid parameter', code: 100 } }, 400);
    if (path === 'm2/insights' && options.refuses && metric.includes('follows')) return answer({ error: { message: '(#100) The Media Insights API does not support the follows, profile_visits metric for this media product type.', code: 100 } }, 400);
    const followed = metric.includes('follows') ? [{ name: 'follows', values: [{ value: 4 }] }, { name: 'profile_visits', values: [{ value: 25 }] }] : [];
    return answer({ data: [{ name: 'views', values: [{ value: 330 }] }, { name: 'total_interactions', values: [{ value: 10 }] }, { name: 'replies', values: [{ value: 0 }] }, ...followed] });
  }) as unknown as typeof fetch;
  return { asked, fetchImpl };
}

test('Instagram keeps followers, reach and views per day, and gets post numbers in batches, newest first', async () => {
  const root = fresh();
  const now = new Date('2026-11-27T12:00:00Z');
  const first = instagram();
  assert.equal(await collectInstagram(root, 'ig', credentials99, first.fetchImpl, now, 2), 1);
  assert.equal(readFileSync(statsFile(root, 'ig', 'days'), 'utf8'), 'date,followers,new_followers,views,reach,reach_followers,reach_others\n2026-11-27,6373,2,19,156,50,30\n');
  assert.deepEqual(readStats(root, 'ig', 'posts').map((row) => [row.url, row.type, row.text, row.likes, row.views, row.interactions, row.updated]), [
    ['https://i.test/1', 'VIDEO', 'Post 1', '1', '', '', ''],
    ['https://i.test/2', 'VIDEO', 'Post 2', '2', '330', '10', '2026-11-27'],
    ['https://i.test/3', 'REEL', 'Post 3', '3', '330', '10', '2026-11-27']
  ]);
  assert.equal(await collectInstagram(root, 'ig', credentials99, instagram().fetchImpl, now, 2), 0);
  assert.deepEqual(readStats(root, 'ig', 'posts').map((row) => row.updated), ['2026-11-27', '2026-11-27', '2026-11-27']);
});

test('new followers and profile visits come with a post, not with a reel, and a type that refuses them keeps its other numbers', async () => {
  const now = new Date('2026-11-27T12:00:00Z');
  const read = async (refuses: boolean) => {
    const root = fresh();
    const fake = instagram({ refuses });
    await collectInstagram(root, 'ig', credentials99, fake.fetchImpl, now);
    return { rows: readStats(root, 'ig', 'posts').map((row) => [row.type, row.views, row.follows, row.profile_visits]), asked: fake.asked };
  };
  const given = await read(false);
  assert.deepEqual(given.rows.slice(1), [['VIDEO', '330', '4', '25'], ['REEL', '330', '', '']]);
  assert.equal(given.asked.some((line) => line.startsWith('m3/insights') && line.includes('follows')), false);
  assert.deepEqual((await read(true)).rows[1], ['VIDEO', '330', '', '']);
});

test('a rate limit stops the batch and keeps what already came in', async () => {
  const root = fresh();
  await assert.rejects(collectInstagram(root, 'ig', credentials99, instagram({ limitAfter: 1 }).fetchImpl, new Date('2026-11-27T12:00:00Z')), /limit|rate/i);
  assert.deepEqual(readStats(root, 'ig', 'posts').map((row) => row.updated), ['', '', '2026-11-27']);
});

test('stories are kept after they leave Instagram', async () => {
  const root = fresh();
  await collectStories(root, 'ig', credentials99, instagram().fetchImpl, new Date('2026-11-27T12:00:00Z'));
  await collectStories(root, 'ig', credentials99, instagram({ stories: false }).fetchImpl, new Date('2026-11-29T12:00:00Z'));
  assert.deepEqual(readStats(root, 'ig', 'stories').map((row) => [row.url, row.views, row.replies, row.updated]), [['https://i.test/s1', '330', '0', '2026-11-27T12:00:00.000Z']]);
});

test('a missing permission is a problem, not a row of empty numbers', async () => {
  const root = fresh();
  const denied = (async (url: string) => (new URL(url).pathname.endsWith('/insights') ? new Response('{"error":{"message":"(#10) Application does not have permission for this action","code":10}}', { status: 400 }) : instagram().fetchImpl(url))) as unknown as typeof fetch;
  await assert.rejects(collectInstagram(root, 'ig', credentials99, denied, new Date('2026-11-27T12:00:00Z')), /permission/);
  assert.equal(readStats(root, 'ig', 'days')[0]?.followers, '6373');
});

test('the views of one day are asked with a window that holds only that day', async () => {
  const windows: number[] = [];
  const base = instagram();
  const spy = (async (url: string) => {
    const query = new URL(url).searchParams;
    if (query.get('metric') === 'views' && query.get('metric_type') === 'total_value') windows.push(Number(query.get('until')) - Number(query.get('since')));
    return base.fetchImpl(url);
  }) as unknown as typeof fetch;
  await collectInstagram(fresh(), 'ig', credentials99, spy, new Date('2026-11-27T12:00:00Z'));
  assert.deepEqual(windows, [23 * 3600]);
});

test('Facebook counts a value for the day that ends at its end time, and keeps posts under the address Bombarie gives them', async () => {
  const root = fresh();
  const fake = (async (url: string) => {
    const { pathname, searchParams } = new URL(url);
    const path = pathname.replace('/v23.0/', '');
    const answer = (body: unknown) => new Response(JSON.stringify(body));
    if (path === '99') return answer({ followers_count: 52616 });
    if (path === '99/insights') return answer({ data: [{ name: 'page_follows', values: [{ value: 52620, end_time: '2026-11-26T08:00:00+0000' }] }, { name: 'page_media_view', values: [{ value: 8, end_time: '2026-11-26T08:00:00+0000' }] }] });
    if (path === '99/published_posts') {
      assert.match(searchParams.get('fields') ?? '', /reactions\.summary/);
      return answer({ data: [{ id: '99_1', created_time: '2026-11-20T10:00:00+0000', message: 'Hello\nmore', reactions: { summary: { total_count: 4 } }, comments: { summary: { total_count: 2 } }, attachments: { data: [{ media_type: 'album' }] } }] });
    }
    return answer({ data: [{ name: 'post_media_view', values: [{ value: 629 }] }, { name: 'post_total_media_view_unique', period: 'lifetime', values: [{ value: 489 }] }, { name: 'post_clicks', values: [{ value: 2 }] }, { name: 'post_total_media_view_unique', period: 'day', values: [{ value: 0 }] }] });
  }) as unknown as typeof fetch;
  assert.equal(await collectFacebook(root, 'fb', credentials99, fake, new Date('2026-11-27T12:00:00Z')), 0);
  assert.equal(readFileSync(statsFile(root, 'fb', 'days'), 'utf8'), 'date,followers,new_followers,views,reach\n2026-11-25,52620,,8,\n2026-11-27,52616,,,\n');
  assert.deepEqual(readStats(root, 'fb', 'posts').map((row) => [row.url, row.type, row.text, row.views, row.reach, row.likes, row.comments, row.shares, row.clicks]), [['https://www.facebook.com/99_1', 'CAROUSEL_ALBUM', 'Hello', '629', '489', '4', '2', '0', '2']]);
});

test('a first run that stops halfway fills the history in the next one', async () => {
  const root = fresh();
  const now = new Date('2026-11-27T12:00:00Z');
  const stopped = (async (url: string) => (new URL(url).pathname.endsWith('/insights') ? new Response('{"error":{"message":"limit","code":4}}', { status: 400 }) : instagram().fetchImpl(url))) as unknown as typeof fetch;
  await assert.rejects(collectInstagram(root, 'ig', credentials99, stopped, now), /limit|rate/i);
  assert.equal(readStats(root, 'ig', 'days')[0]?.followers, '6373');
  const windows: string[] = [];
  const base = instagram();
  const spy = (async (url: string) => {
    const query = new URL(url).searchParams;
    if (query.get('metric') === 'reach' && query.get('period') === 'day' && !query.has('metric_type')) windows.push(query.get('since')!);
    return base.fetchImpl(url);
  }) as unknown as typeof fetch;
  await collectInstagram(root, 'ig', credentials99, spy, now);
  assert.equal(windows.length, 3);
});

test('an answer without any post leaves the posts on file as they are', async () => {
  const root = fresh();
  const now = new Date('2026-11-27T12:00:00Z');
  await collectInstagram(root, 'ig', credentials99, instagram().fetchImpl, now);
  const kept = readFileSync(statsFile(root, 'ig', 'posts'), 'utf8');
  const empty = (async (url: string) => (new URL(url).pathname.endsWith('/media') ? new Response('{"data":[]}') : instagram().fetchImpl(url))) as unknown as typeof fetch;
  await collectInstagram(root, 'ig', credentials99, empty, new Date('2026-11-28T12:00:00Z'));
  assert.equal(readFileSync(statsFile(root, 'ig', 'posts'), 'utf8'), kept);
});

test('who tags a channel is kept by address, also after the platform lists it no more', async () => {
  const root = fresh();
  const tagged = (data: unknown[]) => (async () => new Response(JSON.stringify({ data }))) as unknown as typeof fetch;
  await collectTags('instagram', root, 'ig', credentials99, tagged([{ id: '1', timestamp: '2026-11-20T10:00:00+0000', permalink: 'https://i.test/a', username: 'friend' }]));
  await collectTags('instagram', root, 'ig', credentials99, tagged([{ id: '2', timestamp: '2026-11-24T10:00:00+0000', permalink: 'https://i.test/b', username: 'other' }]));
  await collectTags('facebook', root, 'fb', credentials99, tagged([{ id: '3', created_time: '2026-11-01T10:00:00+0000', permalink_url: 'https://f.test/c', from: { name: 'A Page' } }]));
  await collectTags('facebook', root, 'none', credentials99, tagged([]));
  assert.deepEqual(readStats(root, 'ig', 'tags').map((row) => [row.url, row.by]), [['https://i.test/a', 'friend'], ['https://i.test/b', 'other']]);
  assert.deepEqual(readStats(root, 'fb', 'tags').map((row) => [row.date, row.by]), [['2026-11-01T10:00:00+0000', 'A Page']]);
  assert.deepEqual(readStats(root, 'none', 'tags'), []);
});

test('days kept before the split of reach was asked get it for the last 30 days, not only the last few', async () => {
  const root = fresh();
  await writeStats(statsFile(root, 'ig', 'days'), ['date', 'followers', 'views', 'reach'], [{ date: '2026-11-20', followers: '1', views: '2', reach: '3' }]);
  const windows: string[] = [];
  const base = instagram();
  const spy = (async (url: string) => {
    const query = new URL(url).searchParams;
    if (query.get('metric') === 'reach' && !query.has('metric_type')) windows.push(query.get('since')!);
    return base.fetchImpl(url);
  }) as unknown as typeof fetch;
  await collectInstagram(root, 'ig', credentials99, spy, new Date('2026-11-27T12:00:00Z'));
  await collectInstagram(root, 'ig', credentials99, spy, new Date('2026-11-28T12:00:00Z'));
  assert.equal(windows.length, 4);
});
