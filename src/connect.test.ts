import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { authorizeUrl, connectProblem, sendProblem, exchangeCode, fetchProfile, finishFacebook, finishInstagram, finishLinkedin, metaAuthorizeUrl } from './connect.ts';
import { loadChannels, setChannelField } from './channels.ts';
import { readTokens } from './secrets.ts';

const now = new Date('2026-11-20T09:00:00Z');

test('authorizeUrl asks for the personal posting scopes only', () => {
  const url = new URL(authorizeUrl('cid', 'http://localhost:8787/callback', 'st'));
  assert.equal(url.origin + url.pathname, 'https://www.linkedin.com/oauth/v2/authorization');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    response_type: 'code',
    client_id: 'cid',
    redirect_uri: 'http://localhost:8787/callback',
    scope: 'openid profile w_member_social',
    state: 'st'
  });
});

test('exchangeCode posts the form and computes the expiry', async () => {
  let seen: { url: string; body: URLSearchParams } | undefined;
  const credentials = await exchangeCode(
    { clientId: 'cid', clientSecret: 'sec', code: 'abc', redirectUri: 'http://localhost:8787/callback', now },
    (async (url: string, init: RequestInit) => {
      seen = { url, body: init.body as URLSearchParams };
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 5184000 }), { status: 200 });
    }) as unknown as typeof fetch
  );
  assert.equal(seen?.url, 'https://www.linkedin.com/oauth/v2/accessToken');
  assert.deepEqual(Object.fromEntries(seen?.body ?? []), {
    grant_type: 'authorization_code',
    code: 'abc',
    client_id: 'cid',
    client_secret: 'sec',
    redirect_uri: 'http://localhost:8787/callback'
  });
  assert.deepEqual(credentials, { accessToken: 'tok', expiresAt: new Date('2027-01-19T09:00:00Z') });
});

test('exchangeCode and fetchProfile fail loudly', async () => {
  const bad = (async () => new Response('invalid_grant', { status: 400 })) as unknown as typeof fetch;
  await assert.rejects(
    exchangeCode({ clientId: 'c', clientSecret: 's', code: 'x', redirectUri: 'r', now }, bad),
    /token exchange failed \(400\): invalid_grant/
  );
  const empty = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(exchangeCode({ clientId: 'c', clientSecret: 's', code: 'x', redirectUri: 'r', now }, empty), /no access token/);
  await assert.rejects(fetchProfile('t', empty), /no sub/);
  const ok = (async () => new Response(JSON.stringify({ sub: 'abc', name: 'Jeroen' }), { status: 200 })) as unknown as typeof fetch;
  assert.deepEqual(await fetchProfile('t', ok), { sub: 'abc', name: 'Jeroen' });
});

test('setChannelField adds the urn and keeps comments and other channels', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'social-connect-'));
  const path = join(dir, 'channels', 'channels.yml');
  mkdirSync(join(dir, 'channels'), { recursive: true });
  writeFileSync(
    path,
    '# my channels\njeroen-linkedin:\n  platform: linkedin\n  kind: person\n\npopupcity-instagram:\n  platform: instagram\n'
  );
  await setChannelField(dir, 'jeroen-linkedin', 'urn', 'urn:li:person:abc');
  assert.equal(
    readFileSync(path, 'utf8'),
    '# my channels\njeroen-linkedin:\n  platform: linkedin\n  kind: person\n  urn: urn:li:person:abc\n\npopupcity-instagram:\n  platform: instagram\n'
  );
});

test('only a LinkedIn person channel or an Instagram channel can be connected', () => {
  assert.equal(connectProblem({ platform: 'linkedin', kind: 'person' }), null);
  assert.equal(connectProblem({ platform: 'linkedin' }), null);
  assert.match(connectProblem({ platform: 'linkedin', kind: 'organization' }) ?? '', /Community Management/);
  assert.match(connectProblem({ platform: 'substack' }) ?? '', /only LinkedIn, Instagram, Facebook and Threads/);
  assert.equal(connectProblem(undefined), 'unknown channel');
});

