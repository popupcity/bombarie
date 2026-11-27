import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readStats, statsFile } from './stats.ts';
import { countedTo, parseExport, saveExport } from './substack.ts';

test('the subscribers export is a date and a total per line, the views export has a header, and an empty day is left out', () => {
  assert.deepEqual(parseExport('﻿2026/09/20,6490\r\n2026/09/21,\r\n2026/09/22,6490\r\n'), { kind: 'followers', rows: [{ date: '2026-09-20', followers: '6490' }, { date: '2026-09-22', followers: '6490' }] });
  assert.deepEqual(parseExport('Date,Views\n2026/09/11,1858\n2026/09/12,0\n'), { kind: 'views', rows: [{ date: '2026-09-11', views: '1858' }, { date: '2026-09-12', views: '0' }] });
});

test('views per month are refused, they would stand as one peak on the first', () => {
  assert.throws(() => parseExport('Date,Views\n2026/10/01,4370\n2026/11/01,6668\n'), /per month/);
});

test('any other file is refused, the subscriber list and the growth sources too', () => {
  for (const text of ['', 'Date,Views\n', '2026/09/21,\n', 'email,created_at\na@b.c,2026-01-01\n', 'Date,Source,Category,Unique visitors,New subscribers,New revenue\n2026/11/10,LinkedIn,Social,1,1,0\n', '2026/11/10,6455,extra\n']) {
    assert.throws(() => parseExport(text), /not an export/);
  }
});

test('both exports share the days of a channel, and a newer one updates only its own number', async () => {
  const root = mkdtempSync(join(tmpdir(), 'social-substack-'));
  await saveExport(root, 'sub', parseExport('2026/11/01,10\n2026/11/02,11\n'));
  await saveExport(root, 'sub', parseExport('Date,Views\n2026/11/02,5\n2026/11/03,7\n'));
  await saveExport(root, 'sub', parseExport('2026/11/02,12\n'));
  assert.equal(readFileSync(statsFile(root, 'sub', 'days'), 'utf8'), 'date,followers,views\n2026-11-01,10,\n2026-11-02,12,5\n2026-11-03,,7\n');
  assert.deepEqual([countedTo(root, 'sub', 'followers'), countedTo(root, 'sub', 'views'), countedTo(root, 'sub', 'posts')], ['2026-11-02', '2026-11-03', undefined]);
});

const POSTS = 'title,post_date,audience,views,engagement_rate,signups,subscribes,estimated_value,open_rate\n';

test('the posts export keeps views, new subscribers free and paid, and rates, not the value, and finds the link in the feed by title', async () => {
  const root = mkdtempSync(join(tmpdir(), 'social-substack-'));
  const file = `${POSTS}"One, two",2026-11-05T15:38:42.789Z,everyone,2964,0.021,3,1,67.4,0.33\nOld one,2025-01-17T11:01:35.498Z,everyone,8240,0.04,28,0,0,0.53\n`;
  const publication = { feed: 'https://news.test/feed', items: [{ guid: 'g', title: 'One,  Two', url: 'https://news.test/p/one-two', at: '', text: '' }] };
  await saveExport(root, 'sub', parseExport(file), publication);
  const read = () => readStats(root, 'sub', 'posts').map((row) => [row.url, row.type, row.text, row.views, row.follows, row.signups, row.subscribes, row.open_rate]);
  assert.deepEqual(read(), [
    ['https://news.test/#2025-01-17T11:01:35.498Z', 'NEWSLETTER', 'Old one', '8240', '28', '28', '0', '0.53'],
    ['https://news.test/p/one-two', 'NEWSLETTER', 'One, two', '2964', '4', '3', '1', '0.33']
  ]);
  assert.equal(readFileSync(statsFile(root, 'sub', 'posts'), 'utf8').includes('67.4'), false);
  await saveExport(root, 'sub', parseExport(`${POSTS}"One, two",2026-11-05T15:38:42.789Z,everyone,3000,0.02,3,1,67.4,0.34\n`), { feed: publication.feed, items: [] });
  assert.deepEqual(read().map((row) => [row[0], row[3]]), [['https://news.test/#2025-01-17T11:01:35.498Z', '8240'], ['https://news.test/p/one-two', '3000']]);
});

test('the countries export has no date, so it counts for the day it is uploaded', async () => {
  const root = mkdtempSync(join(tmpdir(), 'social-substack-'));
  const read = parseExport('location,free signups\nNL,847\nUS,399\n');
  assert.equal(read.kind, 'countries');
  await saveExport(root, 'sub', read, { items: [] }, '2026-11-27');
  assert.deepEqual(readStats(root, 'sub', 'audience').map((row) => [row.date, row.kind, row.place, row.count]), [['2026-11-27', 'country', 'NL', '847'], ['2026-11-27', 'country', 'US', '399']]);
  assert.equal(countedTo(root, 'sub', 'countries'), '2026-11-27');
  for (const text of ['location,free signups\n', 'location,free signups\nNetherlands,1\n', 'location,free signups\nNL,a@b.c\n']) assert.throws(() => parseExport(text), /not an export/);
});
