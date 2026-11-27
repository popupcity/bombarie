import assert from 'node:assert/strict';
import { test } from 'node:test';
import { standoutPosts } from './signs.ts';

const now = new Date('2026-11-27T12:00:00Z');
const posts = (views: number[], daysAgo = 1) => views.map((value, i) => ({ date: new Date(now.getTime() - (daysAgo + i / 100) * 86_400_000).toISOString(), url: `p${daysAgo}-${i}`, views: String(value) }));

test('the best posts of the last 90 days get a star: at most three, and never more than one in four', () => {
  assert.deepEqual([...standoutPosts(posts([5, 90, 10, 40, 1]), now).values()], [90]);
  assert.deepEqual([...standoutPosts(posts(Array.from({ length: 8 }, (_, i) => i + 1)), now).values()], [8, 7]);
  assert.deepEqual([...standoutPosts(posts(Array.from({ length: 40 }, (_, i) => i + 1)), now).values()], [40, 39, 38]);
});

test('older posts do not count, few posts give no star, and neither do posts nobody saw', () => {
  assert.deepEqual([...standoutPosts([...posts([1, 2, 3, 4]), ...posts([999], 120)], now).values()], [4]);
  assert.equal(standoutPosts(posts([9, 8, 7]), now).size, 0);
  assert.equal(standoutPosts(posts([0, 0, 0, 0]), now).size, 0);
  assert.equal(standoutPosts([{ date: now.toISOString(), url: 'x', views: '' }], now).size, 0);
});