function flowRepo() {
  const root = mkdtempSync(join(tmpdir(), 'flow-'));
  mkdirSync(join(root, 'channels'), { recursive: true });
  writeFileSync(join(root, 'channels', 'channels.yml'), 'me-linkedin:\n  platform: linkedin\n  kind: person\n');
  const tokens = join(root, 'tokens.json');
  return { root, tokens, channel: loadChannels(root)['me-linkedin']! };
}

const linkedinFetch = ((url: string) =>
  Promise.resolve(
    url.includes('accessToken')
      ? new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
      : new Response(JSON.stringify({ sub: 'abc', name: 'Jeroen' }), { status: 200 })
  )) as unknown as typeof fetch;

test('finishing a connection saves the token and writes the urn when the channel has none', async () => {
  const { root, tokens, channel } = flowRepo();
  const done = await finishLinkedin({ root, name: 'me-linkedin', channel, clientId: 'c', clientSecret: 's', code: 'x', redirectUri: 'r', tokens, now, fetchImpl: linkedinFetch });
  assert.equal(done.urn, 'urn:li:person:abc');
  assert.equal(done.avatar, 'LinkedIn returned no profile picture');
  assert.equal((await readTokens(tokens))['me-linkedin']?.accessToken, 'tok');
  assert.match(readFileSync(join(root, 'channels', 'channels.yml'), 'utf8'), /urn: urn:li:person:abc/);
});

test('a login with another id than channels.yml replaces the urn, because the id differs per LinkedIn app', async () => {
  const { root, tokens } = flowRepo();
  const channel = { platform: 'linkedin', kind: 'person', urn: 'urn:li:person:other' } as const;
  const done = await finishLinkedin({ root, name: 'me-linkedin', channel, clientId: 'c', clientSecret: 's', code: 'x', redirectUri: 'r', tokens, now, fetchImpl: linkedinFetch });
  assert.equal(done.urn, 'urn:li:person:abc');
  assert.match(readFileSync(join(root, 'channels', 'channels.yml'), 'utf8'), /urn: urn:li:person:abc/);
  assert.equal((await readTokens(tokens))['me-linkedin']?.accessToken, 'tok');
});

const connectNow = new Date('2026-11-18T10:00:00Z');
const person = { platform: 'linkedin', kind: 'person', urn: 'urn:li:person:a' } as const;

test('a LinkedIn person with a live token is connected', () => {
  assert.equal(sendProblem(person, { accessToken: 't' }, connectNow), null);
  assert.equal(sendProblem(person, { accessToken: 't', expiresAt: new Date('2026-12-01T00:00:00Z') }, connectNow), null);
});

test('a missing or expired token is a problem, with the fix', () => {
  assert.match(sendProblem(person, undefined, connectNow) ?? '', /manual until you connect it/);
  assert.match(sendProblem(person, { accessToken: 't', expiresAt: new Date('2026-11-01T00:00:00Z') }, connectNow) ?? '', /expired on 2026-11-01/);
});

test('platforms without a sender and company pages are never connected', () => {
  assert.equal(sendProblem({ platform: 'instagram' }, { accessToken: 't' }, connectNow), null);
  assert.match(sendProblem({ platform: 'facebook' }, undefined, connectNow) ?? '', /manual until you connect it/);
  assert.match(sendProblem({ ...person, kind: 'organization' }, { accessToken: 't' }, connectNow) ?? '', /company page/);
});

test('substack is always manual', () => {
  assert.match(sendProblem({ platform: 'substack' }, undefined, connectNow) ?? '', /no posting API/);
});

