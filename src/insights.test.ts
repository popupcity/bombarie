import assert from 'node:assert/strict';
import { test } from 'node:test';
import { axis, before, engagement, followerLine, followersOf, rangeOf, scale, since, sortOf, summed, topPosts, viewTotal } from './insights.ts';

const now = new Date('2026-11-27T12:00:00Z');

test('a range and a sort from the address fall back to 30 days and views', () => {
  assert.deepEqual([rangeOf('90'), rangeOf('nonsense'), rangeOf(null), sortOf('likes'), sortOf('x')], ['90', '30', '30', 'likes', 'views']);
  assert.deepEqual([since('30', now), since('all', now)], ['2026-10-28', '']);
});

test('followers show the latest number, and a change only with two measurements in the range', () => {
  const days = [{ date: '2026-09-01', followers: '800' }, { date: '2026-11-20', followers: '' }, { date: '2026-11-26', followers: '880' }, { date: '2026-11-27', followers: '895' }];
  assert.deepEqual(followersOf(days, since('30', now)), { followers: 895, change: 15 });
  assert.equal(followersOf(days.slice(-1), '').change, null);
});

const day = (date: string, views: string, reach = '', followers = '') => ({ date, views, reach, followers });
const accounts = [
  { platform: 'instagram' as const, days: [day('2026-10-29', '5', '3'), day('2026-11-26', '10', '4', '100'), day('2026-11-27', '20', '6', '101')], posts: [{ date: '2026-11-25T10:00:00+0000', likes: '3', comments: '2' }, { date: '2026-10-10T10:00:00+0000', likes: '1', comments: '0' }] },
  { platform: 'threads' as const, days: [day('2026-09-20', '7'), day('2026-10-10', '2'), day('2026-11-27', '1', '', '50')], posts: [{ date: '2026-11-20T10:00:00+0000', likes: '4', replies: '1' }] }
];

test('totals add up the days of the shown accounts, and compare only when every one goes back far enough', () => {
  const from = since('30', now);
  assert.deepEqual(summed(accounts, 'views', from).map((point) => [point.date, point.value]), [['2026-10-29', 5], ['2026-11-26', 10], ['2026-11-27', 21]]);
  assert.deepEqual(summed(accounts, 'reach', from).map((point) => point.value), [3, 4, 6]);
  assert.deepEqual(viewTotal(accounts, from, before('30', now)), { value: 36, change: null });
  assert.deepEqual(viewTotal(accounts.slice(1), from, before('30', now)), { value: 1, change: -1 });
});

test('likes and replies count the posts of the period against the one before', () => {
  assert.deepEqual(engagement(accounts, since('30', now), before('30', now)), { value: 10, posts: 2, change: 9 });
  assert.equal(engagement(accounts, '', '').change, null);
});

test('the follower line only has days on which every account was measured', () => {
  assert.deepEqual(followerLine(accounts, ''), [{ date: '2026-11-27', value: 151 }]);
});

test('the lines of a chart are round numbers that cover the values', () => {
  assert.deepEqual(scale([3, 1105]).lines, [0, 500, 1000, 1500]);
  assert.deepEqual(scale([0]).lines, [0, 1]);
  const close = scale([6373, 6390], false);
  assert.ok(close.low <= 6373 && close.high >= 6390 && close.low > 6000);
});

test('top posts rank across channels, read Instagram comments as replies and leave out what is not measured', () => {
  const sources = [
    { channel: 'ig', platform: 'instagram' as const, posts: [{ date: '2026-11-20T10:00:00+0000', url: 'a', type: 'REEL', views: '10', comments: '4' }, { date: '2026-11-21T10:00:00+0000', url: 'b', type: 'IMAGE', views: '', comments: '' }] },
    { channel: 'th', platform: 'threads' as const, posts: [{ date: '2026-11-22T10:00:00+0000', url: 'c', type: 'TEXT_POST', views: '30', replies: '1' }, { date: '2025-01-01T10:00:00+0000', url: 'old', type: 'IMAGE', views: '999', replies: '9' }] }
  ];
  const byViews = topPosts(sources, 'views', since('30', now));
  assert.deepEqual(byViews.map((post) => [post.url, post.value, post.type]), [['c', 30, 'Text'], ['a', 10, 'Reel']]);
  assert.deepEqual(topPosts(sources, 'replies', since('30', now)).map((post) => post.url), ['a', 'c']);
});

test('the time axis puts a day where its date is, with dates by week, month or year', () => {
  const month = axis('2026-10-29', '2026-11-27');
  assert.deepEqual([month.days, month.ticks.map((tick) => tick.label)], [30, ['30 Oct', '6 Nov', '13 Nov', '20 Nov', '27 Nov']]);
  assert.ok(month.at('2026-10-29') < 2 && month.at('2026-11-27') > 98);
  assert.deepEqual(axis('2026-08-29', '2026-11-27').ticks.map((tick) => tick.label), ['Sept', 'Oct', 'Nov']);
  assert.ok(axis('2025-11-27', '2026-11-27').ticks.length <= 6);
  assert.deepEqual(axis('2023-11-28', '2026-11-27').ticks.map((tick) => tick.label), ['2024', '2025', '2026']);
});
