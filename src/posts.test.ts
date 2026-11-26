import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parsePost, readPosts } from './posts.ts';

const channels = {
  'popupcity-instagram': { platform: 'instagram' as const },
  'jeroen-linkedin': { platform: 'linkedin' as const }
};

test('the example posts are read, bad files are reported without hiding the rest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'social-'));
  const folder = join(dir, 'posts', '2026-11-20-test');
  mkdirSync(folder, { recursive: true });
  mkdirSync(join(dir, 'entities'));
  writeFileSync(join(dir, 'entities', 'pop-up-city.md'), '---\nname: Pop-Up City\nlinkedin: urn:li:organization:1\n---\n');
  writeFileSync(join(folder, 'jeroen-linkedin.md'), '---\nstatus: planned\ndate: 2026-11-20T10:30\n---\nHallo [[pop-up city]]\n');
  writeFileSync(join(folder, 'popupcity-instagram-story.md'), '---\nmanual: true\ndate: 2026-11-20T12:00\n---\n');
  writeFileSync(join(folder, 'popupcity-instagram.md'), '---\ndate: 2026-11-20T09:00\n---\nMet **vet**\n');
  writeFileSync(join(folder, 'nobody.md'), '---\ndate: 2026-11-20T09:00\n---\nx\n');
  writeFileSync(join(folder, 'popupcity-instagram-reel.md'), '---\ndate: 2026-11-20T09:00\nmedia: [missing.jpg]\n---\nx\n');

  const { posts, errors } = readPosts(dir, channels);
  assert.deepEqual(
    posts.map((p) => [p.channel, p.type, p.status, p.manual]),
    [
      ['jeroen-linkedin', null, 'planned', false],
      ['popupcity-instagram', 'story', 'draft', true]
    ]
  );
  assert.equal(posts[0]?.text, 'Hallo Pop-Up City');
  assert.deepEqual(posts[0]?.mentions, { 'Pop-Up City': 'urn:li:organization:1' });
  assert.equal(errors.length, 3);
  assert.ok(errors.some((e) => e.includes('no channel matches')));
  assert.ok(errors.some((e) => e.includes('"**"')));
  assert.ok(errors.some((e) => e.includes('missing.jpg')));
});

test('an empty text is fine for a draft and an error once planned, unless it is a reminder', () => {
  const make = (head: string) =>
    parsePost({ id: 'f/a.md', folder: '/nonexistent', text: `---\n${head}date: 2026-11-20T10:00\n---\n\n`, channel: 'a', type: null, platform: 'linkedin', entities: new Map() });
  assert.equal(make('').status, 'draft');
  assert.throws(() => make('status: planned\n'), /text is empty/);
  assert.equal(make('status: planned\nmanual: true\n').manual, true);
});
