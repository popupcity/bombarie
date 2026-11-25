import assert from 'node:assert/strict';
import { test } from 'node:test';
import { statusOfRaw, readFields, withBody, withDate, withImages, withManual, withTitle, withStatus } from './frontmatter.ts';

const raw = '---\nstatus: draft\ndate: 2026-11-20T10:30\nimages: [a.jpg]\n---\nOld text\n';

test('view reads the fields the editor shows', () => {
  assert.deepEqual(readFields(raw), { ok: true, date: '2026-11-20T10:30', manual: false, status: 'draft', images: ['a.jpg'], title: '', body: 'Old text' });
  const planned = readFields('---\nstatus: planned\nmanual: true\ndate: 2026-11-20T10:30\n---\nX\n');
  assert.equal(planned.ok && planned.status, 'planned');
  assert.equal(planned.ok && planned.manual, true);
});

test('a date that is not in the input format is shown empty, not guessed', () => {
  const parsed = readFields('---\ndate: 2026-11-20T10:30:00Z\n---\nX\n');
  assert.equal(parsed.ok && parsed.date, '');
});

test('a file the editor cannot read gives an error and the whole text as body', () => {
  assert.deepEqual(readFields('no frontmatter'), { ok: false, error: 'the file has no properties at the top (a block between two --- lines)', body: 'no frontmatter' });
  const broken = readFields('---\nkey: [unclosed\n---\nX\n');
  assert.equal(broken.ok, false);
  assert.equal(readFields('---\n- a\n---\nX\n').ok, false);
});

test('edits go through the text and keep everything else', () => {
  let text = withDate(raw, '2026-11-21T09:15');
  text = withManual(text, true);
  text = withStatus(text, 'planned');
  text = withBody(text, 'New text');
  assert.equal(text, '---\nstatus: planned\ndate: 2026-11-21T09:15\nimages: [a.jpg]\nmanual: true\n---\nNew text\n');
  assert.equal(withManual(text, false).includes('manual'), false);
  assert.equal(withDate(raw, ''), raw);
});

test('statusOfRaw is draft for anything it cannot read', () => {
  assert.equal(statusOfRaw('---\nstatus: planned\n---\nX'), 'planned');
  assert.equal(statusOfRaw('garbage'), 'draft');
  assert.equal(statusOfRaw('---\ndate: x\n---\nX'), 'draft');
});

test('the image list starts as a flow list, keeps a block list and disappears when empty', () => {
  assert.match(withImages(raw, ['b.jpg', 'a.jpg']), /\nimages: \[b\.jpg, a\.jpg\]\n/);
  const block = '---\ndate: 2026-11-20T10:30\nimages:\n  - a.jpg\n---\nX\n';
  assert.match(withImages(block, ['a.jpg', 'c.jpg']), /\nimages:\n {2}- a\.jpg\n {2}- c\.jpg\n/);
  assert.match(withImages('---\ndate: 2026-11-20T10:30\n---\nX\n', ['a.jpg']), /\nimages: \[a\.jpg\]\n---/);
  assert.equal(withImages(raw, []).includes('images'), false);
});

test('the title is written in place, trimmed away when empty, and quoted when YAML needs it', () => {
  const titled = withTitle('---\ntitle: Old\ndate: 2026-11-20T10:30\n---\nX\n', 'Expo: Stad van Morgen');
  assert.match(titled, /^---\ntitle: ['"]?Expo: Stad van Morgen['"]?\ndate:/);
  const read = readFields(titled);
  assert.equal(read.ok && read.title, 'Expo: Stad van Morgen');
  assert.equal(withTitle(titled, '  ').includes('title'), false);
});

test('withBody keeps the frontmatter byte for byte and only changes the body', () => {
  const raw = '---\nstatus: draft\ndate: 2026-11-20T10:30\nimages: [a.jpg]\n---\nOld\n';
  assert.equal(
    withBody(raw, '  New text\r\nsecond line  '),
    '---\nstatus: draft\ndate: 2026-11-20T10:30\nimages: [a.jpg]\n---\nNew text\nsecond line\n'
  );
  assert.throws(() => withBody('no frontmatter', 'x'), /no properties at the top/);
  assert.throws(() => withBody('---\nopen\n', 'x'), /not closed/);
});
