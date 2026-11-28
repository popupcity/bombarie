import { fromCsv } from './csv.ts';
import type { Row } from './csv.ts';
import type { FeedItem } from './feed.ts';
import { ymd } from './time.ts';
import { DAY_COLUMNS, POST_COLUMNS, readStats, saveAudience, statsFile, writeStats } from './stats.ts';

export const MAX_EXPORT_BYTES = 1024 * 1024;

const NOT_THIS = 'this is not an export of Substack with the subscribers per day, the views per day, the posts or the countries';
const PER_MONTH = 'these views are per month; choose a period of 90 days or less in Substack';
const POSTS_HEADER = 'title,post_date,audience,views,engagement_rate,signups,subscribes,estimated_value,open_rate';

const COUNTRIES_HEADER = 'location,free signups';

export const EXPORT_NAMES = { followers: 'Subscribers', views: 'Views', posts: 'Posts', countries: 'Countries' } as const;

export type Export = { kind: keyof typeof EXPORT_NAMES; rows: Row[] };

function parseCountries(lines: string[]): Row[] {
  if (lines.length === 0) throw new Error(NOT_THIS);
  return lines.map((line) => {
    const found = /^([A-Z]{2}),(\d{1,9})$/.exec(line);
    if (!found) throw new Error(NOT_THIS);
    return { place: found[1]!, count: found[2]! };
  });
}

const whole = (value: string | undefined): string => {
  if (!/^\d{1,9}$/.test(value ?? '')) throw new Error(NOT_THIS);
  return value!;
};

const rate = (value: string | undefined): string => {
  if (!/^(\d(\.\d+)?)?$/.test(value ?? '')) throw new Error(NOT_THIS);
  return value ?? '';
};

function parsePosts(text: string): Row[] {
  const rows = fromCsv(text).map((line) => {
    const date = line.post_date ?? '';
    if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(date) || !line.title) throw new Error(NOT_THIS);
    const signups = whole(line.signups);
    const subscribes = whole(line.subscribes);
    return { date, type: 'NEWSLETTER', text: line.title.replace(/\s+/g, ' ').trim(), views: whole(line.views), follows: String(Number(signups) + Number(subscribes)), signups, subscribes, engagement_rate: rate(line.engagement_rate), open_rate: rate(line.open_rate) };
  });
  if (rows.length === 0) throw new Error(NOT_THIS);
  return rows;
}

function parseDays(lines: string[], column: 'followers' | 'views'): Row[] {
  const found = new Map<string, string>();
  for (const line of lines) {
    const day = /^(\d{4})[/-](\d{2})[/-](\d{2}),(\d{0,9})$/.exec(line);
    if (!day) throw new Error(NOT_THIS);
    if (day[4] !== '') found.set(`${day[1]}-${day[2]}-${day[3]}`, day[4]!);
  }
  if (found.size === 0) throw new Error(NOT_THIS);
  if (column === 'views' && found.size > 1 && [...found.keys()].every((date) => date.endsWith('-01'))) throw new Error(PER_MONTH);
  return [...found].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, [column]: value }));
}

export function parseExport(text: string): Export {
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).filter((line) => line !== '');
  if (lines[0] === POSTS_HEADER) return { kind: 'posts', rows: parsePosts(clean) };
  if (lines[0] === COUNTRIES_HEADER) return { kind: 'countries', rows: parseCountries(lines.slice(1)) };
  if (lines[0] === 'Date,Views') return { kind: 'views', rows: parseDays(lines.slice(1), 'views') };
  return { kind: 'followers', rows: parseDays(lines, 'followers') };
}

export interface Publication {
  items: FeedItem[];
  feed?: string | undefined;
}

const same = (title: string): string => title.replace(/\s+/g, ' ').trim().toLowerCase();

export async function saveExport(root: string, channel: string, { kind, rows }: Export, publication: Publication = { items: [] }, day = ymd(new Date())): Promise<void> {
  if (kind === 'countries') {
    await saveAudience(root, channel, rows.map((row) => ({ date: day, kind: 'country' as const, place: row.place!, count: row.count! })));
    return;
  }
  if (kind === 'posts') {
    const links = new Map(publication.items.map((item) => [same(item.title), item.url]));
    const home = publication.feed ? new URL(publication.feed).origin : '';
    const posts = new Map(readStats(root, channel, 'posts').map((row) => [row.date!, row]));
    for (const row of rows) {
      const before = posts.get(row.date!)?.url;
      const url = links.get(same(row.text!)) ?? (before && !before.includes('#') ? before : `${home}/#${row.date}`);
      posts.set(row.date!, { ...row, url });
    }
    await writeStats(statsFile(root, channel, 'posts'), POST_COLUMNS.substack, [...posts.values()].sort((a, b) => a.date!.localeCompare(b.date!)));
    return;
  }
  const days = new Map(readStats(root, channel, 'days').map((row) => [row.date!, row]));
  for (const row of rows) days.set(row.date!, { ...days.get(row.date!), date: row.date!, [kind]: row[kind]! });
  await writeStats(statsFile(root, channel, 'days'), DAY_COLUMNS.substack, [...days.values()].sort((a, b) => a.date!.localeCompare(b.date!)));
}

export function countedTo(root: string, channel: string, kind: Export['kind']): string | undefined {
  const rows = kind === 'posts' ? readStats(root, channel, 'posts') : kind === 'countries' ? readStats(root, channel, 'audience') : readStats(root, channel, 'days').filter((row) => row[kind]);
  return rows.at(-1)?.date!.slice(0, 10);
}
