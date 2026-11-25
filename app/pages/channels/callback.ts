import type { APIRoute } from 'astro';
import { completeConnect } from '../../lib/connect.ts';
import { root } from '../../lib/data.ts';

export const GET: APIRoute = async ({ url, redirect }) => {
  const name = await completeConnect(root, url.searchParams);
  return redirect(name ? `/channels/${encodeURIComponent(name)}` : '/channels', 302);
};
