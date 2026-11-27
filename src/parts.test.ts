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

test('a separator can name the LinkedIn channel that posts the comment, and joining gives the same text back', async () => {
  const { joinThread, splitThread } = await import('./parts.ts');
  const body = 'Post.\n\n--- joop-linkedin\n\nFirst.\n\n---\n\nSecond.';
  assert.deepEqual(splitThread(body), [{ text: 'Post.' }, { text: 'First.', by: 'joop-linkedin' }, { text: 'Second.' }]);
  assert.equal(joinThread(splitThread(body)), body);
  assert.equal(splitThread('A\n--- not a channel\nB').length, 1);
});
