import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { addEntity, findEntity, loadEntities } from './entities.ts';
import { expandWikilinks } from './mentions.ts';
import { readPosts } from './posts.ts';

function project(entities: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'social-entities-'));
  mkdirSync(join(root, 'entities'));
  for (const [file, text] of Object.entries(entities)) writeFileSync(join(root, 'entities', file), text);
  return root;
}

const popup = '---\nname: Pop-Up City\nlinkedin: urn:li:organization:716321\ninstagram: popupcity\n---\n';

test('entities load from notes, the name comes from the properties', () => {
  const { entities, errors } = loadEntities(
    project({ 'pop-up-city.md': popup, 'jan.md': '---\nname: Jan\n---\n', 'empty.md': '---\nname: Empty\n---\n', 'notes.txt': 'ignored' })
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(entities.get('pop-up city'), {
    name: 'Pop-Up City',
    slug: 'pop-up-city',
    linkedin: 'urn:li:organization:716321',
    instagram: 'popupcity'
  });
  assert.deepEqual(entities.get('jan'), { name: 'Jan', slug: 'jan' });
  assert.deepEqual(entities.get('empty'), { name: 'Empty', slug: 'empty' });
  assert.equal(entities.size, 3);
});

test('a missing entities folder is fine', () => {
  const root = mkdtempSync(join(tmpdir(), 'social-entities-'));
  assert.deepEqual(loadEntities(root), { entities: new Map(), errors: [] });
});

test('bad entity notes are reported and do not hide the good ones', () => {
  const { entities, errors } = loadEntities(
    project({
      'good.md': '---\nname: Good\n---\n',
      'typo.md': '---\nname: Typo\nlinkedln: urn:li:organization:1\n---\n',
      'bad-urn.md': '---\nname: Bad urn\nlinkedin: nope\n---\n',
      'bad-handle.md': '---\nname: Bad handle\ninstagram: "@popupcity"\n---\n',
      'a-b.md': '---\nname: A|B\n---\n',
      'no-name.md': ''
    })
  );
  assert.deepEqual([...entities.keys()], ['good']);
  assert.equal(errors.length, 5);
  assert.ok(errors.some((e) => e.includes('no-name.md')));
  assert.ok(errors.some((e) => e.includes('unknown key "linkedln"')));
  assert.ok(errors.some((e) => e.includes('urn:li:person:')));
  assert.ok(errors.some((e) => e.includes('without @')));
  assert.ok(errors.some((e) => e.includes('cannot contain')));
});

test('names that differ only by case are refused', () => {
  const root = project({ 'a.md': '---\nname: Dup\n---\n', 'b.md': '---\nname: dup\n---\n' });
  const { errors } = loadEntities(root);
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? '', /apart from case/);
});

test('wikilinks expand per platform and fix the casing', () => {
  const { entities } = loadEntities(project({ 'pop-up-city.md': popup, 'jan.md': '---\nname: Jan\n---\n' }));
  const body = 'Met [[pop-up city]] en [[Jan]].';

  assert.deepEqual(expandWikilinks(body, 'linkedin', entities), {
    text: 'Met Pop-Up City en Jan.',
    mentions: { 'Pop-Up City': 'urn:li:organization:716321' }
  });
  assert.deepEqual(expandWikilinks(body, 'instagram', entities), {
    text: 'Met @popupcity en Jan.',
    mentions: {}
  });
  assert.deepEqual(expandWikilinks(body, 'facebook', entities), {
    text: 'Met Pop-Up City en Jan.',
    mentions: {}
  });
});

test('unknown entities and unsupported link forms are refused', () => {
  const { entities } = loadEntities(project({ 'pop-up-city.md': popup }));
  assert.throws(() => expandWikilinks('Hi [[Nobody]]', 'linkedin', entities), /unknown entity \[\[Nobody\]\]/);
  assert.throws(() => expandWikilinks('Hi [[Pop-Up City|PUC]]', 'linkedin', entities), /only \[\[Name\]\]/);
  assert.throws(() => expandWikilinks('Hi [[Pop-Up City#kop]]', 'linkedin', entities), /only \[\[Name\]\]/);
  assert.throws(() => expandWikilinks('Hi [[open', 'linkedin', entities), /only \[\[Name\]\]/);
});

