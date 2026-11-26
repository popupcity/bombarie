import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { needsCover } from '../../src/types.ts';
import type { Post } from '../../src/types.ts';

export async function thumbnail(root: string, post: Post): Promise<Uint8Array | undefined> {
  const first = post.images[0];
  if (!first) return undefined;
  const name = needsCover(first) && !first.endsWith('.cover.jpg') ? `${first}.cover.jpg` : first;
  const bytes = await readFile(join(root, 'posts', post.id.split('/')[0] ?? '', name));
  return sharp(bytes).rotate().resize(640, 640, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
}
