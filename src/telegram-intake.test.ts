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
  assert.match(sent[0] ?? '', /^Saved to Ideas:\n\nRent a truck/);
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
