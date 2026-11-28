import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { bestHour, freeMoments, hoursOf } from './online.ts';
import { collectOnline, statsFile } from './stats.ts';

const day = (peak: number) => ({ end_time: '2026-11-26T08:00:00+0000', value: Object.fromEntries(Array.from({ length: 24 }, (_, hour) => [String(hour), hour === peak ? 100 : 10])) });
const rows = (values: Record<number, number>) => Object.entries(values).map(([hour, followers]) => ({ hour, followers: String(followers) }));

test('the hours of Meta are Pacific and are kept as hours of the clock here, as a mean over the whole days', () => {
  const kept = hoursOf([day(12), day(12), { end_time: '2026-11-27T08:00:00+0000', value: {} }]);
  assert.equal(kept.length, 24);
  assert.deepEqual(kept.find((row) => row.followers === '100'), { hour: '21', followers: '100' });
});

test('the best hour is the busiest between 7 and 23', () => {
  assert.equal(bestHour(rows({ 3: 999, 15: 97, 20: 98, 21: 100, 22: 91 })), 21);
  assert.equal(bestHour([]), null);
  assert.equal(bestHour(rows({ 12: 0 })), null);
});

test('suggested moments are the next three free days at that hour, today only when it is still ahead', () => {
  const taken = new Set(['2026-11-29']);
  assert.deepEqual(freeMoments(21, taken, new Date('2026-11-28T12:00:00+01:00')), ['2026-11-28T21:00', '2026-11-30T21:00', '2026-12-01T21:00']);
  assert.equal(freeMoments(21, taken, new Date('2026-11-28T20:50:00+01:00'))[0], '2026-11-30T21:00');
});

test('the hours online are kept per channel, and nothing is written when Instagram gives none', async () => {
  const root = mkdtempSync(join(tmpdir(), 'social-online-'));
  const answer = (values: unknown[]) => (async () => new Response(JSON.stringify({ data: [{ name: 'online_followers', values }] }))) as unknown as typeof fetch;
  const credentials = { accessToken: 't', accountId: '99' };
  await collectOnline(root, 'ig', credentials, answer([day(12)]), new Date('2026-11-27T12:00:00Z'));
  const kept = readFileSync(statsFile(root, 'ig', 'online'), 'utf8');
  assert.match(kept, /^hour,followers\n0,10\n[\s\S]*\n21,100\n/);
  await collectOnline(root, 'ig', credentials, answer([]), new Date('2026-11-28T12:00:00Z'));
  assert.equal(readFileSync(statsFile(root, 'ig', 'online'), 'utf8'), kept);
});
