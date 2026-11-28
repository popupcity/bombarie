import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Channels } from './channels.ts';
import { fromCsv, toCsv } from './csv.ts';
import { postUrl } from './facebook.ts';
import type { Row } from './csv.ts';
import { GRAPH, THREADS_GRAPH, graph } from './graph.ts';
import { hoursOf } from './online.ts';
import type { OnlineDay } from './online.ts';
import { ymd } from './time.ts';
import { ProviderError } from './types.ts';
import type { Credentials, Platform, SendContext } from './types.ts';

const THREADS_NUMBERS = ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'];
const INSTAGRAM_NUMBERS: Record<string, string> = { views: 'views', reach: 'reach', saved: 'saved', shares: 'shares', total_interactions: 'interactions' };
const FOLLOW_NUMBERS = ['follows', 'profile_visits'];
const FACEBOOK_DAYS: Record<string, string> = { page_follows: 'followers', page_daily_follows_unique: 'new_followers', page_media_view: 'views', page_total_media_view_unique: 'reach' };
const FACEBOOK_NUMBERS: Record<string, string> = { post_media_view: 'views', post_total_media_view_unique: 'reach', post_clicks: 'clicks' };
const FACEBOOK_KINDS: Record<string, string> = { photo: 'IMAGE', album: 'CAROUSEL_ALBUM', video: 'VIDEO', link: 'LINK' };
const FACEBOOK_FIELDS = 'id,created_time,message,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0),attachments{media_type}';
const STORY_NUMBERS: Record<string, string> = { views: 'views', reach: 'reach', replies: 'replies', shares: 'shares', total_interactions: 'interactions' };

export const DAY_COLUMNS = {
  threads: ['date', 'followers', 'views'],
  instagram: ['date', 'followers', 'new_followers', 'views', 'reach', 'reach_followers', 'reach_others'],
  facebook: ['date', 'followers', 'new_followers', 'views', 'reach'],
  substack: ['date', 'followers', 'views']
};
export const POST_COLUMNS = {
  threads: ['date', 'url', 'type', 'text', ...THREADS_NUMBERS, 'updated'],
  instagram: ['date', 'url', 'type', 'text', 'views', 'reach', 'likes', 'comments', 'saved', 'shares', 'interactions', ...FOLLOW_NUMBERS, 'updated'],
  facebook: ['date', 'url', 'type', 'text', 'views', 'reach', 'likes', 'comments', 'shares', 'clicks', 'updated'],
  substack: ['date', 'url', 'type', 'text', 'views', 'follows', 'signups', 'subscribes', 'engagement_rate', 'open_rate']
};
const STORY_COLUMNS = ['date', 'url', 'type', ...Object.values(STORY_NUMBERS), 'updated'];

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
const BATCH = 60;

type Name = 'days' | 'posts' | 'stories' | 'audience' | 'tags' | 'online';

export const statsFile = (root: string, channel: string, name: Name): string => join(root, 'channels', channel, `${name}.csv`);

export const readStats = (root: string, channel: string, name: Name): Row[] => {
  const file = statsFile(root, channel, name);
  return existsSync(file) ? fromCsv(readFileSync(file, 'utf8')) : [];
};

export async function writeStats(file: string, columns: string[], rows: Row[]): Promise<void> {
  const text = toCsv(columns, rows);
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, text);
  await rename(`${file}.tmp`, file);
}

const byDate = (a: Row, b: Row): number => a.date!.localeCompare(b.date!) || (a.url ?? '').localeCompare(b.url ?? '');

interface Metric {
  name: string;
  period?: string;
  total_value?: { value?: number; breakdowns?: { results?: { dimension_values?: string[]; value?: number }[] }[] };
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
  created_time?: string;
  message?: string;
  shares?: { count?: number };
  reactions?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
  attachments?: { data?: { media_type?: string }[] };
  username?: string;
  permalink_url?: string;
  from?: { name?: string };
}

