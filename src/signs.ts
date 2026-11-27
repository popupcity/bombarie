import type { Channels } from './channels.ts';
import type { Row } from './csv.ts';
import { readStats } from './stats.ts';

const WINDOW_MS = 90 * 86_400_000;
const MOST = 3;
const ONE_IN = 4;

export function standoutPosts(posts: Row[], now: Date): Map<string, number> {
  const recent = posts.filter((row) => row.views !== undefined && row.views !== '' && now.getTime() - Date.parse(row.date!) <= WINDOW_MS);
  const best = recent.sort((a, b) => Number(b.views) - Number(a.views) || b.date!.localeCompare(a.date!)).slice(0, Math.min(MOST, Math.floor(recent.length / ONE_IN)));
  return new Map(best.filter((row) => Number(row.views) > 0).map((row) => [row.url!, Number(row.views)]));
}

export const readStars = (root: string, channels: Channels, now: Date): Map<string, number> => new Map(Object.keys(channels).flatMap((name) => [...standoutPosts(readStats(root, name, 'posts'), now)]));
