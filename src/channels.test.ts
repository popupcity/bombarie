import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { addChannel, channelInfos, channelPosts, loadChannels, removeChannel, renameChannel, resolveName } from './channels.ts';

const channels = {
  'popupcity-instagram': { platform: 'instagram' as const },
  'jeroen-linkedin': { platform: 'linkedin' as const }
};

test('resolveName picks the channel and the type', () => {
  assert.deepEqual(resolveName('popupcity-instagram', channels), {
    channel: 'popupcity-instagram',
    type: null
  });
  assert.deepEqual(resolveName('popupcity-instagram-story', channels), {
    channel: 'popupcity-instagram',
    type: 'story'
  });
  assert.equal(resolveName('popupcity-instagramm', channels), null);
  assert.equal(resolveName('unknown', channels), null);
});

test('a channel that prefixes another is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'social-'));
  writeFileSync(join(dir, 'channels.yml'), 'popupcity:\n  platform: linkedin\npopupcity-instagram:\n  platform: instagram\n');
  assert.throws(() => loadChannels(dir), /prefix/);
});

test('channels get a display name and an avatar from avatars/, with safe paths only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'social-channels-'));
  const write = (body: string) => {
    writeFileSync(join(dir, 'channels.yml'), body);
    return dir;
  };

  const channels = loadChannels(
    write('a-linkedin:\n  platform: linkedin\n  name: " Pop-Up City "\n  avatar: avatars/puc.jpg\nb-instagram:\n  platform: instagram\n')
  );
  assert.deepEqual(channelInfos(channels), [
    { name: 'b-instagram', platform: 'instagram', label: 'b-instagram' },
    { name: 'a-linkedin', platform: 'linkedin', label: 'Pop-Up City', avatar: 'avatars/puc.jpg' }
  ]);

  for (const bad of ['../secret.jpg', '/etc/passwd', 'posts/x.jpg', 'avatars/../x.jpg', 'avatars/x.svg', 'avatars/a/b.jpg']) {
    assert.throws(() => loadChannels(write(`a:\n  platform: linkedin\n  avatar: ${bad}\n`)), /avatar must be/);
  }
  assert.throws(() => loadChannels(write('a:\n  platform: linkedin\n  name: ""\n')), /non-empty/);
});

test('addChannel writes a new channel and refuses duplicates', async () => {
  const root = mkdtempSync(join(tmpdir(), 'social-'));
  writeFileSync(join(root, 'channels.yml'), 'jeroen-linkedin:\n  platform: linkedin\n  name: Jeroen\n');
  assert.equal(await addChannel(root, { platform: 'instagram', name: ' Pöppo Studio ' }), 'poppo-studio-instagram');
  const channels = loadChannels(root);
  assert.deepEqual(channels['poppo-studio-instagram'], { platform: 'instagram', name: 'Pöppo Studio' });
  assert.ok(readFileSync(join(root, 'channels.yml'), 'utf8').includes('\n\npoppo-studio-instagram:'));
  await assert.rejects(addChannel(root, { platform: 'instagram', name: 'poppo studio' }), /already/);
  await assert.rejects(addChannel(root, { platform: 'instagram', name: '!!!' }), /at least one letter/);
  await assert.rejects(addChannel(root, { platform: 'tiktok', name: 'x' }), /platform/);
});

test('a channel can be renamed, and removed only when no post uses it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'social-'));
  writeFileSync(join(root, 'channels.yml'), 'a-linkedin:\n  platform: linkedin\n  name: A\n\nb-instagram:\n  platform: instagram\n  name: B\n');
  mkdirSync(join(root, 'posts', '2026-11-20-x'), { recursive: true });
  writeFileSync(join(root, 'posts', '2026-11-20-x', 'a-linkedin.md'), '---\ndate: 2026-11-20T09:00\n---\nx');
  await renameChannel(root, 'a-linkedin', '  Alpha  ');
  assert.equal(loadChannels(root)['a-linkedin']?.name, 'Alpha');
  await assert.rejects(renameChannel(root, 'a-linkedin', '!!'), /at least one letter/);
  await assert.rejects(renameChannel(root, 'nope', 'X'), /unknown/);
  assert.equal(channelPosts(root, 'a-linkedin'), 1);
  await assert.rejects(removeChannel(root, 'a-linkedin'), /still uses this channel/);
  await removeChannel(root, 'b-instagram');
  assert.deepEqual(Object.keys(loadChannels(root)), ['a-linkedin']);
});

test('a channel without an avatar borrows the one of a channel with the same name', () => {
  const infos = channelInfos({
    'pop-instagram': { platform: 'instagram', name: 'Pop-Up City', avatar: 'avatars/pop.jpg' },
    'pop-linkedin': { platform: 'linkedin', name: 'Pop-Up City' },
    'someone': { platform: 'linkedin', name: 'Someone' }
  });
  assert.equal(infos.find((info) => info.name === 'pop-linkedin')?.avatar, 'avatars/pop.jpg');
  assert.equal(infos.find((info) => info.name === 'someone')?.avatar, undefined);
});

test('an empty folder has no channels, and the first channel creates channels.yml', async () => {
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { addChannel, loadChannels } = await import('./channels.ts');
  const root = mkdtempSync(join(tmpdir(), 'channels-empty-'));
  assert.deepEqual(loadChannels(root), {});
  assert.equal(await addChannel(root, { platform: 'threads', name: 'Studio' }), 'studio-threads');
  assert.match(readFileSync(join(root, 'channels.yml'), 'utf8'), /studio-threads:\n {2}platform: threads\n {2}name: Studio/);
  assert.deepEqual(Object.keys(loadChannels(root)), ['studio-threads']);
});

test('channels come in the order of their name, then in a fixed platform order', () => {
  const infos = channelInfos({
    'pop-threads': { platform: 'threads', name: 'Pop-Up City' },
    'poppo-instagram': { platform: 'instagram', name: 'PoPPo' },
    'pop-linkedin': { platform: 'linkedin', name: 'Pop-Up City' },
    'joop-linkedin': { platform: 'linkedin', name: 'Joop' },
    'jeroen-linkedin': { platform: 'linkedin', name: 'Jeroen' },
    'pop-instagram': { platform: 'instagram', name: 'pop-up city' }
  });
  assert.deepEqual(infos.map((info) => info.name), ['jeroen-linkedin', 'joop-linkedin', 'pop-linkedin', 'pop-instagram', 'pop-threads', 'poppo-instagram']);
});
