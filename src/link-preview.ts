import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface LinkPreview {
  title?: string;
  site?: string;
  image?: { bytes: Uint8Array; ext: 'jpg' | 'png' | 'webp' };
}

export interface PreviewDeps {
  fetch?: typeof fetch;
  lookup?: (host: string) => Promise<string[]>;
}

const TIMEOUT_MS = 5000;
const MAX_HTML = 1_000_000;
const MAX_IMAGE = 2_000_000;
const MAX_REDIRECTS = 3;
const IMAGE_TYPES: Record<string, 'jpg' | 'png' | 'webp'> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function isPrivateAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  const address = mapped ? (mapped[1] as string) : ip;
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const lower = address.toLowerCase();
  return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb');
}

const defaultLookup = async (host: string): Promise<string[]> => (await dnsLookup(host, { all: true })).map((entry) => entry.address);

async function assertPublic(url: URL, lookup: (host: string) => Promise<string[]>): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('not a web address');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : await lookup(host);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new Error('not a public address');
}

async function readLimited(response: Response, max: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(Math.min(size, max));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk.subarray(0, Math.max(0, bytes.length - offset)), offset);
    offset += chunk.length;
  }
  return bytes;
}

async function get(start: URL, accept: string, max: number, deps: Required<PreviewDeps>): Promise<{ response: Response; url: URL; bytes: Uint8Array } | null> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublic(url, deps.lookup);
    const response = await deps.fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept, 'user-agent': 'Mozilla/5.0 (compatible; link preview)' } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return null;
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) return null;
    return { response, url, bytes: await readLimited(response, max) };
  }
  return null;
}

const decode = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

export function readMeta(html: string): { title?: string; site?: string; image?: string } {
  const meta = new Map<string, string>();
  for (const tag of html.match(/<meta\s[^>]*>/gi) ?? []) {
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag);
    const value = content?.[1] ?? content?.[2];
    if (key && value !== undefined && !meta.has(key)) meta.set(key, decode(value));
  }
  const heading = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const title = meta.get('og:title') || meta.get('twitter:title') || (heading ? decode(heading) : '');
  const site = meta.get('og:site_name') || '';
  const image = meta.get('og:image') || meta.get('twitter:image') || '';
  return { ...(title && { title }), ...(site && { site }), ...(image && { image }) };
}

export async function fetchPreview(link: string, given: PreviewDeps = {}): Promise<LinkPreview | null> {
  const deps: Required<PreviewDeps> = { fetch: given.fetch ?? fetch, lookup: given.lookup ?? defaultLookup };
  try {
    const page = await get(new URL(link), 'text/html', MAX_HTML, deps);
    if (!page) return null;
    const meta = readMeta(new TextDecoder().decode(page.bytes));
    let image: LinkPreview['image'];
    if (meta.image) {
      try {
        const found = await get(new URL(meta.image, page.url), 'image/*', MAX_IMAGE, deps);
        const ext = found ? IMAGE_TYPES[(found.response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? ''] : undefined;
        if (found && ext && found.bytes.length > 0 && found.bytes.length < MAX_IMAGE) image = { bytes: found.bytes, ext };
      } catch {
        image = undefined;
      }
    }
    if (!meta.title && !image) return null;
    return { ...(meta.title && { title: meta.title }), ...(meta.site && { site: meta.site }), ...(image && { image }) };
  } catch {
    return null;
  }
}