const instagramFetch = (accounts: Record<string, unknown>[], scopes = ['instagram_basic', 'instagram_content_publish'], seen: string[] = []) =>
  (async (url: string) => {
    seen.push(String(url));
    if (String(url).startsWith('https://graph.facebook.com/v23.0/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'sys' }), { status: 200 });
    if (String(url).startsWith('https://graph.facebook.com/v23.0/debug_token')) return new Response(JSON.stringify({ data: { expires_at: 0, scopes } }), { status: 200 });
    if (String(url).startsWith('https://graph.facebook.com/v23.0/me/assigned_instagram_accounts')) return new Response(JSON.stringify({ data: accounts }), { status: 200 });
    return new Response('no', { status: 404 });
  }) as unknown as typeof fetch;

test('metaAuthorizeUrl uses the configuration id and no scope', () => {
  const url = new URL(metaAuthorizeUrl('app', 'cfg', 'https://popupcity.net/callback/', 'st'));
  assert.equal(url.origin + url.pathname, 'https://www.facebook.com/v23.0/dialog/oauth');
  assert.equal(url.searchParams.get('config_id'), 'cfg');
  assert.equal(url.searchParams.get('override_default_response_type'), 'true');
  assert.equal(url.searchParams.get('scope'), null);
  assert.equal(url.searchParams.get('client_id'), 'app');
});

test('finishInstagram saves the system-user token without expiry, the account id and the handle', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'social-ig-'));
  mkdirSync(join(dir, 'channels'), { recursive: true });
  writeFileSync(join(dir, 'channels', 'channels.yml'), 'pop-instagram:\n  platform: instagram\n  name: Pop\n');
  const channel = loadChannels(dir)['pop-instagram']!;
  const done = await finishInstagram({ root: dir, name: 'pop-instagram', channel, clientId: 'a', clientSecret: 's', code: 'abc', redirectUri: 'r', tokens: join(dir, 'tokens.json'), now, fetchImpl: instagramFetch([{ id: '178', username: 'popupcity' }]) });
  assert.equal(done.username, 'popupcity');
  assert.equal(done.expiresAt, undefined);
  assert.equal(done.handleWritten, true);
  assert.equal(loadChannels(dir)['pop-instagram']?.handle, 'popupcity');
  const token = (await readTokens(join(dir, 'tokens.json')))['pop-instagram'];
  assert.equal(token?.accessToken, 'sys');
  assert.equal(token?.accountId, '178');
  assert.equal(token?.expiresAt, undefined);
});

test('finishInstagram picks the account of the handle, and refuses missing scopes, no accounts and a wrong handle', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'social-ig-'));
  mkdirSync(join(dir, 'channels'), { recursive: true });
  writeFileSync(join(dir, 'channels', 'channels.yml'), 'pop-instagram:\n  platform: instagram\n  handle: popupcity\n');
  const channel = loadChannels(dir)['pop-instagram']!;
  const base = { root: dir, name: 'pop-instagram', channel, clientId: 'a', clientSecret: 's', code: 'c', redirectUri: 'r', tokens: join(dir, 'tokens.json'), now };
  const both = [{ id: '1', username: 'other' }, { id: '178', username: 'popupcity' }];
  await finishInstagram({ ...base, fetchImpl: instagramFetch(both) });
  assert.equal((await readTokens(join(dir, 'tokens.json')))['pop-instagram']?.accountId, '178');
  await assert.rejects(finishInstagram({ ...base, tokens: join(dir, 'x.json'), fetchImpl: instagramFetch(both, ['instagram_basic']) }), /does not include instagram_content_publish/);
  await assert.rejects(finishInstagram({ ...base, tokens: join(dir, 'x.json'), fetchImpl: instagramFetch([]) }), /shared no Instagram account/);
  await assert.rejects(finishInstagram({ ...base, tokens: join(dir, 'x.json'), fetchImpl: instagramFetch([{ id: '1', username: 'other' }]) }), /none of the shared accounts .* is @popupcity/);
});