test('readPosts resolves entities, rejects embeds and the old mentions field', () => {
  const root = project({ 'pop-up-city.md': popup });
  const folder = join(root, 'posts', '2026-11-20-x');
  mkdirSync(folder, { recursive: true });
  mkdirSync(join(root, 'channels'), { recursive: true });
  writeFileSync(join(root, 'channels', 'channels.yml'), 'jeroen-linkedin:\n  platform: linkedin\npopupcity-instagram:\n  platform: instagram\n');
  writeFileSync(join(folder, 'jeroen-linkedin.md'), '---\ndate: 2026-11-20T10:00\n---\nHoi [[Pop-Up City]]\n');
  writeFileSync(join(folder, 'popupcity-instagram.md'), '---\ndate: 2026-11-20T10:00\n---\nHoi [[Pop-Up City]]\n');
  writeFileSync(join(folder, 'jeroen-linkedin-story.md'), '---\ndate: 2026-11-20T10:00\n---\n![[foto.jpg]]\n');

  const channels = {
    'jeroen-linkedin': { platform: 'linkedin' as const },
    'popupcity-instagram': { platform: 'instagram' as const }
  };
  const { posts, errors } = readPosts(root, channels);
  assert.deepEqual(
    posts.map((p) => [p.channel, p.text, p.mentions]),
    [
      ['jeroen-linkedin', 'Hoi Pop-Up City', { 'Pop-Up City': 'urn:li:organization:716321' }],
      ['popupcity-instagram', 'Hoi @popupcity', {}]
    ]
  );
  assert.equal(errors.length, 1);
  assert.ok(errors.some((e) => e.includes('![[')));
});

test('entities can be created, edited and deleted, and a used one stays', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { removeEntity, updateEntity } = await import('./entities.ts');
  const root = mkdtempSync(join(tmpdir(), 'entities-'));
  assert.equal(await addEntity(root, { name: 'Pop-Up City', linkedin: 'urn:li:organization:1', instagram: '@popupcity' }), 'Pop-Up City');
  assert.equal(readFileSync(join(root, 'entities', 'pop-up-city.md'), 'utf8'), '---\nname: Pop-Up City\nlinkedin: urn:li:organization:1\ninstagram: popupcity\n---\n');
  await assert.rejects(addEntity(root, { name: 'pop-up city', linkedin: '', instagram: '' }), /already exists/);
  await assert.rejects(addEntity(root, { name: 'X/Y', linkedin: '', instagram: '' }), /cannot contain/);
  await assert.rejects(addEntity(root, { name: 'Z', linkedin: 'nope', instagram: '' }), /urn/);
  await updateEntity(root, 'pop-up-city', { name: 'Pop-Up City', linkedin: '', instagram: 'popupcity' });
  assert.equal(readFileSync(join(root, 'entities', 'pop-up-city.md'), 'utf8'), '---\nname: Pop-Up City\ninstagram: popupcity\n---\n');
  mkdirSync(join(root, 'posts', 'a'), { recursive: true });
  writeFileSync(join(root, 'posts', 'a', 'x.md'), 'Hi [[pop-up city]]');
  await assert.rejects(removeEntity(root, 'Pop-Up City'), /used in 1 post/);
  writeFileSync(join(root, 'posts', 'a', 'x.md'), 'Hi');
  await removeEntity(root, 'Pop-Up City');
  assert.ok(!existsSync(join(root, 'entities', 'pop-up-city.md')));
});

test('an entity is found by its slug and a name that gives the same slug is refused', async () => {
  const root = project({ 'winkelcentrum-boven-t-y.md': '---\nname: "Winkelcentrum Boven \'t Y"\n---\n' });
  assert.equal(findEntity(root, 'winkelcentrum-boven-t-y')?.name, "Winkelcentrum Boven 't Y");
  assert.equal(findEntity(root, 'nope'), undefined);
  await assert.rejects(addEntity(root, { name: 'Winkelcentrum boven t y', linkedin: '', instagram: '' }), /too close/);
  await assert.rejects(addEntity(root, { name: 'New', linkedin: '', instagram: '' }), /too close/);
});

test('renaming an entity moves its file, keeps the notes and rewrites the mentions in posts', async () => {
  const { updateEntity } = await import('./entities.ts');
  const root = project({ 'pop-up-city.md': `${popup}\nNotes here\n`, 'jan.md': '---\nname: Jan\n---\n' });
  mkdirSync(join(root, 'posts', 'a'), { recursive: true });
  writeFileSync(join(root, 'posts', 'a', 'x.md'), 'Hi [[pop-up city]] and [[Jan]]');
  const saved = await updateEntity(root, 'pop-up-city', { name: "PUC (Pop-Up City)", linkedin: 'urn:li:organization:716321', instagram: '@popupcity' });
  assert.deepEqual(saved, { slug: 'puc-pop-up-city', name: 'PUC (Pop-Up City)', posts: 1 });
  const entity = findEntity(root, 'puc-pop-up-city');
  assert.equal(entity?.name, 'PUC (Pop-Up City)');
  assert.equal(findEntity(root, 'pop-up-city'), undefined);
  assert.equal(readFileSync(join(root, 'posts', 'a', 'x.md'), 'utf8'), 'Hi [[PUC (Pop-Up City)]] and [[Jan]]');
  assert.match(readFileSync(join(root, 'entities', 'puc-pop-up-city.md'), 'utf8'), /Notes here/);
  await assert.rejects(updateEntity(root, 'jan', { name: 'puc (pop-up city)', linkedin: '', instagram: '' }), /already exists/);
  await assert.rejects(updateEntity(root, 'jan', { name: 'New', linkedin: '', instagram: '' }), /too close/);
  assert.deepEqual(await updateEntity(root, 'jan', { name: 'Jan', linkedin: '', instagram: '' }), { slug: 'jan', name: 'Jan', posts: 0 });
});
