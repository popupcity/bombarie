import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileContentStore } from './content-store.ts';
import { listIdeas } from './ideas.ts';
import { handleUpdate, webhookSecret } from './telegram-intake.ts';

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'telegram-'));
  const sent: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/sendMessage')) sent.push(String(JSON.parse(String(init?.body)).text));
    return Response.json({});
  }) as unknown as typeof fetch;
  return { root, sent, intake: { root, store: fileContentStore(root), token: 't', chat: '42', origin: 'https://x.test', fetchImpl } };
};

test('a message from the owner becomes an idea and gets a reply with its address', async () => {
  const { root, sent, intake } = setup();
  assert.equal(await handleUpdate({ message: { chat: { id: 42 }, text: 'Rent a truck, hang art in it' } }, intake), 'saved');
  assert.equal(listIdeas(root).length, 1);
  assert.match(sent[0] ?? '', /^Saved to Ideas: Rent a truck/);
});

test('a message from anyone else is ignored and nothing is saved', async () => {
  const { root, sent, intake } = setup();
  assert.equal(await handleUpdate({ message: { chat: { id: 7 }, text: 'hello' } }, intake), 'ignored');
  assert.equal(listIdeas(root).length, 0);
  assert.equal(sent.length, 0);
});

test('the webhook secret depends on the token and is a valid secret token', () => {
  assert.match(webhookSecret('abc'), /^[0-9a-f]{48}$/);
  assert.notEqual(webhookSecret('abc'), webhookSecret('abd'));
});

test('a command is answered and never saved as an idea', async () => {
  const { root, sent, intake } = setup();
  for (const text of ['/start', '/nope']) assert.equal(await handleUpdate({ message: { chat: { id: 42 }, text } }, intake), 'answered');
  assert.equal(listIdeas(root).length, 0);
  assert.match(sent[0] ?? '', /saved as an idea[\s\S]*\/planned/);
});

test('/planned lists the next five planned posts, soonest first, without past, draft or already handled ones', async () => {
  const { root, sent, intake } = setup();
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(join(root, 'channels'), { recursive: true });
  writeFileSync(join(root, 'channels', 'channels.yml'), 'jeroen-linkedin:\n  platform: linkedin\n  name: Jeroen\n');
  const add = (day: number, status = 'planned') => {
    const folder = join(root, 'posts', `2026-12-${String(day).padStart(2, '0')}-p${day}`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'jeroen-linkedin.md'), `---\nstatus: ${status}\ndate: 2026-12-${String(day).padStart(2, '0')}T09:00\ntitle: Post ${day}\n---\nHi\n`);
    return folder;
  };
  [1, 8, 7, 6, 5, 4, 9].forEach((day) => add(day));
  add(3, 'draft');
  writeFileSync(join(add(2), 'jeroen-linkedin.state.json'), JSON.stringify({ status: 'posted', at: '2026-12-02T09:00:00Z', remoteId: 'x' }));
  assert.equal(await handleUpdate({ message: { chat: { id: 42 }, text: '/planned@bombarie_bot' } }, { ...intake, now: new Date('2026-12-01T12:00:00Z') }), 'answered');
  assert.deepEqual(sent.map((text) => text.split('\n')[0]!.split(': ').pop()), ['Post 4', 'Post 5', 'Post 6', 'Post 7', 'Post 8']);
  assert.match(sent[0]!, /^Planned for \w{3} 4 Dec at 09:00 on Jeroen's LinkedIn: Post 4/);
  assert.match(sent[0] ?? '', /Jeroen's LinkedIn/);
});
