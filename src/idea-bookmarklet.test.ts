import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ideaBookmarklet } from './idea-bookmarklet.ts';

test('the bookmarklet opens the add page of this app, with the og title before the tab title', () => {
  const link = ideaBookmarklet('https://social.example.com');
  assert.ok(link.startsWith('javascript:'));
  assert.ok(link.includes('"https://social.example.com/ideas/add"'));
  assert.ok(link.indexOf('og:title') < link.indexOf('document.title'));
  assert.doesNotThrow(() => new Function(link.slice('javascript:'.length)));
});
