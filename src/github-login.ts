export const githubAuthorizeUrl = (clientId: string, redirectUri: string, state: string): string =>
  `https://github.com/login/oauth/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state })}`;

export async function githubName(name: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(`https://api.github.com/users/${encodeURIComponent(name)}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'bombarie' } });
  if (response.status === 404) throw new Error(`${name} is not a GitHub user`);
  const user = (await response.json().catch(() => ({}))) as { login?: unknown };
  if (!response.ok || typeof user.login !== 'string') throw new Error('GitHub did not answer; try again');
  return user.login;
}

export async function githubLogin(args: { clientId: string; clientSecret: string; code: string; redirectUri: string }, fetchImpl: typeof fetch = fetch): Promise<string> {
  const exchanged = await fetchImpl('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: args.clientId, client_secret: args.clientSecret, code: args.code, redirect_uri: args.redirectUri })
  });
  const token = (await exchanged.json().catch(() => ({}))) as { access_token?: unknown; error_description?: unknown };
  if (typeof token.access_token !== 'string') throw new Error(`GitHub refused the sign-in${typeof token.error_description === 'string' ? `: ${token.error_description}` : ''}`);
  const response = await fetchImpl('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'bombarie' }
  });
  const user = (await response.json().catch(() => ({}))) as { login?: unknown };
  if (!response.ok || typeof user.login !== 'string' || user.login === '') throw new Error('GitHub did not say who you are');
  return user.login;
}
