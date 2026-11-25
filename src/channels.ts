import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, parseDocument, Scalar } from 'yaml';
import { feedUrlProblem } from './feed.ts';
import { isRecord } from './frontmatter.ts';
import type { Channel, ChannelInfo, Platform } from './types.ts';

export const PLATFORMS: Platform[] = ['linkedin', 'instagram', 'facebook', 'threads', 'substack', 'website'];

export type Channels = Record<string, Channel>;

const fileOf = (root: string): string => join(root, 'channels.yml');
const textOf = (root: string): string => (existsSync(fileOf(root)) ? readFileSync(fileOf(root), 'utf8') : '');

export function loadChannels(root: string): Channels {
  const path = fileOf(root);
  const raw: unknown = parse(textOf(root)) ?? {};
  if (!isRecord(raw)) throw new Error(`${path}: expected a map of channels`);
  const channels: Channels = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!isRecord(value)) throw new Error(`${name}: expected a map`);
    const platform = value.platform;
    if (typeof platform !== 'string' || !PLATFORMS.includes(platform as Platform)) {
      throw new Error(`${name}: platform must be one of ${PLATFORMS.join(', ')}`);
    }
    const channel: Channel = { platform: platform as Platform };
    if (value.kind !== undefined) {
      if (value.kind !== 'person' && value.kind !== 'organization') {
        throw new Error(`${name}: kind must be person or organization`);
      }
      channel.kind = value.kind;
    }
    if (value.urn !== undefined) {
      if (typeof value.urn !== 'string') throw new Error(`${name}: urn must be a string`);
      channel.urn = value.urn;
    }
    if (value.name !== undefined) {
      if (typeof value.name !== 'string' || value.name.trim() === '') throw new Error(`${name}: name must be a non-empty string`);
      channel.name = value.name.trim();
    }
    if (value.handle !== undefined) {
      if (typeof value.handle !== 'string' || !/^[A-Za-z0-9._]+$/.test(value.handle)) throw new Error(`${name}: handle must be a name without @`);
      channel.handle = value.handle;
    }
    if (value.page !== undefined) {
      if (typeof value.page !== 'string' && typeof value.page !== 'number') throw new Error(`${name}: page must be a Facebook page id`);
      const page = String(value.page);
      if (!/^\d+$/.test(page)) throw new Error(`${name}: page must be a Facebook page id (digits only)`);
      channel.page = page;
    }
    if (value.feed !== undefined) {
      const problem = typeof value.feed !== 'string' ? 'the feed address must be text' : feedUrlProblem(value.feed);
      if (problem) throw new Error(`${name}: ${problem}`);
      channel.feed = value.feed as string;
    }
    if (value.avatar !== undefined) {
      if (typeof value.avatar !== 'string' || !/^avatars\/[^/\\]+\.(jpe?g|png|webp|gif)$/i.test(value.avatar)) {
        throw new Error(`${name}: avatar must be an image file in avatars/ (jpg, png, webp or gif)`);
      }
      channel.avatar = value.avatar;
    }
    channels[name] = channel;
  }
  const names = Object.keys(channels);
  for (const a of names) {
    const clash = names.find((b) => b.startsWith(`${a}-`));
    if (clash) throw new Error(`channel "${a}" is a prefix of "${clash}"`);
  }
  return channels;
}

export async function setChannelField(root: string, channel: string, key: string, value: string): Promise<void> {
  const path = fileOf(root);
  const doc = parseDocument(textOf(root));
  doc.setIn([channel, key], value);
  const temp = `${path}.tmp`;
  await writeFile(temp, doc.toString());
  await rename(temp, path);
}

