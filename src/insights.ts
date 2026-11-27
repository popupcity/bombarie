import type { Row } from './csv.ts';
import { ymd } from './time.ts';
import type { Platform } from './types.ts';

export const RANGES = { week: 7, month: 30, quarter: 90, year: 365, all: 0 } as const;
export type Range = keyof typeof RANGES;
export const SORTS = ['views', 'likes', 'replies', 'follows'] as const;
export type Sort = (typeof SORTS)[number];

export const rangeOf = (value: string | null | undefined): Range => (value && value in RANGES ? (value as Range) : 'month');
export const sortOf = (value: string | null | undefined): Sort => SORTS.find((sort) => sort === value) ?? 'views';
export const since = (range: Range, now: Date): string => (RANGES[range] === 0 ? '' : ymd(new Date(now.getTime() - (RANGES[range] - 1) * 86_400_000)));

export interface Point {
  date: string;
  value: number;
}

const series = (rows: Row[], column: string): Point[] => rows.flatMap((row) => (row[column] === undefined || row[column] === '' ? [] : [{ date: row.date!, value: Number(row[column]) }])).sort((a, b) => a.date.localeCompare(b.date));

export const METRICS = ['views', 'reach', 'followers'] as const;
export type Metric = (typeof METRICS)[number];
export const metricOf = (value: string | null | undefined): Metric => METRICS.find((metric) => metric === value) ?? 'views';

export const before = (range: Range, now: Date): string => (RANGES[range] === 0 ? '' : ymd(new Date(now.getTime() - (2 * RANGES[range] - 1) * 86_400_000)));
const within = (day: string, from: string, to?: string): boolean => day >= from && (to === undefined || day < to);

export interface Account {
  days: Row[];
  posts: Row[];
  platform: Platform;
}

export interface Followers {
  followers: number | null;
  change: number | null;
}

export function followersOf(days: Row[], from: string): Followers {
  const all = series(days, 'followers');
  const growth = all.filter((point) => point.date >= from);
  return { followers: all.at(-1)?.value ?? null, change: growth.length > 1 ? growth.at(-1)!.value - growth[0]!.value : null };
}

export const dailyOf = (days: Row[], column: 'views' | 'reach', from: string): Point[] => series(days, column).filter((point) => point.date >= from);

