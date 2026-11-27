import type { APIRoute } from 'astro';
import { PlanBlocked, saveVariant, syncFolder } from '../../../../src/campaign.ts';
import { RevisionConflict } from '../../../../src/content-store.ts';
import { relinkIdeas } from '../../../../src/ideas.ts';
import { rearm } from '../../../../src/state.ts';
import { content, json, loadConnections, root, states } from '../../../lib/data.ts';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const [folder = '', base = ''] = (params.path ?? '').split('/').map(decodeURIComponent);
  const payload: unknown = await request.json().catch(() => null);
  const { raw, revision, sync } = (payload ?? {}) as { raw?: unknown; revision?: unknown; sync?: unknown };
  if (typeof raw !== 'string' || typeof revision !== 'string') return json({ error: 'raw and revision are required' }, 400);
  try {
    const variant = await saveVariant(root, content, folder, base, { raw, revision, by: locals.user }, new Date(), async (name) => (await loadConnections())[name] ?? null);
    const rearmed = variant.post ? await rearm(states, `${folder}/${base}.md`, variant.post) : false;
    const next = sync === false ? folder : await syncFolder(root, content, states, folder).catch(() => folder);
    if (next !== folder) await relinkIdeas(root, content, folder, next);
    return json({
      folder: next,
      rearmed,
      revision: variant.revision,
      error: variant.error,
      by: (variant.fields.ok && variant.fields.by) || null,
      due: variant.post?.date.toISOString() ?? null
    });
  } catch (err) {
    if (err instanceof RevisionConflict) {
      const current = await content.read(`posts/${folder}/${base}.md`);
      return json({ error: 'conflict', revision: current?.revision ?? null }, 409);
    }
    if (err instanceof PlanBlocked) return json({ error: 'planning blocked', problems: err.problems }, 422);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, message === 'post not found' ? 404 : 400);
  }
};
