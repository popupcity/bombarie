import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Channels } from './channels.ts';
import { fromCsv, toCsv } from './csv.ts';
import type { Row } from './csv.ts';
import { THREADS_GRAPH, graph } from './graph.ts';
import { ymd } from './time.ts';
import { ProviderError } from './types.ts';
import type { Credentials, SendContext } from './types.ts';

export const DAY_COLUMNS = ['date', 'followers', 'views'];
const NUMBERS = ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'];
export const POST_COLUMNS = ['date', 'url', 'type', 'text', ...NUMBERS, 'updated'];

const DAY_MS = 86_400_000;
const BACKFILL_DAYS = 90;
const OVERLAP_DAYS = 4;
const FRESH_DAYS = 30;
const SLOW_DAYS = 7;
const MAX_PAGES = 100;
const RETRY_MS = 60 * 60_000;
const TEXT_LENGTH = 100;

export const statsFile = (root: string, channel: string, name: 'days' | 'posts'): string => join(root, 'channels', channel, `${name}.csv`);

export const readStats = (root: string, channel: string, name: 'days' | 'posts'): Row[] => {
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
  text?: string;
}

const seconds = (time: number): string => String(Math.floor(time / 1000));

export async function collectThreads(root: string, channel: string, credentials: Credentials, fetchImpl: typeof fetch, now: Date): Promise<void> {
  const user = credentials.accountId;
  if (!user) throw new ProviderError('this channel has no Threads user id; use Connect again on the Channels page', 'invalid');
  const read = (path: string, query: Record<string, string>) => graph({ fetch: fetchImpl } as SendContext, 'Threads statistics', path, credentials.accessToken, { query }, false, THREADS_GRAPH);
  const metrics = async (path: string, query: Record<string, string>): Promise<Metric[]> => ((await read(path, query)).data ?? []) as Metric[];
  const today = ymd(now);

  const days = new Map(readStats(root, channel, 'days').map((row) => [row.date!, row]));
  const day = (date: string): Row => days.get(date) ?? days.set(date, { date }).get(date)!;
  const followers = (await metrics(`${user}/threads_insights`, { metric: 'followers_count' }))[0]?.total_value?.value;
  if (followers !== undefined && !day(today).followers) day(today).followers = String(followers);
  const back = days.size > 1 ? OVERLAP_DAYS : BACKFILL_DAYS;
  const views = await metrics(`${user}/threads_insights`, { metric: 'views', since: seconds(now.getTime() - back * DAY_MS), until: seconds(now.getTime()) });
  for (const entry of views[0]?.values ?? []) if (entry.end_time && entry.value !== undefined) day(entry.end_time.slice(0, 10)).views = String(entry.value);
  await write(statsFile(root, channel, 'days'), DAY_COLUMNS, [...days.values()].sort((a, b) => a.date!.localeCompare(b.date!)));

  const listed: Listed[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const found = await read(`${user}/threads`, { fields: 'id,timestamp,permalink,media_type,text', limit: '100', ...(after && { after }) });
    listed.push(...((found.data ?? []) as Listed[]));
    const paging = found.paging as { next?: string; cursors?: { after?: string } } | undefined;
    after = paging?.next ? paging.cursors?.after : undefined;
    if (!after) break;
  }

  const known = new Map(readStats(root, channel, 'posts').map((row) => [row.url!, row]));
  const rows: Row[] = [];
  for (const post of listed) {
    if (!post.permalink || post.media_type === 'REPOST_FACADE') continue;
    const before = known.get(post.permalink);
    const row: Row = { ...before, date: post.timestamp, url: post.permalink, type: post.media_type ?? '', text: (post.text ?? '').split('\n')[0]!.slice(0, TEXT_LENGTH) };
    const young = now.getTime() - Date.parse(post.timestamp) < FRESH_DAYS * DAY_MS;
    const old = !before?.updated || Date.parse(today) - Date.parse(before.updated) >= SLOW_DAYS * DAY_MS;
    if (young || old) {
      try {
        for (const metric of await metrics(`${post.id}/insights`, { metric: NUMBERS.join(',') })) {
          const value = metric.values?.[0]?.value ?? metric.total_value?.value;
          if (value !== undefined) row[metric.name] = String(value);
        }
        row.updated = today;
      } catch (err) {
        if (err instanceof ProviderError && (err.code === 'auth' || err.code === 'rate')) throw err;
      }
    }
    rows.push(row);
  }
  await write(statsFile(root, channel, 'posts'), POST_COLUMNS, rows.sort((a, b) => a.date!.localeCompare(b.date!) || a.url!.localeCompare(b.url!)));
}

interface Progress {
  done?: string;
  tried?: number;
}

const progress = new Map<string, Progress>();
let busy = false;

export async function collectStats(root: string, channels: Channels, credentials: (channel: string) => Promise<Credentials | null>, fetchImpl: typeof fetch, now: Date): Promise<string[]> {
  if (busy) return [];
  busy = true;
  const problems: string[] = [];
  try {
    for (const [name, channel] of Object.entries(channels)) {
      if (channel.platform !== 'threads') continue;
      const key = `${root}\n${name}`;
      const last = progress.get(key) ?? {};
      if (last.done === ymd(now) || (last.tried !== undefined && now.getTime() - last.tried < RETRY_MS)) continue;
      try {
        const own = await credentials(name);
        if (!own) continue;
        await collectThreads(root, name, own, fetchImpl, now);
        progress.set(key, { done: ymd(now) });
      } catch (err) {
        progress.set(key, { tried: now.getTime() });
        problems.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    busy = false;
  }
  return problems;
}
