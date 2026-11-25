import assert from 'node:assert/strict';
import { test } from 'node:test';
import { githubAuthorizeUrl, githubLogin, githubName } from './github-login.ts';

const args = { clientId: 'id', clientSecret: 'sec', code: 'abc', redirectUri: 'https://x.test/login/github/callback' };

function github(token: unknown, user: { ok?: boolean; body: unknown }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return url.includes('/login/oauth/access_token') ? Response.json(token) : Response.json(user.body, { status: user.ok === false ? 401 : 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test('the authorize address carries the app, the return address and the state, and asks for no scopes', () => {
  const url = new URL(githubAuthorizeUrl('id', 'https://x.test/cb', 's1'));
  assert.equal(url.origin + url.pathname, 'https://github.com/login/oauth/authorize');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['client_id', 'redirect_uri', 'state']);
});

test('the code is exchanged and only the user name is kept', async () => {
  const { calls, fetchImpl } = github({ access_token: 'gho_x' }, { body: { login: 'jeroenbeekmans', id: 5 } });
  assert.equal(await githubLogin(args, fetchImpl), 'jeroenbeekmans');
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { client_id: 'id', client_secret: 'sec', code: 'abc', redirect_uri: args.redirectUri });
  assert.equal((calls[1]?.init?.headers as Record<string, string>).Authorization, 'Bearer gho_x');
});

test('a refused code and an unknown user are errors', async () => {
  await assert.rejects(githubLogin(args, github({ error: 'bad_verification_code', error_description: 'The code is wrong' }, { body: {} }).fetchImpl), /The code is wrong/);
  await assert.rejects(githubLogin(args, github({ access_token: 't' }, { ok: false, body: { message: 'Bad credentials' } }).fetchImpl), /did not say who you are/);
});

test('a typed name is checked at GitHub and kept as GitHub writes it', async () => {
  assert.equal(await githubName('JoopDeBoer', github({}, { body: { login: 'joopdeboer' } }).fetchImpl), 'joopdeboer');
  await assert.rejects(githubName('nobody-here', (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch), /not a GitHub user/);
});
