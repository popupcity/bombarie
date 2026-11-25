import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_VIDEO_BYTES, renameImage, saveImage } from '../../../src/media.ts';
import { content, json, root } from '../../lib/data.ts';
import { serveBytes } from '../../lib/serve.ts';

const TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  mp4: 'video/mp4'
};

const CACHE = 'private, max-age=300';

export const GET: APIRoute = async ({ params, url, request }) => {
  const path = params.path ?? '';
  const file = resolve(root, path.startsWith('avatars/') || path.startsWith('ideas/') ? path : `posts/${path}`);
  const type = TYPES[file.split('.').pop()?.toLowerCase() ?? ''];
  const allowed = ['posts', 'ideas', 'avatars'].some((dir) => file.startsWith(resolve(root, dir) + sep));
  if (!allowed || !type) return new Response('not found', { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch {
    return new Response('not found', { status: 404 });
  }

  const plain = type === 'application/pdf' || type === 'video/mp4';
  const width = plain ? 0 : Number(url.searchParams.get('w'));
  if (width >= 16 && width <= 1600) {
    const scaled = await sharp(bytes).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    return serveBytes(request, scaled, 'image/jpeg', CACHE);
  }
  const size = plain ? 0 : Number(url.searchParams.get('size'));
  if (size >= 16 && size <= 1200) {
    const thumb = await sharp(bytes).rotate().resize(size, size, { fit: 'cover' }).jpeg({ quality: 72 }).toBuffer();
    return serveBytes(request, thumb, 'image/jpeg', CACHE);
  }
  return serveBytes(request, bytes, type, CACHE);
};

export const PUT: APIRoute = async ({ params, request }) => {
  const [folder = '', filename = ''] = (params.path ?? '').split('/').map(decodeURIComponent);
  if (!/^[^/\\]+$/.test(folder) || folder.startsWith('.') || !existsSync(join(root, 'posts', folder))) return json({ error: 'post not found' }, 404);
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_VIDEO_BYTES) return json({ error: 'the file is over 100 MB' }, 413);
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const name = await saveImage(content, folder, filename, bytes);
    return json({ name });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
};

export const PATCH: APIRoute = async ({ params, request }) => {
  const [folder = '', filename = ''] = (params.path ?? '').split('/').map(decodeURIComponent);
  if (!/^[^/\\]+$/.test(folder) || folder.startsWith('.') || !existsSync(join(root, 'posts', folder))) return json({ error: 'post not found' }, 404);
  const { name } = (await request.json().catch(() => ({}))) as { name?: unknown };
  if (typeof name !== 'string') return json({ error: 'name is required' }, 400);
  try {
    return json({ name: await renameImage(content, folder, filename, name) });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
};