test('instagram, facebook and threads channels can be connected', () => {
  assert.equal(connectProblem({ platform: 'instagram' }), null);
  assert.equal(connectProblem({ platform: 'facebook' }), null);
  assert.equal(connectProblem({ platform: 'threads' }), null);
  assert.match(connectProblem({ platform: 'substack' }) ?? '', /only LinkedIn, Instagram, Facebook and Threads/);
});

const pageFetch = (assigned: Record<string, unknown>[], accounts: Record<string, unknown>[] = [], scopes = ['pages_manage_posts']) =>
  (async (url: string) => {
    if (String(url).startsWith('https://graph.facebook.com/v23.0/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'sys' }), { status: 200 });
    if (String(url).startsWith('https://graph.facebook.com/v23.0/debug_token')) return new Response(JSON.stringify({ data: { expires_at: 0, scopes } }), { status: 200 });
    if (String(url).startsWith('https://graph.facebook.com/v23.0/me/assigned_pages')) return new Response(JSON.stringify({ data: assigned }), { status: 200 });
    if (String(url).startsWith('https://graph.facebook.com/v23.0/me/accounts')) return new Response(JSON.stringify({ data: accounts }), { status: 200 });
    return new Response('no', { status: 404 });
  }) as unknown as typeof fetch;

test('finishFacebook saves the page token and id and writes the page into channels.yml', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'social-fb-'));
  mkdirSync(join(dir, 'channels'), { recursive: true });
  writeFileSync(join(dir, 'channels', 'channels.yml'), 'pop-facebook:\n  platform: facebook\n');
  const channel = loadChannels(dir)['pop-facebook']!;
  const done = await finishFacebook({ root: dir, name: 'pop-facebook', channel, clientId: 'a', clientSecret: 's', code: 'c', redirectUri: 'r', tokens: join(dir, 'tokens.json'), now, fetchImpl: pageFetch([{ id: '55', name: 'Pop-Up City', access_token: 'pagetok' }]) });
  assert.equal(done.pageName, 'Pop-Up City');
  assert.equal(loadChannels(dir)['pop-facebook']?.page, '55');
  const token = (await readTokens(join(dir, 'tokens.json')))['pop-facebook'];
  assert.equal(token?.accessToken, 'pagetok');
  assert.equal(token?.accountId, '55');
});

test('finishFacebook falls back to /me/accounts, picks by page id or name, and refuses the rest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'social-fb-'));
  mkdirSync(join(dir, 'channels'), { recursive: true });
  writeFileSync(join(dir, 'channels', 'channels.yml'), 'pop-facebook:\n  platform: facebook\n  name: Pop-Up City\n');
  const channel = loadChannels(dir)['pop-facebook']!;
  const base = { root: dir, name: 'pop-facebook', channel, clientId: 'a', clientSecret: 's', code: 'c', redirectUri: 'r', tokens: join(dir, 'tokens.json'), now };
  const pages = [{ id: '1', name: 'Other', access_token: 't1' }, { id: '55', name: 'pop-up city', access_token: 't55' }];
  await finishFacebook({ ...base, fetchImpl: pageFetch([], pages) });
  assert.equal((await readTokens(join(dir, 'tokens.json')))['pop-facebook']?.accountId, '55');
  await assert.rejects(finishFacebook({ ...base, tokens: join(dir, 'x.json'), fetchImpl: pageFetch([], []) }), /shared no Facebook page/);
  await assert.rejects(finishFacebook({ ...base, tokens: join(dir, 'x.json'), fetchImpl: pageFetch(pages, [], []) }), /does not include pages_manage_posts/);
  await assert.rejects(finishFacebook({ ...base, channel: { platform: 'facebook', name: 'Nope' }, tokens: join(dir, 'x.json'), fetchImpl: pageFetch(pages) }), /several pages were shared/);
  await assert.rejects(finishFacebook({ ...base, channel: { platform: 'facebook', page: '9' }, tokens: join(dir, 'x.json'), fetchImpl: pageFetch(pages) }), /has the id 9/);
});
