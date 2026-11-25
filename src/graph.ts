import { ProviderError } from './types.ts';
import type { SendContext } from './types.ts';

export const GRAPH = 'https://graph.facebook.com/v23.0';
export const THREADS_GRAPH = 'https://graph.threads.com/v1.0';

const RATE_CODES = new Set([4, 17, 32, 613]);

export interface GraphRequest {
  query?: Record<string, string>;
  form?: Record<string, string>;
  body?: FormData;
  remove?: true;
}

export async function graph(context: SendContext, what: string, path: string, token: string, request: GraphRequest, final = false, base = GRAPH): Promise<Record<string, unknown>> {
  let url = `${base}/${path}`;
  let init: RequestInit = {};
  if (request.remove) {
    url = `${url}?${new URLSearchParams({ access_token: token })}`;
    init = { method: 'DELETE' };
  } else if (request.query) {
    url = `${url}?${new URLSearchParams({ ...request.query, access_token: token })}`;
  } else if (request.body) {
    request.body.append('access_token', token);
    init = { method: 'POST', body: request.body };
  } else {
    init = { method: 'POST', body: new URLSearchParams({ ...request.form, access_token: token }) };
  }
  let res: Response;
  try {
    res = await context.fetch(url, init);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new ProviderError(`${what} failed: ${cause}${final ? '; the post may have been posted' : ''}`, final ? 'unconfirmed' : 'transient');
  }
  const text = await res.text().catch(() => '');
  if (res.ok) {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  let code = 0;
  let detail = text.slice(0, 300);
  try {
    const error = (JSON.parse(text) as { error?: { code?: number; message?: string } }).error;
    code = error?.code ?? 0;
    detail = error?.message ?? detail;
  } catch {
    detail = text.slice(0, 300);
  }
  const message = `${what} failed (${res.status}): ${detail}`;
  if (res.status === 401 || res.status === 403 || code === 190) throw new ProviderError(message, 'auth');
  if (res.status === 429 || RATE_CODES.has(code)) throw new ProviderError(message, 'rate');
  if (res.status >= 500) throw new ProviderError(message, final ? 'unconfirmed' : 'transient');
  throw new ProviderError(message, 'invalid');
}
