import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { seal, vaultSecret } from './vault.ts';
import { credentialsFrom, readApp, readTokens, removeToken, tokensPath, writeApp, writeToken } from './secrets.ts';

const now = new Date('2026-11-20T09:00:00Z');
const fresh = () => join(mkdtempSync(join(tmpdir(), 'social-tokens-')), 'nested', 'tokens.json');

test('tokensPath prefers BOMBARIE_TOKENS and otherwise lives outside the repo', () => {
  assert.equal(tokensPath({ BOMBARIE_TOKENS: '/x/t.json' }), '/x/t.json');
  assert.match(tokensPath({}), /\.config\/social\/tokens\.json$/);
});

test('a missing file means no tokens', async () => {
  assert.deepEqual(await readTokens(fresh()), {});
  assert.equal(await credentialsFrom(fresh(), now)('a'), null);
});

test('tokens round-trip and the file is private', async () => {
  const path = fresh();
  await writeToken(path, 'a', { accessToken: 'tok', expiresAt: new Date('2027-01-10T00:00:00Z') });
  await writeToken(path, 'b', { accessToken: 'tok2', refreshToken: 'r' });
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(await readTokens(path), {
    a: { accessToken: 'tok', expiresAt: new Date('2027-01-10T00:00:00Z') },
    b: { accessToken: 'tok2', refreshToken: 'r' }
  });
  assert.equal(await removeToken(path, 'a'), true);
  assert.equal(await removeToken(path, 'a'), false);
  assert.deepEqual(Object.keys(await readTokens(path)), ['b']);
});

test('a file readable by others is refused', async () => {
  const path = fresh();
  await writeToken(path, 'a', { accessToken: 'tok' });
  chmodSync(path, 0o644);
  await assert.rejects(readTokens(path), /make it private/);
});

test('malformed files are refused', async () => {
  const path = fresh();
  await writeToken(path, 'a', { accessToken: 'tok' });
  writeFileSync(path, seal({ a: { accessToken: '' } }, vaultSecret()), { mode: 0o600 });
  await assert.rejects(readTokens(path), /is missing accessToken/);
  writeFileSync(path, seal({ a: { accessToken: 'x', expiresAt: 'soon' } }, vaultSecret()), { mode: 0o600 });
  await assert.rejects(readTokens(path), /not a date/);
});

test('an expired token throws with its date, a valid one is returned', async () => {
  const path = fresh();
  await writeToken(path, 'old', { accessToken: 't', expiresAt: new Date('2026-11-19T00:00:00Z') });
  await writeToken(path, 'new', { accessToken: 't', expiresAt: new Date('2026-12-19T00:00:00Z') });
  const credentials = credentialsFrom(path, now);
  await assert.rejects(credentials('old'), /expired on 2026-11-19/);
  assert.equal((await credentials('new'))?.accessToken, 't');
});

const appFile = () => join(mkdtempSync(join(tmpdir(), 'apps-')), 'apps.json');

test('an app is saved with mode 600 and read back, and another app is kept', async () => {
  const file = appFile();
  assert.equal(await readApp(file, 'linkedin'), null);
  await writeApp(file, 'linkedin', { clientId: ' abc ', clientSecret: 'sec' });
  await writeApp(file, 'other', { clientId: 'o', clientSecret: 'p' });
  assert.deepEqual(await readApp(file, 'linkedin'), { clientId: 'abc', clientSecret: 'sec' });
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(await readApp(file, 'other'), { clientId: 'o', clientSecret: 'p' });
});

test('empty or spaced values are refused and nothing is written', async () => {
  const file = appFile();
  await assert.rejects(writeApp(file, 'linkedin', { clientId: '', clientSecret: 'x' }), /both/);
  await assert.rejects(writeApp(file, 'linkedin', { clientId: 'a b', clientSecret: 'x' }), /without spaces/);
  assert.equal(await readApp(file, 'linkedin'), null);
});

test('a file readable by others is refused', async () => {
  const file = appFile();
  writeFileSync(file, '{}');
  chmodSync(file, 0o644);
  await assert.rejects(readApp(file, 'linkedin'), /readable by others/);
});

test('the file holds no readable token, and a plain or wrongly keyed file is refused', async () => {
  const path = fresh();
  await writeToken(path, 'a', { accessToken: 'secret-token-value' });
  assert.equal(readFileSync(path, 'utf8').includes('secret-token-value'), false);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(path, 'utf8'))).sort(), ['data', 'iv', 'salt', 'tag', 'v']);
  writeFileSync(path, JSON.stringify({ a: { accessToken: 'plain' } }), { mode: 0o600 });
  await assert.rejects(readTokens(path), /not encrypted/);
  writeFileSync(path, seal({ a: { accessToken: 'x' } }, 'another secret'), { mode: 0o600 });
  await assert.rejects(readTokens(path), /cannot decrypt/);
});

test('the secret is required in production and has a development value elsewhere', () => {
  assert.equal(vaultSecret({ BOMBARIE_SECRET: 'abc' }), 'abc');
  assert.equal(vaultSecret({}), 'development-only');
  assert.throws(() => vaultSecret({ NODE_ENV: 'production' }), /BOMBARIE_SECRET/);
});
