import type { APIRoute } from 'astro';
import { appsPath, secretOf } from '../../../src/secrets.ts';
import { renderPublic } from '../../../src/public-media.ts';
import { root } from '../../lib/data.ts';
import { serveBytes } from '../../lib/serve.ts';

export const GET: APIRoute = async ({ params, request }) => {
  const found = await renderPublic(root, secretOf(appsPath()), (params.path ?? '').split('/').map(decodeURIComponent));
  return found ? serveBytes(request, found.bytes, found.type, 'public, max-age=300') : new Response('not found', { status: 404 });
};
