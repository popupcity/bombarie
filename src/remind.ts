import type { Channels } from './channels.ts';
import type { StateStore } from './state.ts';
import type { Message, Notify } from './telegram.ts';
import { PLATFORM_LABEL } from './types.ts';
import type { Post } from './types.ts';

export interface Reminder {
  id: string;
  status: 'reminded' | 'would-remind' | 'error';
  message?: string;
}

const REMIND_WINDOW_MS = 24 * 60 * 60_000;

const folderOf = (post: Post): string => post.id.split('/')[0] ?? post.id;

export function reminderMessages(post: Post, { channels, title, base }: { channels: Channels; title?: string | undefined; base?: string | undefined }): Message[] {
  const channel = channels[post.channel];
  const where = channel ? `${channel.name ?? post.channel}'s ${PLATFORM_LABEL[channel.platform]}` : post.channel;
  const head: Message = { text: [`Time to post on ${where}${post.type ? ` (${post.type})` : ''}:`, ...(title ? ['', title] : [])].join('\n'), ...(title && { bold: title }) };
  const path = post.id.replace(/\.md$/, '').split('/').map(encodeURIComponent).join('/');
  const view = base ? { view: `${base}/posts/${path}` } : {};
  const copy = [post.text, post.link ?? ''].filter(Boolean).join('\n\n');
  return copy ? [head, { text: copy, ...view }] : [{ ...head, ...view }];
}

export async function remind(
  posts: Post[],
  deps: { store: StateStore; notify: Notify; now: Date; channels: Channels; base?: string | undefined; dryRun?: boolean }
): Promise<Reminder[]> {
  const results: Reminder[] = [];
  for (const post of posts) {
    if (post.status !== 'planned' || !post.manual) continue;
    const age = deps.now.getTime() - post.date.getTime();
    if (age < 0 || age > REMIND_WINDOW_MS) continue;
    try {
      if (await deps.store.get(post.id)) continue;
      const title = post.title || posts.find((other) => other.title && folderOf(other) === folderOf(post))?.title;
      const [head, ...rest] = reminderMessages(post, { channels: deps.channels, title, base: deps.base });
      if (deps.dryRun) {
        results.push({ id: post.id, status: 'would-remind', message: [head!, ...rest].map((message) => message.text).join('\n\n') });
        continue;
      }
      await deps.notify(head!);
      await deps.store.create(post.id, { status: 'reminded', at: deps.now.toISOString() });
      for (const message of rest) await deps.notify(message);
      results.push({ id: post.id, status: 'reminded' });
    } catch (err) {
      results.push({ id: post.id, status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