const seconds = (time: number): string => String(Math.floor(time / 1000));
const window = (now: Date, from: number, to: number) => ({ since: seconds(now.getTime() - from * DAY_MS), until: seconds(now.getTime() - to * DAY_MS) });
const spansOf = (now: Date, first: boolean) => (first ? Array.from({ length: BACKFILL_DAYS / WINDOW_DAYS }, (_, i) => window(now, BACKFILL_DAYS - i * WINDOW_DAYS, BACKFILL_DAYS - (i + 1) * WINDOW_DAYS)) : [window(now, OVERLAP_DAYS, 0)]);
const named = (numbers: string[]): Record<string, string> => Object.fromEntries(numbers.map((name) => [name, name]));
function put(row: Row, metrics: Metric[], columns: Record<string, string>): void {
  for (const metric of metrics) {
    const column = columns[metric.name];
    const value = numberOf(metric);
    if (column && value !== undefined) row[column] = String(value);
  }
}
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

function daysOf(root: string, channel: string, history: 'views' | 'reach') {
  const days = new Map(readStats(root, channel, 'days').map((row) => [row.date!, row]));
  return {
    first: ![...days.values()].some((row) => row[history]),
    day: (date: string): Row => days.get(date) ?? days.set(date, { date }).get(date)!,
    some: (found: (row: Row) => boolean): boolean => [...days.values()].some(found),
    save: (columns: string[]) => writeStats(statsFile(root, channel, 'days'), columns, [...days.values()].sort(byDate))
  };
}

interface Due {
  row: Row;
  id: string;
}

async function refresh(root: string, channel: string, columns: string[], posts: { listed: Listed; row: Row }[], now: Date, slowDays: number, batch: number, numbers: (id: string, row: Row) => Promise<void>): Promise<number> {
  if (posts.length === 0) return 0;
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
    await writeStats(statsFile(root, channel, 'posts'), columns, rows);
  }
  return Math.max(due.length - batch, 0);
}

const kept = (root: string, channel: string): Map<string, Row> => new Map(readStats(root, channel, 'posts').map((row) => [row.url!, row]));

export async function collectThreads(root: string, channel: string, credentials: Credentials, fetchImpl: typeof fetch, now: Date): Promise<number> {
  const { user, metrics, list } = client(credentials, fetchImpl, THREADS_GRAPH, 'Threads statistics');
  const days = daysOf(root, channel, 'views');
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
    put(row, await metrics(`${id}/insights`, { metric: THREADS_NUMBERS.join(',') }), named(THREADS_NUMBERS));
  });
}

export async function collectInstagram(root: string, channel: string, credentials: Credentials, fetchImpl: typeof fetch, now: Date, batch = BATCH): Promise<number> {
  const { user, read, metrics, list } = client(credentials, fetchImpl, GRAPH, 'Instagram statistics');
  const days = daysOf(root, channel, 'reach');
  const since = ymd(new Date(now.getTime() - (WINDOW_DAYS - 2) * DAY_MS));
  const unsplit = days.some((row) => row.date! >= since && Boolean(row.reach) && !row.reach_others);
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
  const reached: { value?: number; end_time?: string }[] = [];
  for (const span of spansOf(now, days.first || unsplit)) reached.push(...((await optional({ metric: 'reach', period: 'day', ...span }))[0]?.values ?? []));
  const ends = [...new Set(reached.flatMap((entry) => (entry.end_time ? [entry.end_time] : [])))].sort();
  for (const entry of reached) if (entry.end_time && entry.value !== undefined) days.day(entry.end_time.slice(0, 10)).reach = String(entry.value);
  const gained = await optional({ metric: 'follower_count', period: 'day', ...window(now, days.first ? WINDOW_DAYS - 1 : OVERLAP_DAYS, 0) });
  for (const entry of gained[0]?.values ?? []) if (entry.end_time && entry.value !== undefined) days.day(entry.end_time.slice(0, 10)).new_followers = String(entry.value);
  for (const [index, end] of ends.entries()) {
    if (index < ends.length - WINDOW_DAYS) continue;
    const row = days.day(end.slice(0, 10));
    const again = index >= ends.length - OVERLAP_DAYS;
    const stamp = Date.parse(end);
    const ofDay = async (query: Record<string, string>) => (await optional({ ...query, metric_type: 'total_value', period: 'day', since: seconds(stamp - DAY_MS + INSIDE_MS), until: seconds(stamp) }))[0]?.total_value;
    if (!row.views || again) {
      const value = (await ofDay({ metric: 'views' }))?.value;
      if (value !== undefined) row.views = String(value);
    }
    if (!row.reach_others || again) {
      const parts = (await ofDay({ metric: 'reach', breakdown: 'follow_type' }))?.breakdowns?.[0]?.results;
      if (!parts) continue;
      const part = (kind: string): string => String(parts.find((found) => found.dimension_values?.[0] === kind)?.value ?? 0);
      row.reach_followers = part('FOLLOWER');
      row.reach_others = part('NON_FOLLOWER');
    }
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
    put(row, await postInsights(id, row.type), { ...INSTAGRAM_NUMBERS, ...named(FOLLOW_NUMBERS) });
  });
}