const slugOf = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export async function addChannel(root: string, input: { platform: string; name: string }): Promise<string> {
  const platform = PLATFORMS.find((candidate) => candidate === input.platform);
  if (!platform) throw new Error('choose a platform');
  const name = input.name.trim();
  const slug = slugOf(name);
  if (slug === '') throw new Error('give the channel a name with at least one letter or number');
  const key = `${slug}-${platform}`;
  const existing = Object.keys(loadChannels(root));
  if (existing.some((other) => other === key || other.startsWith(`${key}-`) || key.startsWith(`${other}-`))) {
    throw new Error(`there is already a ${name} channel on ${platform}`);
  }
  const path = fileOf(root);
  const doc = parseDocument(textOf(root));
  const label = new Scalar(key);
  label.spaceBefore = true;
  doc.set(label, doc.createNode({ platform, name }));
  const temp = `${path}.tmp`;
  await writeFile(temp, doc.toString());
  await rename(temp, path);
  return key;
}

export async function renameChannel(root: string, key: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!/[\p{L}\p{N}]/u.test(clean)) throw new Error('give the channel a name with at least one letter or number');
  if (!(key in loadChannels(root))) throw new Error('unknown channel');
  await setChannelField(root, key, 'name', clean);
}

export function channelPosts(root: string, key: string): number {
  const channels = loadChannels(root);
  const dir = join(root, 'posts');
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const folder of readdirSync(dir, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    for (const file of readdirSync(join(dir, folder.name))) {
      if (file.endsWith('.md') && resolveName(file.slice(0, -3), channels)?.channel === key) count += 1;
    }
  }
  return count;
}

export async function setHandle(root: string, key: string, handle: string): Promise<void> {
  const clean = handle.trim().replace(/^@/, '');
  if (clean === '') return;
  if (!/^[A-Za-z0-9._]+$/.test(clean)) throw new Error('a handle has letters, numbers, dots and underscores only');
  if (!(key in loadChannels(root))) throw new Error('unknown channel');
  await setChannelField(root, key, 'handle', clean);
}

export async function setFeed(root: string, key: string, address: string): Promise<void> {
  const clean = address.trim();
  if (!(key in loadChannels(root))) throw new Error('unknown channel');
  const problem = clean === '' ? null : feedUrlProblem(clean);
  if (problem) throw new Error(problem);
  const path = fileOf(root);
  const doc = parseDocument(textOf(root));
  if (clean === '') doc.deleteIn([key, 'feed']);
  else doc.setIn([key, 'feed'], clean);
  const temp = `${path}.tmp`;
  await writeFile(temp, doc.toString());
  await rename(temp, path);
}

export async function removeChannel(root: string, key: string): Promise<void> {
  if (!(key in loadChannels(root))) throw new Error('unknown channel');
  const used = channelPosts(root, key);
  if (used > 0) throw new Error(`${used} ${used === 1 ? 'post still uses' : 'posts still use'} this channel; delete ${used === 1 ? 'it' : 'them'} first`);
  const path = fileOf(root);
  const doc = parseDocument(textOf(root));
  doc.delete(key);
  const temp = `${path}.tmp`;
  await writeFile(temp, doc.toString());
  await rename(temp, path);
}

export function channelInfos(channels: Channels): ChannelInfo[] {
  const lent = new Map<string, string>();
  for (const [name, a] of Object.entries(channels)) {
    const label = (a.name ?? name).toLowerCase();
    if (a.avatar !== undefined && !lent.has(label)) lent.set(label, a.avatar);
  }
  return Object.entries(channels).map(([name, a]) => {
    const label = a.name ?? name;
    const avatar = a.avatar ?? lent.get(label.toLowerCase());
    return { name, platform: a.platform, label, ...(avatar !== undefined && { avatar }), ...(a.handle !== undefined && { handle: a.handle }) };
  });
}

export function resolveName(base: string, channels: Channels): { channel: string; type: string | null } | null {
  let best: string | null = null;
  for (const name of Object.keys(channels)) {
    if ((base === name || base.startsWith(`${name}-`)) && (!best || name.length > best.length)) {
      best = name;
    }
  }
  if (!best) return null;
  return { channel: best, type: base === best ? null : base.slice(best.length + 1) };
}
