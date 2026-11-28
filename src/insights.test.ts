import assert from 'node:assert/strict';
import { test } from 'node:test';
import { axis, before, passedOn, passedOnLine, followerLine, followersOf, grouped, othersShare, rangeOf, scale, since, sortOf, summed, timeline, topPosts, viewTotal } from './insights.ts';

const now = new Date('2026-11-27T12:00:00Z');

test('a range and a sort from the address fall back to 30 days and views', () => {
  assert.deepEqual([rangeOf('quarter'), rangeOf('nonsense'), rangeOf(null), sortOf('likes'), sortOf('x')], ['quarter', 'month', 'month', 'likes', 'views']);
  assert.deepEqual([since('week', now), since('month', now), since('all', now)], ['2026-11-21', '2026-10-29', '']);
});

test('followers show the latest number, and a change only with two measurements in the range', () => {
  const days = [{ date: '2026-09-01', followers: '800' }, { date: '2026-11-20', followers: '' }, { date: '2026-11-26', followers: '880' }, { date: '2026-11-27', followers: '895' }];
  assert.deepEqual(followersOf(days, since('month', now)), { followers: 895, change: 15 });
  assert.equal(followersOf(days.slice(-1), '').change, null);
});

const day = (date: string, views: string, reach = '', followers = '') => ({ date, views, reach, followers });
const accounts = [
  { platform: 'instagram' as const, days: [day('2026-10-29', '5', '3'), day('2026-11-26', '10', '4', '100'), day('2026-11-27', '20', '6', '101')], posts: [{ date: '2026-11-25T10:00:00+0000', likes: '3', comments: '2', shares: '3', saved: '2' }, { date: '2026-10-10T10:00:00+0000', likes: '1', comments: '0', shares: '1', saved: '0' }] },
  { platform: 'threads' as const, days: [day('2026-09-20', '7'), day('2026-10-10', '2'), day('2026-11-27', '1', '', '50')], posts: [{ date: '2026-11-20T10:00:00+0000', likes: '4', replies: '1', shares: '4', reposts: '1' }] }
];

test('totals add up the days of the shown accounts, and compare only when every one goes back far enough', () => {
  const from = since('month', now);
  assert.deepEqual(summed(accounts, 'views', from).map((point) => [point.date, point.value]), [['2026-10-29', 5], ['2026-11-26', 10], ['2026-11-27', 21]]);
  assert.deepEqual(summed(accounts, 'reach', from).map((point) => point.value), [3, 4, 6]);
  assert.deepEqual(viewTotal(accounts, from, before('month', now)), { value: 36, change: null });
  assert.deepEqual(viewTotal(accounts.slice(1), from, before('month', now)), { value: 1, change: -1 });
});

test('shared and saved count the posts of the period that were passed on against the one before, each platform with its own numbers', () => {
  const post = (date: string, numbers: Record<string, string>) => ({ date, ...numbers });
  const spread = [
    { platform: 'instagram' as const, days: [], posts: [post('2026-11-25T10:00:00+0000', { shares: '3', saved: '2', likes: '99' }), post('2026-10-10T10:00:00+0000', { shares: '1', saved: '0' }), post('2026-11-26T10:00:00+0000', { shares: '', saved: '' })] },
    { platform: 'threads' as const, days: [], posts: [post('2026-11-20T10:00:00+0000', { shares: '1', reposts: '2', quotes: '1' })] },
    { platform: 'substack' as const, days: [], posts: [post('2026-11-21T10:00:00+0000', { views: '5' })] }
  ];
  assert.deepEqual(passedOn(spread, since('month', now), before('month', now)), { value: 9, posts: 2, change: 8 });
  assert.equal(passedOn(spread, '', '').change, null);
});

test('the follower line starts once every account was measured, and carries the last count of each on', () => {
  assert.deepEqual(followerLine(accounts, ''), [{ date: '2026-11-27', value: 151 }]);
  const counted = (...days: [string, number][]) => ({ platform: 'instagram' as const, posts: [], days: days.map(([date, followers]) => ({ date, followers: String(followers) })) });
  const two = [counted(['2026-11-01', 10], ['2026-11-04', 12]), counted(['2026-11-02', 100], ['2026-11-03', 101], ['2026-11-06', 105])];
  assert.deepEqual(followerLine(two, '').map((point) => [point.date, point.value]), [['2026-11-02', 110], ['2026-11-03', 111], ['2026-11-04', 113], ['2026-11-06', 117]]);
  assert.deepEqual(followerLine(two, '2026-11-05'), [{ date: '2026-11-06', value: 117 }]);
});
test('a channel without views does not take the change in views away', () => {
  const silent = { platform: 'substack' as const, posts: [], days: [{ date: '2026-11-27', followers: '6455' }] };
  assert.deepEqual(viewTotal([...accounts.slice(1), silent], since('month', now), before('month', now)), { value: 1, change: -1 });
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
  const byViews = topPosts(sources, 'views', since('month', now));
  assert.deepEqual(byViews.map((post) => [post.url, post.value, post.type]), [['c', 30, 'Text'], ['a', 10, 'Reel']]);
  assert.deepEqual(topPosts(sources, 'replies', since('month', now)).map((post) => post.url), ['a', 'c']);
});