export async function collectFacebook(root: string, channel: string, credentials: Credentials, fetchImpl: typeof fetch, now: Date, batch = BATCH): Promise<number> {
  const { user, read, metrics, list } = client(credentials, fetchImpl, GRAPH, 'Facebook statistics');
  const days = daysOf(root, channel, 'views');
  const today = days.day(ymd(now));
  const followers = (await read(user, { fields: 'followers_count' })).followers_count;
  if (typeof followers === 'number' && !today.followers) today.followers = String(followers);
  for (const span of spansOf(now, days.first)) {
    for (const metric of await metrics(`${user}/insights`, { metric: Object.keys(FACEBOOK_DAYS).join(','), period: 'day', ...span })) {
      const column = FACEBOOK_DAYS[metric.name];
      for (const { value, end_time: end } of metric.values ?? []) {
        if (!column || value === undefined || !end) continue;
        days.day(new Date(Date.parse(end) - DAY_MS).toISOString().slice(0, 10))[column] = String(value);
      }
    }
  }
  await days.save(DAY_COLUMNS.facebook);

  const before = kept(root, channel);
  const posts = (await list(`${user}/published_posts`, FACEBOOK_FIELDS)).map((listed) => {
    const url = postUrl(listed.id);
    const attached = listed.attachments?.data?.[0]?.media_type;
    const row: Row = { ...before.get(url), date: listed.created_time!, url, type: attached ? (FACEBOOK_KINDS[attached] ?? '') : 'TEXT_POST', text: firstLine(listed.message), shares: String(listed.shares?.count ?? 0) };
    if (listed.reactions?.summary?.total_count !== undefined) row.likes = String(listed.reactions.summary.total_count);
    if (listed.comments?.summary?.total_count !== undefined) row.comments = String(listed.comments.summary.total_count);
    return { listed, row };
  });
  return refresh(root, channel, POST_COLUMNS.facebook, posts, now, 28, batch, async (id, row) => {
    const found = await metrics(`${id}/insights`, { metric: Object.keys(FACEBOOK_NUMBERS).join(',') });
    put(row, found.filter((metric) => !metric.period || metric.period === 'lifetime'), FACEBOOK_NUMBERS);
  });
}

const AUDIENCE_DAYS = 7;
const AUDIENCE_COLUMNS = ['date', 'kind', 'place', 'count'];
export const PLACE_KINDS = ['country', 'city'] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export interface Placed {
  date: string;
  kind: PlaceKind;
  place: string;
  count: string;
}

