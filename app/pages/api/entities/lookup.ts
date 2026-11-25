import type { APIRoute } from 'astro';
import { lookupPage, vanityFrom } from '../../../../src/linkedin-lookup.ts';
import { json } from '../../../lib/data.ts';

export const POST: APIRoute = async ({ request }) => {
  const { url = '' } = (await request.json().catch(() => ({}))) as { url?: string };
  const vanity = vanityFrom(String(url));
  if (!vanity) return json({ error: 'paste the address of a LinkedIn company page, like linkedin.com/company/pop-up-city' }, 400);
  try {
    return json(await lookupPage(vanity));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
};
