import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Channels } from './channels.ts';
import { resolveName } from './channels.ts';
import { loadEntities } from './entities.ts';
import { isRecord, splitFrontmatter } from './frontmatter.ts';
import { expandWikilinks } from './mentions.ts';
import { splitParts } from './parts.ts';
import type { Entities } from './mentions.ts';
import { isAutomatic } from './connect.ts';
import { parseDate } from './time.ts';
import type { Platform, Post } from './types.ts';

const FORBIDDEN_BODY = ['![[', '**'];

interface ReadResult {
  posts: Post[];
  errors: string[];
}

interface PostSource {
  id: string;
  folder: string;
  text: string;
  channel: string;
  type: string | null;
  platform: Platform;
  entities: Entities;
}

export function parsePost({ id, folder, text, channel, type, platform, entities }: PostSource): Post {
  const { data, body } = splitFrontmatter(text);
  if (!isRecord(data)) throw new Error('the properties at the top must be name: value lines');

  const status = data.status ?? 'draft';
  if (status !== 'draft' && status !== 'planned') throw new Error('status must be draft or planned');

  const flag = data.manual ?? false;
  if (typeof flag !== 'boolean') throw new Error('manual must be true or false');
  const manual = flag || !isAutomatic(platform);

  if (typeof data.date !== 'string') throw new Error('date is required');
  const date = parseDate(data.date);

  const images = data.images ?? [];
  if (!Array.isArray(images) || images.some((i) => typeof i !== 'string')) {
    throw new Error('images must be a list of file names');
  }
  for (const image of images as string[]) {
    if (image.includes('/') || image.includes('\\') || image.startsWith('.')) {
      throw new Error(`image "${image}" must be a file in the post folder`);
    }
    if (!existsSync(join(folder, image))) throw new Error(`image "${image}" not found`);
  }

  if (data.link !== undefined && typeof data.link !== 'string') throw new Error('link must be a string');
  if (data.title !== undefined && typeof data.title !== 'string') throw new Error('title must be text');

  const forbidden = FORBIDDEN_BODY.find((token) => body.includes(token));
  if (forbidden) throw new Error(`the text contains "${forbidden}"; platforms show it literally`);
  const [firstPart = '', ...laterParts] = splitParts(body);
  const expanded = expandWikilinks(firstPart, platform, entities);
  const replies = laterParts.map((part) => expandWikilinks(part, platform, entities));
  if (!manual && status === 'planned' && expanded.text === '') throw new Error('the text is empty; write something before planning');

  return {
    id,
    channel,
    type,
    status,
    manual,
    date,
    images: images as string[],
    mentions: Object.assign({}, expanded.mentions, ...replies.map((reply) => reply.mentions)),
    ...(data.link !== undefined && { link: data.link }),
    ...(typeof data.title === 'string' && { title: data.title }),
    text: expanded.text,
    ...(replies.length > 0 && { replies: replies.map((reply) => reply.text) })
  };
}

export function readPosts(root: string, channels: Channels): ReadResult {
  const posts: Post[] = [];
  const errors: string[] = [];
  const dir = join(root, 'posts');
  if (!existsSync(dir)) return { posts, errors: [`${dir} not found`] };
  const { entities, errors: entityErrors } = loadEntities(root);
  errors.push(...entityErrors);

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const folder = join(dir, entry.name);
    for (const file of readdirSync(folder)) {
      if (!file.endsWith('.md')) continue;
      const id = `${entry.name}/${file}`;
      const resolved = resolveName(file.slice(0, -3), channels);
      if (!resolved) {
        errors.push(`${id}: no channel matches this file name`);
        continue;
      }
      try {
        posts.push(
          parsePost({
            id,
            folder,
            text: readFileSync(join(folder, file), 'utf8'),
            channel: resolved.channel,
            type: resolved.type,
            platform: channels[resolved.channel]!.platform,
            entities
          })
        );
      } catch (err) {
        errors.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  posts.sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
  return { posts, errors };
}
