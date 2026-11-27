import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Channels } from './channels.ts';
import { fromCsv, toCsv } from './csv.ts';
import type { Row } from './csv.ts';
import { GRAPH, THREADS_GRAPH, graph } from './graph.ts';
import { ymd } from './time.ts';
import { ProviderError } from './types.ts';
import type { Credentials, Platform, SendContext } from './types.ts';

const THREADS_NUMBERS = ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'];
const INSTAGRAM_NUMBERS: Record<string, string> = { views: 'views', reach: 'reach', saved: 'saved', shares: 'shares', total_interactions: 'interactions' };
const FOLLOW_NUMBERS = ['follows', 'profile_visits'];
const STORY_NUMBERS: Record<string, string> = { views: 'views', reach: 'reach', replies: 'replies', shares: 'shares', total_interactions: 'interactions' };

export const DAY_COLUMNS = { threads: ['date', 'followers', 'views'], instagram: ['date', 'followers', 'new_followers', 'views', 'reach'] };
export const POST_COLUMNS = {
  threads: ['date', 'url', 'type', 'text', ...THREADS_NUMBERS, 'updated'],
  instagram: ['date', 'url', 'type', 'text', 'views', 'reach', 'likes', 'comments', 'saved', 'shares', 'interactions', ...FOLLOW_NUMBERS, 'updated']
};
export const STORY_COLUMNS = ['date', 'url', 'type', ...Object.values(STORY_NUMBERS), 'updated'];

const DAY_MS = 86_400_000;
const INSIDE_MS = 60 * 60_000;
const BACKFILL_DAYS = 90;
const WINDOW_DAYS = 30;
const OVERLAP_DAYS = 4;
const FRESH_DAYS = 30;
const MAX_PAGES = 100;
const RETRY_MS = 60 * 60_000;
const STORY_MS = 2 * 60 * 60_000;
const TEXT_LENGTH = 100;
export const BATCH = 60;

type Name = 'days' | 'posts' | 'stories';

export const statsFile = (root: string, channel: string, name: Name): string => join(root, 'channels', channel, `${name}.csv`);

export const readStats = (root: string, channel: string, name: Name): Row[] => {
  const file = statsFile(root, channel, name);
  return existsSync(file) ? fromCsv(readFileSync(file, 'utf8')) : [];
};

async function write(file: string, columns: string[], rows: Row[]): Promise<void> {
  const text = toCsv(columns, rows);
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, text);
  await rename(`${file}.tmp`, file);
}

const byDate = (a: Row, b: Row): number => a.date!.localeCompare(b.date!) || (a.url ?? '').localeCompare(b.url ?? '');

interface Metric {
  name: string;
  total_value?: { value?: number };
  values?: { value?: number; end_time?: string }[];
}

interface Listed {
  id: string;
  timestamp: string;
  permalink?: string;
  media_type?: string;
  media_product_type?: string;
  text?: string;
  caption?: string;
  like_count?: number;
  comments_count?: number;
}

const seconds = (time: number): string => String(Math.floor(time / 1000));
const stops = (err: unknown): boolean => !(err instanceof ProviderError) || err.code !== 'invalid' || /permission/i.test(err.message);
const numberOf = (metric: Metric): number | undefined => metric.values?.[0]?.value ?? metric.total_value?.value;
const firstLine = (text: string | undefined): string => (text ?? '').split('\n')[0]!.slice(0, TEXT_LENGTH);

function client(credentials: Credentials, fetchImpl: typeof fetch, base: string, what: string) {
  const user = credentials.accountId;
  if (!user) throw new ProviderError('this channel has no account id; use Connect again on the Channels page', 'invalid');
  const read = (path: string, query: Record<string, string>) => graph({ fetch: fetchImpl } as SendContext, what, path, credentials.accessToken, { query }, false, base);
  const metrics = async (path: string, query: Record<string, string>): Promise<Metric[]> => ((await read(path, query)).data ?? []) as Metric[];
  const list = async (path: string, fields: string): Promise<Listed[]> => {
    const found: Listed[] = [];
    let after: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const answer = await read(path, { fields, limit: '100', ...(after && { after }) });
      found.push(...((answer.data ?? []) as Listed[]));
      const paging = answer.paging as { next?: string; cursors?: { after?: string } } | undefined;
      after = paging?.next ? paging.cursors?.after : undefined;
      if (!after) break;
    }
    return found;
  };
  return { user, read, metrics, list };
}

function daysOf(root: string, channel: string) {
  const days = new Map(readStats(root, channel, 'days').map((row) => [row.date!, row]));
  return {
    first: days.size === 0,
    day: (date: string): Row => days.get(date) ?? days.set(date, { date }).get(date)!,
    save: (columns: string[]) => write(statsFile(root, channel, 'days'), columns, [...days.values()].sort(byDate))
  };
}

interface Due {
  row: Row;
  id: string;
}