export async function saveAudience(root: string, channel: string, rows: Placed[]): Promise<void> {
  const replaced = new Set(rows.map((row) => `${row.date} ${row.kind}`));
  const kept = readStats(root, channel, 'audience').filter((row) => !replaced.has(`${row.date} ${row.kind}`));
  const added: Row[] = rows.map((row) => ({ ...row }));
  await writeStats(statsFile(root, channel, 'audience'), AUDIENCE_COLUMNS, [...kept, ...added].sort((a, b) => a.date!.localeCompare(b.date!) || a.kind!.localeCompare(b.kind!) || Number(b.count) - Number(a.count) || a.place!.localeCompare(b.place!)));
}

const measuredLately = (latest: string | undefined, now: Date): boolean => latest !== undefined && Date.parse(ymd(now)) - Date.parse(latest) < AUDIENCE_DAYS * DAY_MS;

async function demographics(root: string, channel: string, now: Date, ask: (kind: PlaceKind) => Promise<Metric[]>): Promise<void> {
  const rows: Placed[] = [];
  for (const kind of PLACE_KINDS) {
    const [found] = await ask(kind);
    for (const result of found?.total_value?.breakdowns?.[0]?.results ?? []) {
      const place = result.dimension_values?.join(', ');
      if (place && result.value !== undefined) rows.push({ date: ymd(now), kind, place, count: String(result.value) });
    }
  }
  if (rows.length > 0) await saveAudience(root, channel, rows);
}

export async function collectAudience(root: string, channel: string, credentials: Credentials, fetchImpl: typeof fetch, now: Date): Promise<void> {
  if (measuredLately(readStats(root, channel, 'audience').at(-1)?.date, now)) return;
  const { user, metrics } = client(credentials, fetchImpl, GRAPH, 'Instagram audience statistics');
  await demographics(root, channel, now, (kind) => metrics(`${user}/insights`, { metric: 'follower_demographics', period: 'lifetime', metric_type: 'total_value', breakdown: kind }));
}

export async function collectThreadsAudience(root: string, channel: string, credentials: Credentials, fetchImpl: typeof fetch, now: Date): Promise<void> {
  if (measuredLately(readStats(root, channel, 'audience').at(-1)?.date, now)) return;
  const { user, metrics } = client(credentials, fetchImpl, THREADS_GRAPH, 'Threads audience statistics');
  await demographics(root, channel, now, (kind) => metrics(`${user}/threads_insights`, { metric: 'follower_demographics', breakdown: kind }));
}

const AUDIENCE_BACK_DAYS = 730;
const AUDIENCE_SPAN_DAYS = 90;
const FACEBOOK_PLACES: Record<string, PlaceKind> = { page_follows_country: 'country', page_follows_city: 'city' };

export async function collectFacebookAudience(root: string, channel: string, credentials: Credentials, fetchImpl: typeof fetch, now: Date): Promise<void> {
  const latest = readStats(root, channel, 'audience').at(-1)?.date;
  if (measuredLately(latest, now)) return;
  const { user, metrics } = client(credentials, fetchImpl, GRAPH, 'Facebook audience statistics');
  const found = new Map<string, Placed[]>();
  for (let since = latest ? Date.parse(latest) : now.getTime() - AUDIENCE_BACK_DAYS * DAY_MS; since < now.getTime(); since += AUDIENCE_SPAN_DAYS * DAY_MS) {
    const until = Math.min(since + AUDIENCE_SPAN_DAYS * DAY_MS, now.getTime());
    for (const metric of await metrics(`${user}/insights`, { metric: Object.keys(FACEBOOK_PLACES).join(','), period: 'day', since: seconds(since), until: seconds(until) })) {
      const kind = FACEBOOK_PLACES[metric.name];
      for (const { value, end_time: end } of metric.values ?? []) {
        const places = Object.entries((value ?? {}) as unknown as Record<string, number>);
        if (!kind || !end || places.length === 0) continue;
        const date = new Date(Date.parse(end) - DAY_MS).toISOString().slice(0, 10);
        found.set(date, [...(found.get(date) ?? []), ...places.map(([place, count]) => ({ date, kind, place, count: String(count) }))]);
      }
    }
  }
  const rows: Placed[] = [];
  let kept = latest;
  for (const date of [...found.keys()].sort()) {
    if (kept && Date.parse(date) - Date.parse(kept) < AUDIENCE_DAYS * DAY_MS) continue;
    rows.push(...found.get(date)!);
    kept = date;
  }
  if (rows.length > 0) await saveAudience(root, channel, rows);
}

