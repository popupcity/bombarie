import type { APIRoute } from 'astro';
import { randomBytes } from 'node:crypto';
import { githubAuthorizeUrl } from '../../../src/github-login.ts';
import { configured, github, STATE_COOKIE } from '../../lib/auth.ts';

export const GET: APIRoute = ({ url, cookies, redirect, request }) => {
  if (!configured()) return redirect('/login', 302);
  const state = randomBytes(16).toString('hex');
  const secure = url.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  cookies.set(STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', secure, path: '/login/github', maxAge: 600 });
  return redirect(githubAuthorizeUrl(github().clientId, `${url.origin}/login/github/callback`, state), 302);
};