async function refresh(root: string, channel: string, columns: string[], posts: { listed: Listed; row: Row }[], now: Date, slowDays: number, batch: number, numbers: (id: string, row: Row) => Promise<void>): Promise<number> {
  const today = ymd(now);
  const due: Due[] = posts
    .filter(({ row }) => {
      if (!row.updated) return true;
      const young = now.getTime() - Date.parse(row.date!) < FRESH_DAYS * DAY_MS;
      return young ? row.updated !== today : Date.parse(today) - Date.parse(row.updated) >= slowDays * DAY_MS;
    })
    .sort((a, b) => Number(Boolean(a.row.updated)) - Number(Boolean(b.row.updated)) || b.row.date!.localeCompare(a.row.date!))
    .map(({ listed, row }) => ({ row, id: listed.id }));
  const rows = posts.map(({ row }) => row).sort(byDate);
  try {
    for (const { row, id } of due.slice(0, batch)) {
      try {
        await numbers(id, row);
      } catch (err) {
        if (stops(err)) throw err;
      }
      row.updated = today;
    }
  } finally {
    await write(statsFile(root, channel, 'posts'), columns, rows);
  }
  return Math.max(due.length - batch, 0);
}

const kept = (root: string, channel: string): Map<string, Row> => new Map(readStats(root, channel, 'posts').map((row) => [row.url!, row]));

export async function collectThreads(root: string, channel: string, credentials: Credentials, fetchImpl: typeof fetch, now: Date): Promise<number> {
  const { user, metrics, list } = client(credentials, fetchImpl, THREADS_GRAPH, 'Threads statistics');
  const days = daysOf(root, channel);
  const today = days.day(ymd(now));
  const followers = (await metrics(`${user}/threads_insights`, { metric: 'followers_count' }))[0]?.total_value?.value;
  if (followers !== undefined && !today.followers) today.followers = String(followers);
  const back = days.first ? BACKFILL_DAYS : OVERLAP_DAYS;
  const views = await metrics(`${user}/threads_insights`, { metric: 'views', since: seconds(now.getTime() - back * DAY_MS), until: seconds(now.getTime()) });
  for (const entry of views[0]?.values ?? []) if (entry.end_time && entry.value !== undefined) days.day(entry.end_time.slice(0, 10)).views = String(entry.value);
  await days.save(DAY_COLUMNS.threads);

  const before = kept(root, channel);
  const posts = (await list(`${user}/threads`, 'id,timestamp,permalink,media_type,text'))
    .filter((post) => post.permalink && post.media_type !== 'REPOST_FACADE')
    .map((listed) => ({ listed, row: { ...before.get(listed.permalink!), date: listed.timestamp, url: listed.permalink!, type: listed.media_type ?? '', text: firstLine(listed.text) } as Row }));
  return refresh(root, channel, POST_COLUMNS.threads, posts, now, 7, Number.POSITIVE_INFINITY, async (id, row) => {
    for (const metric of await metrics(`${id}/insights`, { metric: THREADS_NUMBERS.join(',') })) {
      const value = numberOf(metric);
      if (value !== undefined) row[metric.name] = String(value);
    }
  });
}

