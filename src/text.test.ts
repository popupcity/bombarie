import assert from 'node:assert/strict';
import { test } from 'node:test';
import { campaignTitle, folderTitle, sentence } from './text.ts';

test('a message becomes a sentence with a capital and a full stop', () => {
  assert.equal(sentence('invalid date "x"'), 'Invalid date "x".');
  assert.equal(sentence('Already done.'), 'Already done.');
  assert.equal(sentence('  Saving…'), 'Saving…');
  assert.equal(sentence(''), '');
});

test('a folder name becomes a readable title', () => {
  assert.equal(folderTitle('2026-11-20-expo-opening'), 'Expo opening');
  assert.equal(folderTitle('misc'), 'Misc');
});

test('the first variant with a title decides, otherwise the folder name', () => {
  assert.equal(campaignTitle('2026-11-20-expo', [undefined, ' ', 'Expo: Stad van Morgen', 'Other']), 'Expo: Stad van Morgen');
  assert.equal(campaignTitle('2026-11-20-expo', [undefined]), 'Expo');
});
