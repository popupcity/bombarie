import assert from 'node:assert/strict';
import { test } from 'node:test';
import { audience, axis, rangeOf, since, sortOf, topPosts } from './insights.ts';

const now = new Date('2026-11-27T12:00:00Z');

test('a range and a sort from the address fall back to 30 days and views', () => {
  assert.deepEqual([rangeOf('90'), rangeOf('nonsense'), rangeOf(null), sortOf('likes'), sortOf('x')], ['90', '30', '30', 'likes', 'views']);
  assert.deepEqual([since('30', now), since('all', now)], ['2026-10-28', '']);
});

test('followers show the latest number, and a change only with two measurements in the range', () => {
  const days = [{ date: '2026-09-01', followers: '800', reach: '5' }, { date: '2026-11-20', followers: '', reach: '9' }, { date: '2026-11-26', followers: '880', reach: '0' }, { date: '2026-11-27', followers: '895', reach: '' }];
  const posts = [{ date: '2026-11-25T10:00:00+0000' }, { date: '2026-08-01T10:00:00+0000' }];
  const month = audience(days, posts, 'instagram', since('30', now));
  assert.deepEqual([month.followers, month.change, month.measuredSince, month.posts], [895, 15, '2026-09-01', 1]);
  assert.deepEqual(month.daily.map((point) => point.value), [9, 0]);
  assert.equal(audience(days.slice(-1), [], 'threads', '').change, null);
});

test('top posts rank across channels, read Instagram comments as replies and leave out what is not measured', () => {
  const sources = [
    { channel: 'ig', platform: 'instagram' as const, posts: [{ date: '2026-11-20T10:00:00+0000', url: 'a', type: 'REEL', views: '10', comments: '4' }, { date: '2026-11-21T10:00:00+0000', url: 'b', type: 'IMAGE', views: '', comments: '' }] },
    { channel: 'th', platform: 'threads' as const, posts: [{ date: '2026-11-22T10:00:00+0000', url: 'c', type: 'TEXT_POST', views: '30', replies: '1' }, { date: '2025-01-01T10:00:00+0000', url: 'old', type: 'IMAGE', views: '999', replies: '9' }] }
  ];
  const byViews = topPosts(sources, 'views', since('30', now));
  assert.deepEqual([byViews.posts.map((post) => [post.url, post.value, post.type]), byViews.unmeasured], [[['c', 30, 'Text'], ['a', 10, 'Reel']], 1]);
  assert.deepEqual(topPosts(sources, 'replies', since('30', now)).posts.map((post) => post.url), ['a', 'c']);
});

test('the time axis puts a day where its date is, with dates by week, month or year', () => {
  const month = axis('2026-10-29', '2026-11-27');
  assert.deepEqual([month.days, month.ticks.map((tick) => tick.label)], [30, ['30 Oct', '6 Nov', '13 Nov', '20 Nov', '27 Nov']]);
  assert.ok(month.at('2026-10-29') < 2 && month.at('2026-11-27') > 98);
  assert.deepEqual(axis('2026-08-29', '2026-11-27').ticks.map((tick) => tick.label), ['Sept', 'Oct', 'Nov']);
  assert.ok(axis('2025-11-27', '2026-11-27').ticks.length <= 6);
  assert.deepEqual(axis('2023-11-28', '2026-11-27').ticks.map((tick) => tick.label), ['2024', '2025', '2026']);
});