export function summed(accounts: Account[], column: 'views' | 'reach', from: string): Point[] {
  const found = new Map<string, number>();
  for (const account of accounts) for (const point of dailyOf(account.days, column, from)) found.set(point.date, (found.get(point.date) ?? 0) + point.value);
  return [...found].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

export function followerLine(accounts: Account[], from: string): Point[] {
  const lines = accounts.map((account) => new Map(series(account.days, 'followers').map((point) => [point.date, point.value]))).filter((line) => line.size > 0);
  if (lines.length === 0) return [];
  return [...lines[0]!.keys()].filter((date) => date >= from && lines.every((line) => line.has(date))).sort().map((date) => ({ date, value: lines.reduce((total, line) => total + line.get(date)!, 0) }));
}

const startOf = (days: Row[], column: string): string | undefined => series(days, column)[0]?.date;
const reaches = (start: string | undefined, from: string): boolean => start !== undefined && from !== '' && Date.parse(start) - Date.parse(from) <= 86_400_000;

export interface Total {
  value: number;
  change: number | null;
}

export function viewTotal(accounts: Account[], from: string, earlier: string): Total {
  const sum = (points: Point[]): number => points.reduce((total, point) => total + point.value, 0);
  const now = sum(summed(accounts, 'views', from));
  const comparable = from !== '' && accounts.length > 0 && accounts.every((account) => reaches(startOf(account.days, 'views'), earlier));
  return { value: now, change: comparable ? now - sum(summed(accounts, 'views', earlier).filter((point) => point.date < from)) : null };
}

export function engagement(accounts: Account[], from: string, earlier: string): Total & { posts: number } {
  const of = (start: string, end?: string): { value: number; posts: number } => {
    const rows = accounts.flatMap((account) => account.posts.filter((row) => within(ymd(new Date(row.date!)), start, end)).map((row) => Number(row.likes || 0) + Number((account.platform === 'instagram' ? row.comments : row.replies) || 0)));
    return { value: rows.reduce((total, value) => total + value, 0), posts: rows.length };
  };
  const now = of(from);
  return { ...now, change: from === '' ? null : now.value - of(earlier, from).value };
}

export interface Scale {
  low: number;
  high: number;
  lines: number[];
}

export function scale(values: number[], fromZero = true): Scale {
  const top = Math.max(...values, 0);
  const bottom = fromZero ? 0 : Math.min(...values);
  const rough = Math.max(top - bottom, 1) / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max([1, 2, 5, 10].find((factor) => factor * power >= rough)! * power, 1);
  const low = Math.floor(bottom / step) * step;
  const high = Math.max(Math.ceil(top / step) * step, low + step);
  return { low, high, lines: Array.from({ length: Math.round((high - low) / step) + 1 }, (_, index) => low + index * step) };
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

export function topPosts(sources: { channel: string; platform: Platform; posts: Row[] }[], sort: Sort, from: string): TopPost[] {
  const found = sources.flatMap(({ channel, platform, posts }) =>
    posts.flatMap((row) => {
      const day = ymd(new Date(row.date!));
      if (day < from) return [];
      const value = row[columnFor(sort, platform)];
      if (value === undefined || value === '') return [];
      return [{ channel, url: row.url!, day, type: kindOf(row.type ?? ''), text: row.text ?? '', value: Number(value) }];
    })
  );
  return found.sort((a, b) => b.value - a.value || b.day.localeCompare(a.day) || a.url.localeCompare(b.url));
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

const DAILY_UP_TO = 7;
const WEEKLY_UP_TO = 45;
const MONTHLY_UP_TO = 800;
const MOST_TICKS = 6;

export function axis(start: string, end: string): Axis {
  const first = dayNumber(start);
  const days = Math.max(dayNumber(end) - first + 1, 1);
  const at = (day: string): number => ((dayNumber(day) - first + 0.5) / days) * 100;
  const all = Array.from({ length: days }, (_, index) => dayOf(first + index));
  const said = (day: string, options: Intl.DateTimeFormatOptions): string => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { ...options, timeZone: 'UTC' });
  if (days <= DAILY_UP_TO) return { days, at, ticks: all.map((day) => ({ at: at(day), label: said(day, { weekday: 'short' }) })) };
  if (days <= WEEKLY_UP_TO) return { days, at, ticks: all.filter((_, index) => (days - 1 - index) % 7 === 0).map((day) => ({ at: at(day), label: said(day, { day: 'numeric', month: 'short' }) })) };
  const yearly = days > MONTHLY_UP_TO;
  const marks = all.filter((day) => day.endsWith(yearly ? '-01-01' : '-01'));
  const every = Math.max(Math.ceil(marks.length / MOST_TICKS), 1);
  const label = (day: string): string => (yearly ? day.slice(0, 4) : day.slice(5, 7) === '01' ? day.slice(0, 4) : said(day, { month: 'short' }));
  return { days, at, ticks: marks.filter((_, index) => index % every === 0).map((day) => ({ at: at(day), label: label(day) })) };
}

const ROLLING_DAYS = 7;
const MOST_POINTS = 180;

export function engagementLine(accounts: Account[], from: string, today: string): Point[] {
  const posts = accounts.flatMap((account) => account.posts.map((row) => ({ day: dayNumber(ymd(new Date(row.date!))), value: Number(row.likes || 0) + Number((account.platform === 'instagram' ? row.comments : row.replies) || 0) })));
  if (posts.length === 0) return [];
  const first = from ? dayNumber(from) : Math.min(...posts.map((post) => post.day));
  const last = dayNumber(today);
  const every = Math.max(Math.ceil((last - first + 1) / MOST_POINTS), 1);
  return Array.from({ length: Math.floor((last - first) / every) + 1 }, (_, index) => last - index * every)
    .reverse()
    .map((day) => ({ date: dayOf(day), value: posts.reduce((total, post) => total + (post.day > day - ROLLING_DAYS && post.day <= day ? post.value : 0), 0) }));
}

export const UNITS: Record<Range, 'day' | 'week' | 'month'> = { week: 'day', month: 'day', quarter: 'week', year: 'month', all: 'month' };
export type Unit = (typeof UNITS)[Range];

export function bucketOf(day: string, unit: Unit): string {
  if (unit === 'day') return day;
  if (unit === 'month') return `${day.slice(0, 7)}-01`;
  const number = dayNumber(day);
  return dayOf(number - ((new Date(number * DAY_MS).getUTCDay() + 6) % 7));
}

export function grouped(points: Point[], unit: Unit, take: 'sum' | 'last' = 'sum'): Point[] {
  const found = new Map<string, number>();
  for (const point of points) {
    const key = bucketOf(point.date, unit);
    found.set(key, take === 'last' ? point.value : (found.get(key) ?? 0) + point.value);
  }
  return [...found].map(([date, value]) => ({ date, value }));
}

function buckets(first: string, last: string, unit: Unit): string[] {
  const found: string[] = [];
  for (let day = bucketOf(first, unit); day <= last; ) {
    found.push(day);
    day = unit === 'month' ? bucketOf(dayOf(dayNumber(day) + 32), unit) : dayOf(dayNumber(day) + 7);
  }
  return found;
}

export function timeline(first: string, last: string, unit: Unit): Axis {
  if (unit === 'day') return axis(first, last);
  const all = buckets(first, last, unit);
  const at = (day: string): number => ((all.indexOf(bucketOf(day, unit)) + 0.5) / all.length) * 100;
  const marks = all.filter((day, index) => (unit === 'week' ? index > 0 && day.slice(0, 7) !== all[index - 1]!.slice(0, 7) : all.length <= 24 || day.slice(5, 7) === '01'));
  const every = Math.max(Math.ceil(marks.length / MOST_TICKS), 1);
  const label = (day: string): string => (unit === 'month' && (day.slice(5, 7) === '01' || all.length > 24) ? day.slice(0, 4) : new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }));
  return { days: all.length, at, ticks: marks.filter((_, index) => index % every === 0).map((day) => ({ at: at(day), label: label(day) })) };
}
