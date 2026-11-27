import assert from 'node:assert/strict';
import { test } from 'node:test';
import { removeReply } from './reply.ts';
import { speakers } from './speaker.ts';
import { fileStore } from './state.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Channels } from './channels.ts';

const channels: Channels = {
  'jeroen-linkedin': { platform: 'linkedin', urn: 'urn:li:person:jeroen', name: 'Jeroen' },
  'joop-linkedin': { platform: 'linkedin', urn: 'urn:li:person:joop', name: 'Joop' },
  'puc-linkedin': { platform: 'linkedin', kind: 'organization', urn: 'urn:li:organization:1' }
};
const credentials = async (key: string) => (key === 'puc-linkedin' ? null : { accessToken: `token-${key}` });

test('only a connected personal LinkedIn channel can speak', async () => {
  const speak = speakers(channels, credentials);
  assert.deepEqual(await speak('joop-linkedin'), { urn: 'urn:li:person:joop', credentials: { accessToken: 'token-joop-linkedin' } });
  await assert.rejects(speak('puc-linkedin'), /not a connected personal/);
  await assert.rejects(speak('nobody-linkedin'), /not a connected personal/);
  await assert.rejects(speakers(channels, async () => null)('joop-linkedin'), /Joop is not connected/);
});

test('a comment is deleted by the account that posted it, and the rest keep their author', async () => {
  const store = fileStore(mkdtempSync(join(tmpdir(), 'social-speaker-')));
  await store.create('f/jeroen-linkedin.md', { status: 'posted', at: '2026-11-27T10:00:00Z', remoteId: 'urn:li:share:1', replies: { count: 2, ids: ['11', '12'], by: ['joop-linkedin', ''] } });
  const seen: string[] = [];
  const provider = { removeReply: async (_input: unknown, channel: { urn?: string }, used: { accessToken: string }) => void seen.push(`${channel.urn} ${used.accessToken}`) };
  const deps = { store, channels, credentials, fetch, providers: { linkedin: provider } } as never;
  await removeReply('f/jeroen-linkedin.md', 'jeroen-linkedin', 0, true, deps);
  assert.deepEqual(seen, ['urn:li:person:joop token-joop-linkedin']);
  const state = await store.get('f/jeroen-linkedin.md');
  assert.deepEqual(state?.status === 'posted' ? state.replies : null, { count: 1, ids: ['12'], last: '12' });
});
