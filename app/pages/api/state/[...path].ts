import type { APIRoute } from 'astro';
import { forgetOutcome, getProgress, lastOutcome } from '../../../../src/progress.ts';
import { json, outcomeWording, states } from '../../../lib/data.ts';

export const GET: APIRoute = async ({ params }) => {
  const [folder = '', variant = ''] = (params.path ?? '').split('/').map(decodeURIComponent);
  if (!/^[^/\\.][^/\\]*$/.test(folder) || !/^[^/\\.][^/\\]*$/.test(variant)) return json({ error: 'not found' }, 404);
  const id = `${folder}/${variant}.md`;
  const state = await states.get(id);
  const outcome = lastOutcome(id);
  if (state?.status === 'posting') return json({ status: 'posting', progress: getProgress(id) });
  const settle = <T>(body: T): Response => {
    forgetOutcome(id);
    return json(body);
  };
  if (state?.status === 'posted') return settle({ status: 'posted', text: 'Posted.', url: state.url ?? null });
  if (state?.status === 'failed' || state?.status === 'unconfirmed') return settle({ status: state.status, text: outcomeWording(state.status, state.message) });
  if (outcome) return settle({ status: 'stopped', text: outcomeWording(outcome.status, outcome.message) });
  return json({ status: 'none' });
};