export async function collectInstagram(root: string, channel: string, credentials: Credentials, fetchImpl: typeof fetch, now: Date, batch = BATCH): Promise<number> {
  const { user, read, metrics, list } = client(credentials, fetchImpl, GRAPH, 'Instagram statistics');
  const days = daysOf(root, channel);
  const today = days.day(ymd(now));
  const followers = (await read(user, { fields: 'followers_count' })).followers_count;
  if (typeof followers === 'number' && !today.followers) today.followers = String(followers);
  await days.save(DAY_COLUMNS.instagram);

  const optional = async (query: Record<string, string>): Promise<Metric[]> => {
    try {
      return await metrics(`${user}/insights`, query);
    } catch (err) {
      if (stops(err)) throw err;
      return [];
    }
  };
  const window = (from: number, to: number) => ({ since: seconds(now.getTime() - from * DAY_MS), until: seconds(now.getTime() - to * DAY_MS) });
  const reached: { value?: number; end_time?: string }[] = [];
  const spans = days.first ? Array.from({ length: BACKFILL_DAYS / WINDOW_DAYS }, (_, i) => window(BACKFILL_DAYS - i * WINDOW_DAYS, BACKFILL_DAYS - (i + 1) * WINDOW_DAYS)) : [window(OVERLAP_DAYS, 0)];
  for (const span of spans) reached.push(...((await optional({ metric: 'reach', period: 'day', ...span }))[0]?.values ?? []));
  const ends = [...new Set(reached.flatMap((entry) => (entry.end_time ? [entry.end_time] : [])))].sort();
  for (const entry of reached) if (entry.end_time && entry.value !== undefined) days.day(entry.end_time.slice(0, 10)).reach = String(entry.value);
  const gained = await optional({ metric: 'follower_count', period: 'day', ...window(days.first ? WINDOW_DAYS - 1 : OVERLAP_DAYS, 0) });
  for (const entry of gained[0]?.values ?? []) if (entry.end_time && entry.value !== undefined) days.day(entry.end_time.slice(0, 10)).new_followers = String(entry.value);
  for (const [index, end] of ends.entries()) {
    const row = days.day(end.slice(0, 10));
    if (index < ends.length - WINDOW_DAYS || (row.views && index < ends.length - OVERLAP_DAYS)) continue;
    const stamp = Date.parse(end);
    const value = (await optional({ metric: 'views', metric_type: 'total_value', period: 'day', since: seconds(stamp - DAY_MS + INSIDE_MS), until: seconds(stamp) }))[0]?.total_value?.value;
    if (value !== undefined) row.views = String(value);
  }
  await days.save(DAY_COLUMNS.instagram);

  const before = kept(root, channel);
  const posts = (await list(`${user}/media`, 'id,timestamp,permalink,media_type,media_product_type,caption,like_count,comments_count'))
    .filter((post) => post.permalink)
    .map((listed) => {
      const row: Row = { ...before.get(listed.permalink!), date: listed.timestamp, url: listed.permalink!, type: listed.media_product_type === 'REELS' ? 'REEL' : (listed.media_type ?? ''), text: firstLine(listed.caption) };
      if (listed.like_count !== undefined) row.likes = String(listed.like_count);
      if (listed.comments_count !== undefined) row.comments = String(listed.comments_count);
      return { listed, row };
    });
  const insights = (id: string, names: string[]) => metrics(`${id}/insights`, { metric: names.join(',') });
  const postInsights = async (id: string, type: string | undefined): Promise<Metric[]> => {
    const base = Object.keys(INSTAGRAM_NUMBERS);
    if (type === 'REEL') return insights(id, base);
    try {
      return await insights(id, [...base, ...FOLLOW_NUMBERS]);
    } catch (err) {
      if (!(err instanceof Error) || !/does not support/i.test(err.message)) throw err;
      return insights(id, base);
    }
  };
  return refresh(root, channel, POST_COLUMNS.instagram, posts, now, 28, batch, async (id, row) => {
    for (const metric of await postInsights(id, row.type)) {
      const value = numberOf(metric);
      const column = FOLLOW_NUMBERS.includes(metric.name) ? metric.name : INSTAGRAM_NUMBERS[metric.name];
      if (column && value !== undefined) row[column] = String(value);
    }
  });
}

export async function collectStories(root: string, channel: string, credentials: Credentials, fetchImpl: typeof fetch, now: Date): Promise<void> {
  const { user, metrics, list } = client(credentials, fetchImpl, GRAPH, 'Instagram story statistics');
  const live = await list(`${user}/stories`, 'id,timestamp,permalink,media_type');
  if (live.length === 0) return;
  const rows = new Map(readStats(root, channel, 'stories').map((row) => [row.url!, row]));
  try {
    for (const story of live) {
      const url = story.permalink ?? story.id;
      const row: Row = { ...rows.get(url), date: story.timestamp, url, type: story.media_type ?? '' };
      try {
        for (const metric of await metrics(`${story.id}/insights`, { metric: Object.keys(STORY_NUMBERS).join(',') })) {
          const value = numberOf(metric);
          const column = STORY_NUMBERS[metric.name];
          if (column && value !== undefined) row[column] = String(value);
        }
        row.updated = now.toISOString();
      } catch (err) {
        if (stops(err)) throw err;
      }
      rows.set(url, row);
    }
  } finally {
    await write(statsFile(root, channel, 'stories'), STORY_COLUMNS, [...rows.values()].sort(byDate));
  }
}

interface Job {
  every: 'day' | number;
  run: (root: string, channel: string, credentials: Credentials, fetchImpl: typeof fetch, now: Date) => Promise<number | void>;
}

const JOBS: Partial<Record<Platform, Record<string, Job>>> = {
  threads: { statistics: { every: 'day', run: collectThreads } },
  instagram: { statistics: { every: 'day', run: (root, channel, credentials, fetchImpl, now) => collectInstagram(root, channel, credentials, fetchImpl, now) }, stories: { every: STORY_MS, run: collectStories } }
};

const next = new Map<string, number | string>();
let busy = false;

export async function collectStats(root: string, channels: Channels, credentials: (channel: string) => Promise<Credentials | null>, fetchImpl: typeof fetch, now: Date): Promise<string[]> {
  if (busy) return [];
  busy = true;
  const problems: string[] = [];
  try {
    for (const [name, channel] of Object.entries(channels)) {
      for (const [kind, job] of Object.entries(JOBS[channel.platform] ?? {})) {
        const key = `${root}\n${name}\n${kind}`;
        const wait = next.get(key);
        if (typeof wait === 'string' ? wait === ymd(now) : wait !== undefined && now.getTime() < wait) continue;
        try {
          const own = await credentials(name);
          if (!own) continue;
          const left = await job.run(root, name, own, fetchImpl, now);
          next.set(key, job.every !== 'day' ? now.getTime() + job.every : left ? now.getTime() + RETRY_MS : ymd(now));
        } catch (err) {
          next.set(key, now.getTime() + RETRY_MS);
          problems.push(`${name} ${kind}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  } finally {
    busy = false;
  }
  return problems;
}
