import type { StateStore } from './state.ts';
import { clock, ymd } from './time.ts';
import type { Post } from './types.ts';

export type Notify = (text: string) => Promise<void>;

export interface Reminder {
  id: string;
  status: 'reminded' | 'would-remind' | 'error';
  message?: string;
}

const REMIND_WINDOW_MS = 24 * 60 * 60_000;
const MAX_TEXT = 1000;

export function reminderText(post: Post): string {
  const name = post.type ? `${post.channel} (${post.type})` : post.channel;
  const text = post.text.length > MAX_TEXT ? `${post.text.slice(0, MAX_TEXT)}…` : post.text;
  return [`Post now: ${name}`, `${ymd(post.date)} ${clock(post.date)}`, ...(text ? ['', text] : []), ...(post.link ? ['', `Link: ${post.link}`] : [])].join(
    '\n'
  );
}

export async function remind(posts: Post[], deps: { store: StateStore; notify: Notify; now: Date; dryRun?: boolean }): Promise<Reminder[]> {
  const results: Reminder[] = [];
  for (const post of posts) {
    if (post.status !== 'planned' || !post.manual) continue;
    const age = deps.now.getTime() - post.date.getTime();
    if (age < 0 || age > REMIND_WINDOW_MS) continue;
    try {
      if (await deps.store.get(post.id)) continue;
      if (deps.dryRun) {
        results.push({ id: post.id, status: 'would-remind', message: reminderText(post) });
        continue;
      }
      await deps.notify(reminderText(post));
      await deps.store.create(post.id, { status: 'reminded', at: deps.now.toISOString() });
      results.push({ id: post.id, status: 'reminded' });
    } catch (err) {
      results.push({ id: post.id, status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

export function telegram(token: string, chatId: string, fetchImpl: typeof fetch = fetch): Notify {
  return async (text) => {
    let res: Response;
    try {
      res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
      });
    } catch {
      throw new Error('Telegram request failed');
    }
    if (!res.ok) throw new Error(`Telegram sendMessage failed (${res.status})`);
  };
}
