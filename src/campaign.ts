import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { revisionOf } from './content-store.ts';
import type { ContentStore } from './content-store.ts';
import { joinThread, splitThread } from './parts.ts';
import { readiness } from './plan.ts';
import { isPerson } from './speaker.ts';
import { readFields, setFrontmatter, statusOfRaw, withBody, withImages, withManual } from './frontmatter.ts';
import type { Fields } from './frontmatter.ts';
import { loadEntities } from './entities.ts';
import { preview } from './preview.ts';
import type { Preview } from './preview.ts';
import { isAutomatic } from './connect.ts';
import { linkedin } from './linkedin.ts';
import { channelInfos, loadChannels, resolveName } from './channels.ts';
import { parsePost } from './posts.ts';
import type { StateStore } from './state.ts';
import { campaignTitle } from './text.ts';
import { clock, ymd } from './time.ts';
import { PLATFORM_LABEL, takesMedia } from './types.ts';
import type { Channel, Platform, Post } from './types.ts';
import type { Entities, Entity } from './mentions.ts';

interface Variant {
  base: string;
  channel: string;
  label: string;
  platform: Platform;
  avatar?: string;
  type: string | null;
  raw: string;
  fields: Fields;
  revision: string;
  post: Post | null;
  error: string | null;
  issues: string[];
  preview: Preview;
}

interface Campaign {
  folder: string;
  title: string;
  variants: Variant[];
  entities: Record<string, Entity>;
}

interface Item {
  file: string;
  base: string;
  resolved: { channel: string; type: string | null };
  channel: Channel;
}

interface Source {
  dir: string;
  entities: Entities;
  items: Item[];
}

function listItems(root: string, folder: string): { dir: string; items: Item[] } | null {
  const postsDir = join(root, 'posts');
  if (!existsSync(postsDir) || !readdirSync(postsDir).includes(folder)) return null;
  const channels = loadChannels(root);
  const dir = join(postsDir, folder);
  const items: Item[] = [];
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()) {
    const base = file.slice(0, -3);
    const resolved = resolveName(base, channels);
    if (resolved) items.push({ file, base, resolved, channel: channels[resolved.channel]! });
  }
  return { dir, items };
}

function source(root: string, folder: string): Source | null {
  const found = listItems(root, folder);
  return found && { ...found, entities: loadEntities(root).entities };
}

function itemsOf(root: string, folder: string): Item[] {
  const found = listItems(root, folder);
  if (!found) throw new Error('post not found');
  return found.items;
}

