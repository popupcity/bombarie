import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Entities } from './mentions.ts';
import { preview } from './preview.ts';

const entities: Entities = new Map([
  ['pop-up city', { name: 'Pop-Up City', slug: 'pop-up-city', linkedin: 'urn:li:organization:1', instagram: 'popupcity' }],
  ['poppo', { name: 'Poppo', slug: 'poppo' }]
]);

test('linkedin marks the link and every plain occurrence of the name as a mention', () => {
  const { segments, notes } = preview('Opent [[pop-up city]]. Pop-Up City rocks', 'linkedin', entities);
  assert.deepEqual(segments, [
    { kind: 'text', text: 'Opent ' },
    { kind: 'mention', text: 'Pop-Up City' },
    { kind: 'text', text: '. ' },
    { kind: 'mention', text: 'Pop-Up City' },
    { kind: 'text', text: ' rocks' }
  ]);
  assert.deepEqual(notes, []);
});

test('an entity without an id for the platform is plain text with a note', () => {
  const { segments, notes } = preview('Met [[Poppo]]', 'linkedin', entities);
  assert.deepEqual(segments, [
    { kind: 'text', text: 'Met ' },
    { kind: 'plain', text: 'Poppo' }
  ]);
  assert.deepEqual(notes, ['Poppo has no LinkedIn ID and is posted as plain text']);
});

test('instagram turns the link into the handle, facebook into the plain name', () => {
  assert.deepEqual(preview('[[Pop-Up City]]', 'instagram', entities).segments, [{ kind: 'handle', text: '@popupcity' }]);
  const facebook = preview('[[Pop-Up City]]', 'facebook', entities);
  assert.deepEqual(facebook.segments, [{ kind: 'plain', text: 'Pop-Up City' }]);
  assert.deepEqual(facebook.notes, []);
});

test('an unknown entity stays visible and is reported', () => {
  const { segments, notes } = preview('Hallo [[Niemand]]', 'linkedin', entities);
  assert.deepEqual(segments[1], { kind: 'unknown', text: '[[Niemand]]' });
  assert.deepEqual(notes, ['unknown entity [[Niemand]]; add it under Entities']);
});

test('the length is what gets posted, and the limit is reported when exceeded', () => {
  assert.equal(preview('[[Pop-Up City]]', 'linkedin', entities).length, 'Pop-Up City'.length);
  const long = preview('x'.repeat(3002), 'linkedin', entities);
  assert.equal(long.limit, 3000);
  assert.deepEqual(long.notes, ['the text is 2 characters over the LinkedIn limit of 3000']);
  assert.equal(preview('x', 'instagram', entities).limit, 2200);
  assert.equal(preview('x', 'facebook', entities).limit, undefined);
});

test('replies come back with their own text, the way they will be posted', () => {
  const entities = new Map([['pop-up city', { name: 'Pop-Up City', slug: 'pop-up-city', instagram: 'popupcity' }]]);
  const result = preview('Main\n\n---\n\nMore from [[Pop-Up City]]', 'threads', entities);
  assert.equal(result.replies?.[0]?.map((segment) => segment.text).join(''), 'More from @popupcity');
});

test('a link is marked on LinkedIn only, without the full stop after it', () => {
  const kinds = (platform: 'linkedin' | 'threads') => preview('See https://example.com/a. Or www.example.org', platform, new Map()).segments.map((segment) => [segment.kind, segment.text]);
  assert.deepEqual(kinds('linkedin'), [['text', 'See '], ['link', 'https://example.com/a'], ['text', '. Or '], ['link', 'www.example.org']]);
  assert.equal(kinds('threads').length, 1);
});
