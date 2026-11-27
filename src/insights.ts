import type { Row } from './csv.ts';
import { ymd } from './time.ts';
import type { Platform } from './types.ts';

export const RANGES = { '30': 30, '90': 90, '365': 365, all: 0 } as const;
export type Range = keyof typeof RANGES;
export const SORTS = ['views', 'likes', 'replies'] as const;
export type Sort = (typeof SORTS)[number];

export const rangeOf = (value: string | null | undefined): Range => (value && value in RANGES ? (value as Range) : '30');
export const sortOf = (value: string | null | undefined): Sort => SORTS.find((sort) => sort === value) ?? 'views';
export const since = (range: Range, now: Date): string => (RANGES[range] === 0 ? '' : ymd(new Date(now.getTime() - RANGES[range] * 86_400_000)));

export interface Point {
  date: string;
  value: number;
}

const series = (rows: Row[], column: string): Point[] => rows.flatMap((row) => (row[column] === undefined || row[column] === '' ? [] : [{ date: row.date!, value: Number(row[column]) }])).sort((a, b) => a.date.localeCompare(b.date));

export const DAILY: Partial<Record<Platform, { column: string; label: string }>> = {
  instagram: { column: 'reach', label: 'Reach per day' },
  threads: { column: 'views', label: 'Views per day' }
};

export interface Audience {
  followers: number | null;
  change: number | null;
  measuredSince: string | null;
  growth: Point[];
  daily: Point[];
  posts: number;
}

export function audience(days: Row[], posts: Row[], platform: Platform, from: string): Audience {
  const all = series(days, 'followers');
  const growth = all.filter((point) => point.date >= from);
  const column = DAILY[platform]?.column;
  return {
    followers: all.at(-1)?.value ?? null,
    change: growth.length > 1 ? growth.at(-1)!.value - growth[0]!.value : null,
    measuredSince: all[0]?.date ?? null,
    growth,
    daily: column ? series(days, column).filter((point) => point.date >= from) : [],
    posts: posts.filter((row) => ymd(new Date(row.date!)) >= from).length
  };
}

export interface TopPost {
  channel: string;
  url: string;
  day: string;
  type: string;
  text: string;
  value: number;
}

const columnFor = (sort: Sort, platform: Platform): string => (sort === 'replies' && platform === 'instagram' ? 'comments' : sort);

export function topPosts(sources: { channel: string; platform: Platform; posts: Row[] }[], sort: Sort, from: string): { posts: TopPost[]; unmeasured: number } {
  let unmeasured = 0;
  const found = sources.flatMap(({ channel, platform, posts }) =>
    posts.flatMap((row) => {
      const day = ymd(new Date(row.date!));
      if (day < from) return [];
      const value = row[columnFor(sort, platform)];
      if (value === undefined || value === '') {
        unmeasured += 1;
        return [];
      }
      return [{ channel, url: row.url!, day, type: kindOf(row.type ?? ''), text: row.text ?? '', value: Number(value) }];
    })
  );
  return { posts: found.sort((a, b) => b.value - a.value || b.day.localeCompare(a.day) || a.url.localeCompare(b.url)), unmeasured };
}

const KINDS: Record<string, string> = { TEXT_POST: 'Text', IMAGE: 'Image', VIDEO: 'Video', REEL: 'Reel', CAROUSEL_ALBUM: 'Carousel', AUDIO: 'Audio' };
export const kindOf = (type: string): string => KINDS[type] ?? 'Post';

const DAY_MS = 86_400_000;
const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / DAY_MS;
const dayOf = (number: number): string => new Date(number * DAY_MS).toISOString().slice(0, 10);

export interface Axis {
  days: number;
  at: (day: string) => number;
  ticks: { at: number; label: string }[];
}

const WEEKLY_UP_TO = 45;
const MONTHLY_UP_TO = 800;
const MOST_TICKS = 6;

export function axis(start: string, end: string): Axis {
  const first = dayNumber(start);
  const days = Math.max(dayNumber(end) - first + 1, 1);
  const at = (day: string): number => ((dayNumber(day) - first + 0.5) / days) * 100;
  const all = Array.from({ length: days }, (_, index) => dayOf(first + index));
  const said = (day: string, options: Intl.DateTimeFormatOptions): string => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { ...options, timeZone: 'UTC' });
  if (days <= WEEKLY_UP_TO) return { days, at, ticks: all.filter((_, index) => (days - 1 - index) % 7 === 0).map((day) => ({ at: at(day), label: said(day, { day: 'numeric', month: 'short' }) })) };
  const yearly = days > MONTHLY_UP_TO;
  const marks = all.filter((day) => day.endsWith(yearly ? '-01-01' : '-01'));
  const every = Math.max(Math.ceil(marks.length / MOST_TICKS), 1);
  const label = (day: string): string => (yearly ? day.slice(0, 4) : day.slice(5, 7) === '01' ? day.slice(0, 4) : said(day, { month: 'short' }));
  return { days, at, ticks: marks.filter((_, index) => index % every === 0).map((day) => ({ at: at(day), label: label(day) })) };
}