const ONLINE_DAYS = 30;

export async function collectOnline(root: string, channel: string, credentials: Credentials, fetchImpl: typeof fetch, now: Date): Promise<void> {
  const { user, metrics } = client(credentials, fetchImpl, GRAPH, 'Instagram online followers');
  const [found] = await metrics(`${user}/insights`, { metric: 'online_followers', period: 'lifetime', since: seconds(now.getTime() - ONLINE_DAYS * DAY_MS), until: seconds(now.getTime()) });
  const hours = hoursOf((found?.values ?? []) as unknown as OnlineDay[]);
  if (hours.length > 0) await writeStats(statsFile(root, channel, 'online'), ['hour', 'followers'], hours);
}

const TAG_COLUMNS = ['date', 'url', 'by'];
const TAGS: Partial<Record<Platform, { path: string; fields: string }>> = {
  instagram: { path: 'tags', fields: 'id,timestamp,permalink,username' },
  facebook: { path: 'tagged', fields: 'id,created_time,permalink_url,from' }
};

export async function collectTags(platform: Platform, root: string, channel: string, credentials: Credentials, fetchImpl: typeof fetch): Promise<void> {
  const asked = TAGS[platform]!;
  const { user, list } = client(credentials, fetchImpl, GRAPH, 'Tag statistics');
  const tags = new Map(readStats(root, channel, 'tags').map((row) => [row.url!, row]));
  for (const found of await list(`${user}/${asked.path}`, asked.fields)) {
    const url = found.permalink ?? found.permalink_url;
    const date = found.timestamp ?? found.created_time;
    if (url && date) tags.set(url, { date, url, by: found.username ?? found.from?.name ?? tags.get(url)?.by ?? '' });
  }
  if (tags.size > 0) await writeStats(statsFile(root, channel, 'tags'), TAG_COLUMNS, [...tags.values()].sort(byDate));
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
        put(row, await metrics(`${story.id}/insights`, { metric: Object.keys(STORY_NUMBERS).join(',') }), STORY_NUMBERS);
        row.updated = now.toISOString();
      } catch (err) {
        if (stops(err)) throw err;
      }
      rows.set(url, row);
    }
  } finally {
    await writeStats(statsFile(root, channel, 'stories'), STORY_COLUMNS, [...rows.values()].sort(byDate));
  }
}

interface Job {
  every: 'day' | number;
  run: (root: string, channel: string, credentials: Credentials, fetchImpl: typeof fetch, now: Date) => Promise<number | void>;
}

const JOBS: Partial<Record<Platform, Record<string, Job>>> = {
  facebook: { statistics: { every: 'day', run: collectFacebook }, tags: { every: 'day', run: (root, channel, credentials, fetchImpl) => collectTags('facebook', root, channel, credentials, fetchImpl) }, audience: { every: 'day', run: collectFacebookAudience } },
  threads: { statistics: { every: 'day', run: collectThreads }, audience: { every: 'day', run: collectThreadsAudience } },
  instagram: { statistics: { every: 'day', run: collectInstagram }, online: { every: 'day', run: collectOnline }, tags: { every: 'day', run: (root, channel, credentials, fetchImpl) => collectTags('instagram', root, channel, credentials, fetchImpl) }, stories: { every: STORY_MS, run: collectStories }, audience: { every: 'day', run: collectAudience } }
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