function analyse(raw: string, folder: string, src: Source, item: Item) {
  const fields = readFields(raw);
  let post: Post | null = null;
  let error: string | null = null;
  try {
    post = parsePost({
      id: `${folder}/${item.file}`,
      folder: src.dir,
      text: raw,
      channel: item.resolved.channel,
      type: item.resolved.type,
      platform: item.channel.platform,
      entities: src.entities
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const empty = post?.status === 'draft' && post.text === '' && post.images.length === 0;
  return {
    fields,
    post,
    error,
    issues: post && !empty && item.channel.platform === 'linkedin' ? linkedin.validate(post, item.channel) : [],
    preview: preview(fields.body, item.channel.platform, src.entities)
  };
}

export function loadCampaign(root: string, folder: string): Campaign | null {
  const src = source(root, folder);
  if (!src || src.items.length === 0) return null;
  const avatars = new Map(channelInfos(loadChannels(root)).map((info) => [info.name, info.avatar]));
  const variants = src.items.map((item): Variant => {
    const avatar = avatars.get(item.resolved.channel);
    const raw = readFileSync(join(src.dir, item.file), 'utf8');
    return {
      base: item.base,
      channel: item.resolved.channel,
      label: item.channel.name ?? item.resolved.channel,
      platform: item.channel.platform,
      ...(avatar !== undefined && { avatar }),
      type: item.resolved.type,
      raw,
      revision: revisionOf(raw),
      ...analyse(raw, folder, src, item)
    };
  });
  return { folder, title: campaignTitle(folder, variants.map((variant) => (variant.fields.ok ? variant.fields.title : undefined))), variants, entities: Object.fromEntries(src.entities) };
}

const MAX_RAW = 200_000;

export class PlanBlocked extends Error {
  problems: string[];

  constructor(problems: string[]) {
    super(`not planned: ${problems.join('; ')}`);
    this.problems = problems;
  }
}

export async function saveVariant(
  root: string,
  store: ContentStore,
  folder: string,
  base: string,
  input: { raw: string; revision: string },
  now = new Date(),
  connection: (channel: string) => Promise<string | null> = async () => null
): Promise<Variant> {
  const src = source(root, folder);
  const item = src?.items.find((candidate) => candidate.base === base);
  if (!src || !item) throw new Error('post not found');
  if (input.raw.length > MAX_RAW) throw new Error('the file is too long');
  const path = `posts/${folder}/${base}.md`;
  const current = await store.read(path);
  if (!current) throw new Error('post not found');

  let raw = input.raw;
  if (statusOfRaw(raw) === 'planned' && statusOfRaw(current.text) !== 'planned') {
    const typed = readFields(raw);
    if (typed.ok && !typed.manual && isAutomatic(item.channel.platform) && (await connection(item.resolved.channel))) raw = withManual(raw, true);
    const checked = analyse(raw, folder, src, item);
    const fields = readFields(raw);
    const reason = fields.ok
      ? readiness({
          manual: fields.manual || !isAutomatic(item.channel.platform),
          date: fields.date,
          images: fields.images.length,
          needsImage: item.channel.platform === 'instagram',
          preview: checked.preview,
          connection: null,
          now
        })
      : null;
    const problems = [...(checked.error ? [checked.error] : []), ...checked.issues, ...(reason ? [reason] : [])];
    if (fields.ok && !fields.manual && checked.post?.replyBy) {
      const known = loadChannels(root);
      for (const [index, author] of checked.post.replyBy.entries()) {
        if (!author) continue;
        const trouble = isPerson(known[author]) ? await connection(author) : 'it is not a personal LinkedIn channel';
        if (trouble) problems.push(`comment ${index + 1} cannot be posted as ${known[author]?.name ?? author}: ${trouble}`);
      }
    }
    if (problems.length > 0) throw new PlanBlocked(problems);
  }
  await store.write(path, raw, input.revision);
  return loadCampaign(root, folder)!.variants.find((variant) => variant.base === base)!;
}

export const fitsSlug = (current: string, slug: string): boolean => current === slug || new RegExp(`^${slug}-\\d+$`).test(current);

export function freeFolder(taken: Set<string>, prefix: string, slug: string): string {
  let name = `${prefix}${slug}`;
  for (let n = 2; taken.has(name); n++) name = `${prefix}${slug}-${n}`;
  return name;
}

export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

function postFolders(root: string): string[] {
  const dir = join(root, 'posts');
  return existsSync(dir) ? readdirSync(dir).filter((name) => /^\d{4}-\d{2}-\d{2}-/.test(name)).sort() : [];
}

export function lastChannel(root: string): string | undefined {
  const last = postFolders(root).at(-1);
  return (last && listItems(root, last)?.items[0]?.resolved.channel) || undefined;
}

export async function createPost(
  root: string,
  store: ContentStore,
  input: { title: string; channels: string[]; day?: string; text?: string; link?: string; images?: { name: string; bytes: Uint8Array }[] },
  now = new Date()
): Promise<{ folder: string; base: string }> {
  const channels = loadChannels(root);
  const chosen = [...new Set(input.channels)];
  if (chosen.length === 0) throw new Error('choose at least one channel');
  for (const name of chosen) variantProblem(channels, name);
  const title = input.title.trim();
  const slug = title === '' ? 'untitled' : slugify(title);
  if (!slug) throw new Error('give the post a title with letters or numbers in it');
  const today = ymd(now);
  const folder = freeFolder(new Set(postFolders(root)), `${today}-`, slug);
  if (input.day !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.day)) throw new Error('that day is not a date');
  const when = input.day !== undefined ? `${input.day}T09:00` : `${ymd(now)}T${clock(now)}`;
  const base = setFrontmatter(`---\ntitle: x\ndate: ${when}\n---\n\n`, { title: title === '' ? undefined : title, ...(input.link && { link: input.link }) });
  const text = input.text ? withBody(base, input.text) : base;
  const images = input.images ?? [];
  const withPictures = images.length > 0 ? withImages(text, images.map((image) => image.name)) : text;
  for (const name of chosen) await store.create(`posts/${folder}/${name}.md`, withPictures);
  for (const image of images) await store.writeFile(`posts/${folder}/${image.name}`, image.bytes);
  return { folder, base: chosen[0]! };
}

function withoutStatus(text: string): string {
  try {
    return setFrontmatter(text, { status: undefined });
  } catch {
    return text;
  }
}

export const VARIANT_TYPES: Partial<Record<Platform, string[]>> = { instagram: ['story'], substack: ['note'] };

function variantProblem(channels: ReturnType<typeof loadChannels>, name: string): void {
  const resolved = resolveName(name, channels);
  if (!resolved || resolved.channel + (resolved.type ? `-${resolved.type}` : '') !== name) throw new Error('unknown channel');
  const platform = channels[resolved.channel]!.platform;
  if (resolved.type !== null && !VARIANT_TYPES[platform]?.includes(resolved.type)) throw new Error(`${PLATFORM_LABEL[platform]} has no ${resolved.type} variant`);
}

export async function addVariant(root: string, store: ContentStore, folder: string, from: string, name: string): Promise<string> {
  const channels = loadChannels(root);
  variantProblem(channels, name);
  const resolved = resolveName(name, channels)!;
  const platform = channels[resolved.channel]!.platform;
  const existing = itemsOf(root, folder);
  if (existing.some((item) => item.base === name)) throw new Error(`this channel already has a ${resolved.type ?? 'post'} variant in this post`);
  if (!existing.some((item) => item.base === from)) throw new Error('post not found');
  const source = await store.read(`posts/${folder}/${from}.md`);
  if (!source) throw new Error('post not found');
  let text = withoutStatus(source.text);
  const fields = readFields(text);
  if (fields.ok) {
    const kept = fields.images.filter((image) => takesMedia(platform, image));
    const images = resolved.type === 'story' ? kept.slice(0, 1) : kept;
    if (images.length !== fields.images.length) text = withImages(text, images);
    if (platform !== 'linkedin' && splitThread(fields.body).some((part) => part.by)) text = withBody(text, joinThread(splitThread(fields.body).map((part) => ({ text: part.text }))));
  }
  await store.create(`posts/${folder}/${name}.md`, text);
  return name;
}

const UNSETTLED = new Set(['posting', 'unconfirmed']);

async function assertSettled(states: StateStore, folder: string, bases: string[]): Promise<void> {
  for (const base of bases) {
    const state = await states.get(`${folder}/${base}.md`);
    if (state && UNSETTLED.has(state.status)) throw new Error('This is being posted or may be live. Check the platform first.');
  }
}

export async function deletePost(root: string, store: ContentStore, states: StateStore, folder: string): Promise<void> {
  const existing = itemsOf(root, folder);
  await assertSettled(states, folder, existing.map((item) => item.base));
  await store.removeFolder(`posts/${folder}`);
}

export async function deleteVariant(root: string, store: ContentStore, states: StateStore, folder: string, base: string): Promise<string> {
  const existing = itemsOf(root, folder);
  if (!existing.some((item) => item.base === base)) throw new Error('post not found');
  await assertSettled(states, folder, [base]);
  const rest = existing.filter((item) => item.base !== base);
  if (rest.length === 0) throw new Error('a post needs at least one variant');
  await store.remove(`posts/${folder}/${base}.md`);
  await states.remove(`${folder}/${base}.md`);
  return rest[0]!.base;
}

export async function syncFolder(root: string, store: ContentStore, states: StateStore, folder: string): Promise<string> {
  const found = listItems(root, folder);
  if (!found) throw new Error('post not found');
  const parsed = found.items.map((item) => readFields(readFileSync(join(found.dir, item.file), 'utf8')));
  const title = parsed.map((fields) => (fields.ok ? fields.title : undefined)).find((candidate) => candidate !== undefined && candidate.trim() !== '');
  const prefix = /^\d{4}-\d{2}-\d{2}-/.exec(folder)?.[0];
  if (!prefix) return folder;
  let live = false;
  for (const item of found.items) {
    const state = await states.get(`${folder}/${item.file}`);
    if (state?.status === 'posted' || state?.status === 'deleted') live = true;
  }
  const dates = parsed.flatMap((fields) => (fields.ok && fields.date ? [fields.date.slice(0, 10)] : [])).sort();
  const date = !live && dates[0] ? `${dates[0]}-` : prefix;
  const current = folder.slice(prefix.length);
  const slug = (title === undefined ? '' : slugify(title)) || current;
  if (date === prefix && fitsSlug(current, slug)) return folder;
  await assertSettled(states, folder, found.items.map((item) => item.base));
  const next = freeFolder(new Set(postFolders(root)), date, slug);
  await store.renameFolder(`posts/${folder}`, `posts/${next}`);
  return next;
}
