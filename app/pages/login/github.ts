import type { APIRoute } from 'astro';
import { randomBytes } from 'node:crypto';
import { githubAuthorizeUrl } from '../../../src/github-login.ts';
import { githubApp, STATE_COOKIE } from '../../lib/auth.ts';

export const GET: APIRoute = async ({ url, cookies, redirect, request }) => {
  const app = await githubApp();
  if (!app) return redirect('/setup', 302);
  const state = randomBytes(16).toString('hex');
  const secure = url.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  cookies.set(STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', secure, path: '/login/github', maxAge: 600 });
  return redirect(githubAuthorizeUrl(app.clientId, `${url.origin}/login/github/callback`, state), 302);
};
