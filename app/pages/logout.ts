import type { APIRoute } from 'astro';
import { COOKIE } from '../lib/auth.ts';

export const GET: APIRoute = ({ cookies, redirect }) => {
  cookies.delete(COOKIE, { path: '/' });
  return redirect('/login', 302);
};
