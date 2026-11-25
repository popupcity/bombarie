import type { APIRoute } from 'astro';
import { deleteReplyNow, json } from '../../../lib/data.ts';

export const POST: APIRoute = async ({ params, request }) => {
  const [folder = '', base = ''] = (params.path ?? '').split('/').map(decodeURIComponent);
  const payload: unknown = await request.json().catch(() => null);
  const { index, scope } = (payload ?? {}) as { index?: unknown; scope?: unknown };
  if (typeof index !== 'number' || (scope !== 'both' && scope !== 'local')) return json({ ok: false, text: 'index and scope are required' }, 400);
  return json(await deleteReplyNow(folder, base, index, scope === 'both'));
};
