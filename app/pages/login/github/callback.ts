import type { APIRoute } from 'astro';
import { githubLogin } from '../../../../src/github-login.ts';
import { writeUsers, appsPath } from '../../../../src/secrets.ts';
import { hasAdmin, roleOf } from '../../../../src/users.ts';
import { COOKIE, githubApp, sessionToken, setupOpen, STATE_COOKIE, users } from '../../../lib/auth.ts';

const back = (message: string) => `/login?error=${encodeURIComponent(message)}`;

export const GET: APIRoute = async ({ url, cookies, redirect, request }) => {
  const app = await githubApp();
  if (!app) return redirect('/setup', 302);
  const expected = cookies.get(STATE_COOKIE)?.value;
  cookies.delete(STATE_COOKIE, { path: '/login/github' });
  const code = url.searchParams.get('code');
  if (!expected || url.searchParams.get('state') !== expected || !code) return redirect(back('The sign-in did not start here. Try again.'), 302);
  const { clientId, clientSecret } = app;
  let login: string;
  try {
    login = await githubLogin({ clientId, clientSecret, code, redirectUri: `${url.origin}/login/github/callback` });
  } catch (err) {
    return redirect(back(err instanceof Error ? err.message : 'GitHub could not sign you in.'), 302);
  }
  const known = await users();
  if (!roleOf(known, login)) {
    if (hasAdmin(known) || !setupOpen()) return redirect(back(`${login} is not allowed to use this app.`), 302);
    await writeUsers(appsPath(), { [login]: 'admin' });
  }
  const secure = url.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  cookies.set(COOKIE, sessionToken(login), { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 30 * 24 * 60 * 60 });
  return redirect('/', 302);
};
