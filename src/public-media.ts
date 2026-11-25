import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

export type PublicKind = 'jpg' | 'story' | 'mp4';

const KINDS: PublicKind[] = ['jpg', 'story', 'mp4'];
const SAFE = /^[^/\\.][^/\\]*$/;

export const STORY = { width: 1080, height: 1920 } as const;

export async function storyFrame(bytes: Uint8Array): Promise<Buffer> {
  const source = sharp(bytes).rotate();
  const background = await source.clone().resize(STORY.width, STORY.height, { fit: 'cover' }).blur(40).modulate({ brightness: 0.7 }).jpeg({ quality: 80 }).toBuffer();
  const picture = await source.clone().resize(STORY.width, STORY.height, { fit: 'inside' }).toBuffer();
  return sharp(background).composite([{ input: picture, gravity: 'centre' }]).flatten({ background: '#000000' }).jpeg({ quality: 90 }).toBuffer();
}

const sign = (secret: string, kind: string, folder: string, file: string): string => createHmac('sha256', secret).update(`${kind}/${folder}/${file}`).digest('hex').slice(0, 32);

export const publicPath = (secret: string, kind: PublicKind, folder: string, file: string): string =>
  `${sign(secret, kind, folder, file)}/${kind}/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`;

export async function renderPublic(root: string, secret: string, parts: string[]): Promise<{ bytes: Buffer; type: string } | null> {
  const [signature = '', kind = '', folder = '', file = '', ...rest] = parts;
  if (rest.length > 0 || !KINDS.includes(kind as PublicKind) || !SAFE.test(folder) || !SAFE.test(file)) return null;
  const expected = Buffer.from(sign(secret, kind, folder, file));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let source: Buffer;
  try {
    source = await readFile(join(root, 'posts', folder, file));
  } catch {
    return null;
  }
  if (kind === 'mp4') return { bytes: source, type: 'video/mp4' };
  const jpeg = kind === 'story' ? await storyFrame(source) : await sharp(source).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
  return { bytes: jpeg, type: 'image/jpeg' };
}
