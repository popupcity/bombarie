import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitParts } from './parts.ts';

test('a line with only three dashes starts the next part, and every part is trimmed', () => {
  assert.deepEqual(splitParts('One.\n\n---\n\nTwo.\n  ---  \nThree.'), ['One.', 'Two.', 'Three.']);
});

test('text without a separator is one part, and a dash inside a line is not a separator', () => {
  assert.deepEqual(splitParts('A well-known --- thing'), ['A well-known --- thing']);
  assert.deepEqual(splitParts(''), ['']);
});
