import type { Preview } from './preview.ts';
import { sentence } from './text.ts';
import { parseDate, whenLabel } from './time.ts';
import type { Post } from './types.ts';

export const LATE_AFTER_MS = 60 * 60_000;

interface Due {
  ready: Post[];
  late: Post[];
}

export function due(posts: Post[], now: Date): Due {
  const ready: Post[] = [];
  const late: Post[] = [];
  for (const p of posts) {
    if (p.status !== 'planned' || p.manual || p.date > now) continue;
    (now.getTime() - p.date.getTime() > LATE_AFTER_MS ? late : ready).push(p);
  }
  return { ready, late };
}

export const postsNow = (args: { manual: boolean; connected: boolean; date: string; now: Date }): boolean =>
  !args.manual && args.connected && args.date !== '' && parseDate(args.date).getTime() <= args.now.getTime();

export const dateLabel = (date: string, planned: boolean, now: Date): string =>
  !planned && parseDate(date).getTime() <= now.getTime() ? 'Now' : whenLabel(date);

export interface Readiness {
  manual: boolean;
  date: string;
  images: number;
  needsImage?: boolean;
  immediate?: boolean;
  preview: Pick<Preview, 'length' | 'limit' | 'segments'>;
  connection: string | null;
  now: Date;
}

export function readiness({ manual, date, images, needsImage, immediate, preview, connection, now }: Readiness): string | null {
  if (date === '') return 'Pick a date and time.';
  if (manual) return null;
  if (!immediate && now.getTime() - parseDate(date).getTime() > LATE_AFTER_MS) return 'Pick a time in the future.';
  if (needsImage && images === 0) return 'Add an image first.';
  if (preview.length === 0 && images === 0) return 'Add text or an image first.';
  const over = preview.limit === undefined ? 0 : preview.length - preview.limit;
  if (over > 0) return `Shorten the text by ${over} ${over === 1 ? 'character' : 'characters'}.`;
  if (preview.segments.some((segment) => segment.kind === 'unknown')) return 'A mention has no entity yet. Create it or remove it.';
  if (connection) return `${sentence(connection)} Set Posting to Manual, or connect the channel.`;
  return null;
}