test('the time axis puts a day where its date is, with dates by week, month or year', () => {
  const month = axis('2026-10-29', '2026-11-27');
  assert.deepEqual([month.days, month.ticks.map((tick) => tick.label)], [30, ['30 Oct', '6 Nov', '13 Nov', '20 Nov', '27 Nov']]);
  assert.ok(month.at('2026-10-29') < 2 && month.at('2026-11-27') > 98);
  assert.deepEqual(axis('2026-08-29', '2026-11-27').ticks.map((tick) => tick.label), ['Sept', 'Oct', 'Nov']);
  assert.ok(axis('2025-11-27', '2026-11-27').ticks.length <= 6);
  assert.deepEqual(axis('2023-11-28', '2026-11-27').ticks.map((tick) => tick.label), ['2024', '2025', '2026']);
});

test('the shared line holds for every day what the posts of the week before it got', () => {
  const line = passedOnLine(accounts, '2026-11-24', '2026-11-27');
  assert.deepEqual(line.map((point) => [point.date, point.value]), [['2026-11-24', 5], ['2026-11-25', 10], ['2026-11-26', 10], ['2026-11-27', 5]]);
  assert.ok(passedOnLine(accounts, '2012-01-01', '2026-11-27').length <= 180);
  assert.deepEqual(passedOnLine([], '', '2026-11-27'), []);
});

test('longer periods group the days: a quarter by week from Monday, a year by month', () => {
  const days = [{ date: '2026-11-01', value: 1 }, { date: '2026-11-02', value: 2 }, { date: '2026-11-08', value: 4 }, { date: '2026-12-01', value: 8 }];
  assert.deepEqual(grouped(days, 'week').map((point) => [point.date, point.value]), [['2026-10-26', 1], ['2026-11-02', 6], ['2026-11-30', 8]]);
  assert.deepEqual(grouped(days, 'month', 'last').map((point) => point.value), [4, 8]);
  const weeks = timeline('2026-08-30', '2026-11-27', 'week');
  assert.deepEqual([weeks.days, weeks.ticks.map((tick) => tick.label)], [14, ['Sept', 'Oct', 'Nov']]);
  assert.ok(weeks.at('2026-08-30') < 8 && weeks.at('2026-11-27') > 92);
  const months = timeline('2025-11-28', '2026-11-27', 'month');
  assert.deepEqual([months.days, months.ticks.length <= 7], [13, true]);
  assert.deepEqual(axis('2026-11-21', '2026-11-27').ticks.map((tick) => tick.label), ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
});

test('posts rank by the followers they brought, and a post without that number is left out', () => {
  const posts = [
    { url: 'a', date: '2026-11-20T10:00:00Z', follows: '1' },
    { url: 'b', date: '2026-11-21T10:00:00Z', follows: '26' },
    { url: 'reel', date: '2026-11-22T10:00:00Z', follows: '' }
  ];
  assert.deepEqual(topPosts([{ channel: 'ig', platform: 'instagram', posts }, { channel: 't', platform: 'threads', posts: [{ url: 'c', date: '2026-11-22T10:00:00Z', views: '9' }] }], 'follows', '').map((post) => [post.url, post.value]), [['b', 26], ['a', 1]]);
});

test('the share of reach beyond the followers is taken over the days that have both parts', () => {
  const days = [{ date: '2026-11-01', reach_others: '30', reach_followers: '70' }, { date: '2026-11-02', reach_others: '10', reach_followers: '90' }, { date: '2026-11-03', reach_others: '', reach_followers: '' }, { date: '2026-10-01', reach_others: '99', reach_followers: '1' }];
  assert.equal(othersShare(days, '2026-11-01'), 20);
  assert.equal(othersShare([], ''), null);
});
