import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { placeName, sharesOf } from './audience.ts';
import { collectAudience, collectFacebookAudience, collectThreadsAudience, readStats, saveAudience } from './stats.ts';

const fresh = () => mkdtempSync(join(tmpdir(), 'social-audience-'));
const row = (date: string, kind: string, place: string, count: number) => ({ date, kind, place, count: String(count) });
const rounded = (shares: ReturnType<typeof sharesOf>) => shares.map((share) => [share.place, share.count, Math.round(share.share * 10) / 10, share.change === null ? null : Math.round(share.change * 10) / 10]);

test('shares add the channels up, start once each was measured, carry the last measurement on and tell the change', () => {
  const big = [row('2026-01-01', 'country', 'NL', 50), row('2026-01-01', 'country', 'US', 50), row('2026-11-01', 'country', 'NL', 20), row('2026-11-01', 'country', 'US', 80), row('2026-11-20', 'country', 'NL', 30), row('2026-11-20', 'country', 'US', 70)];
  const late = [row('2026-11-10', 'country', 'NL', 100)];
  assert.deepEqual(rounded(sharesOf([big, late], 'country', '')), [['NL', 130, 65, 5], ['US', 70, 35, -5]]);
  assert.deepEqual(sharesOf([big, late], 'country', '')[0]!.points.map((point) => [point.date, point.value]), [['2026-11-10', 60], ['2026-11-20', 65]]);
  assert.deepEqual(rounded(sharesOf([big], 'country', '2026-11-05')), [['US', 70, 70, -10], ['NL', 30, 30, 10]]);
});

test('one measurement has a share and no change, and a city is one place whatever its source adds after it', () => {
  const rows = [row('2026-11-27', 'city', 'Amsterdam, Netherlands', 3), row('2026-11-27', 'country', 'NL', 9)];
  const other = [row('2026-11-27', 'city', 'Amsterdam, Noord-Holland', 1), row('2026-11-27', 'city', 'London, England', 4)];
  assert.deepEqual(rounded(sharesOf([rows, other], 'city', '')), [['Amsterdam', 4, 50, null], ['London', 4, 50, null]]);
  assert.deepEqual(sharesOf([[]], 'country', ''), []);
  assert.deepEqual([placeName('country', 'NL'), placeName('city', 'NL'), placeName('country', 'unknown')], ['Netherlands', 'NL', 'unknown']);
});

test('a measurement replaces the same day and kind only, so the days before stay as history', async () => {
  const root = fresh();
  const placed = (date: string, kind: 'country' | 'city', place: string, count: string) => ({ date, kind, place, count });
  await saveAudience(root, 'c', [placed('2026-11-20', 'country', 'NL', '1')]);
  await saveAudience(root, 'c', [placed('2026-11-27', 'country', 'NL', '2'), placed('2026-11-27', 'city', 'Utrecht', '1')]);
  await saveAudience(root, 'c', [placed('2026-11-27', 'country', 'BE', '3')]);
  assert.deepEqual(readStats(root, 'c', 'audience').map((found) => `${found.date} ${found.kind} ${found.place} ${found.count}`), ['2026-11-20 country NL 1', '2026-11-27 city Utrecht 1', '2026-11-27 country BE 3']);
});

test('Instagram and Threads places are asked once a week', async () => {
  for (const collect of [collectAudience, collectThreadsAudience]) {
    const root = fresh();
    const asked: string[] = [];
    const fake = (async (url: string) => {
      const breakdown = new URL(url).searchParams.get('breakdown')!;
      asked.push(breakdown);
      return new Response(JSON.stringify({ data: [{ name: 'follower_demographics', total_value: { breakdowns: [{ results: [{ dimension_values: [breakdown === 'city' ? 'Amsterdam, Noord-Holland' : 'NL'], value: 5 }] }] } }] }));
    }) as unknown as typeof fetch;
    const credentials = { accessToken: 't', accountId: '99' };
    await collect(root, 'x', credentials, fake, new Date('2026-11-20T12:00:00Z'));
    await collect(root, 'x', credentials, fake, new Date('2026-11-26T12:00:00Z'));
    assert.equal(asked.length, 2);
    await collect(root, 'x', credentials, fake, new Date('2026-11-27T12:00:00Z'));
    assert.deepEqual([asked.length, readStats(root, 'x', 'audience').length], [4, 4]);
  }
});

test('Facebook is filled in two years back, one measurement a week, each a day before its end time', async () => {
  const root = fresh();
  const windows: number[] = [];
  const fake = (async (url: string) => {
    const query = new URL(url).searchParams;
    const since = Number(query.get('since')) * 1000;
    const until = Number(query.get('until')) * 1000;
    windows.push((until - since) / 86_400_000);
    const values = [];
    for (let at = since + 86_400_000; at <= until; at += 86_400_000) values.push({ end_time: new Date(at).toISOString(), value: { NL: 5 } });
    return new Response(JSON.stringify({ data: [{ name: 'page_follows_country', values }] }));
  }) as unknown as typeof fetch;
  await collectFacebookAudience(root, 'fb', { accessToken: 't', accountId: '99' }, fake, new Date('2026-11-27T00:00:00Z'));
  const dates = readStats(root, 'fb', 'audience').map((found) => found.date!);
  assert.ok(windows.every((days) => days <= 90));
  assert.equal(dates[0], '2024-11-27');
  assert.ok(dates.length >= 104 && dates.length <= 105);
  assert.ok(dates.slice(1).every((date, i) => Date.parse(date) - Date.parse(dates[i]!) === 7 * 86_400_000));
});
