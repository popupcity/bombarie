import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Channels } from './channels.ts';

export interface FeedItem {
  guid: string;
  title: string;
  url: string;
  at: string;
  text: string;
}

export interface FeedFile {
  source?: string;
  fetchedAt: string;
  items: FeedItem[];
  error?: string;
}

const MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;
const REFRESH_AFTER_MS = 60 * 60_000;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith('#x')) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)));
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/;

function inner(block: string, name: string): string | null {
  const found = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  if (!found) return null;
  const raw = found[1] as string;
  const wrapped = cdata.exec(raw);
  return wrapped ? (wrapped[1] as string) : decode(raw);
}

const plain = (html: string): string => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function atomLink(block: string): string {
  const links = [...block.matchAll(/<link\s[^>]*>/gi)].map((match) => match[0]);
  const chosen = links.find((tag) => !/rel=["'](?!alternate)/i.test(tag)) ?? links[0] ?? '';
  return /href=["']([^"']+)["']/i.exec(chosen)?.[1] ?? '';
}

export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)].map((match) => match[0]);
  for (const block of blocks) {
    const title = plain(inner(block, 'title') ?? '');
    const url = (inner(block, 'link') ?? '').trim() || atomLink(block);
    const guid = (inner(block, 'guid') ?? inner(block, 'id') ?? '').trim() || url;
    const stamp = inner(block, 'pubDate') ?? inner(block, 'posted') ?? inner(block, 'updated') ?? '';
    const date = new Date(stamp.trim());
    if (guid === '' || Number.isNaN(date.getTime())) continue;
    const summary = inner(block, 'description') ?? inner(block, 'summary') ?? '';
    items.push({ guid, title: title || url, url, at: date.toISOString(), text: plain(summary).slice(0, 280) });
  }
  return items;
}

export function feedUrlProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'that is not a web address; start it with https://';
  }
  if (url.protocol !== 'https:') return 'the feed address must start with https://';
  if (url.port !== '') return 'the feed address cannot have a port';
  const host = url.hostname.toLowerCase();
  const local = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.');
  const address = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[');
  if (local || address) return 'the feed address must be a public website name';
  return null;
}

async function read(res: Response): Promise<string> {
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) throw new Error('the feed is too large');
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error('the feed is too large');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function fetchFeed(address: string, fetchImpl: typeof fetch = fetch): Promise<FeedItem[]> {
  let url = address;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const problem = feedUrlProblem(url);
    if (problem) throw new Error(problem);
    const res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'social-feed-reader', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) throw new Error('the feed redirects nowhere');
      url = new URL(next, url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`the feed answered ${res.status}`);
    const items = parseFeed(await read(res));
    if (items.length === 0) throw new Error('no posts found in the feed; is this the RSS address?');
    return items;
  }
  throw new Error('the feed redirects too often');
}

const fileOf = (root: string, channel: string): string => join(root, '.state', '_feeds', `${channel}.json`);

export function readFeed(root: string, channel: string): FeedFile | null {
  const file = fileOf(root, channel);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as FeedFile;
  } catch {
    return null;
  }
}

export function mergeItems(known: FeedItem[], seen: FeedItem[]): FeedItem[] {
  const byGuid = new Map(known.map((item) => [item.guid, item]));
  for (const item of seen) byGuid.set(item.guid, item);
  return [...byGuid.values()].sort((a, b) => b.at.localeCompare(a.at) || a.guid.localeCompare(b.guid));
}

export async function refreshFeed(root: string, channel: string, address: string, fetchImpl: typeof fetch, now: Date): Promise<FeedFile> {
  const stored = readFeed(root, channel);
  const before = stored?.source === address ? stored : null;
  let next: FeedFile;
  try {
    next = { source: address, fetchedAt: now.toISOString(), items: mergeItems(before?.items ?? [], await fetchFeed(address, fetchImpl)) };
  } catch (err) {
    next = { source: address, fetchedAt: now.toISOString(), items: before?.items ?? [], error: err instanceof Error ? err.message : String(err) };
  }
  const file = fileOf(root, channel);
  await mkdir(join(root, '.state', '_feeds'), { recursive: true });
  await writeFile(`${file}.tmp`, `${JSON.stringify(next, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
  return next;
}

export async function refreshFeeds(root: string, channels: Channels, fetchImpl: typeof fetch, now: Date): Promise<void> {
  for (const [name, channel] of Object.entries(channels)) {
    if (!channel.feed) continue;
    const before = readFeed(root, name);
    if (before?.source === channel.feed && now.getTime() - Date.parse(before.fetchedAt) < REFRESH_AFTER_MS) continue;
    await refreshFeed(root, name, channel.feed, fetchImpl, now);
  }
}
