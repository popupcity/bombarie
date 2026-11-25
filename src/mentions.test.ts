import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromEdit, suggest, toEdit, triggerAt } from './mentions.ts';
import type { Entities } from './mentions.ts';

const entities: Entities = new Map([
  ['pop-up city', { name: 'Pop-Up City', slug: 'pop-up-city', linkedin: 'urn:li:organization:1' }],
  ['pop-up', { name: 'Pop-Up', slug: 'pop-up' }],
  ['poppo', { name: 'Poppo', slug: 'poppo', instagram: 'poppo' }]
]);

test('links are shown as @name in the editor, unknown ones keep their brackets', () => {
  assert.equal(toEdit('Met [[pop-up city]] en [[Niemand]].', entities), 'Met @Pop-Up City en [[Niemand]].');
});

test('an @name for a known entity becomes a link, the longest name first', () => {
  assert.equal(fromEdit('Met @pop-up city en @Pop-Up samen', entities), 'Met [[Pop-Up City]] en [[Pop-Up]] samen');
  assert.equal(fromEdit('(@Poppo), @Poppo.', entities), '([[Poppo]]), [[Poppo]].');
});

test('@ in an e-mail address, before more letters or for an unknown name is left alone', () => {
  assert.equal(fromEdit('info@example.org en @Poppos en @popupcity', entities), 'info@example.org en @Poppos en @popupcity');
});

test('what the editor shows round-trips to the same text', () => {
  const body = 'Eindelijk! [[Pop-Up City]] en [[Poppo]], zie [[Niemand]].\nTweede regel met @handle.';
  assert.equal(fromEdit(toEdit(body, entities), entities), body);
});

test('suggestions: names that start with the query first, then names that contain it', () => {
  assert.deepEqual(
    suggest('po', entities).map((e) => e.name),
    ['Pop-Up', 'Pop-Up City', 'Poppo']
  );
  assert.deepEqual(
    suggest('city', entities).map((e) => e.name),
    ['Pop-Up City']
  );
  assert.deepEqual(suggest('', entities).length, 3);
  assert.deepEqual(suggest('zzz', entities), []);
  assert.equal(suggest('', entities, 2).length, 2);
});

test('the @ trigger needs a word start and stays on the line', () => {
  assert.deepEqual(triggerAt('Hallo @Po', 9, 'at'), { start: 6, query: 'Po' });
  assert.deepEqual(triggerAt('Hallo @', 7, 'at'), { start: 6, query: '' });
  assert.equal(triggerAt('mail info@po', 12, 'at'), null);
  assert.equal(triggerAt('@Po\nvolgende', 13, 'at'), null);
  assert.deepEqual(triggerAt('eerste\n(@Pop', 12, 'at'), { start: 8, query: 'Pop' });
  assert.equal(triggerAt('x'.repeat(50) + '@' + 'y'.repeat(41), 92, 'at'), null);
});

test('the [[ trigger stops at ]]', () => {
  assert.deepEqual(triggerAt('Zie [[Pop-U', 11, 'wiki'), { start: 4, query: 'Pop-U' });
  assert.equal(triggerAt('Zie [[Poppo]] en', 16, 'wiki'), null);
  assert.equal(triggerAt('Zie [Poppo', 10, 'wiki'), null);
});
