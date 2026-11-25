import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { setChannelField } from './channels.ts';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_HOSTS = ['licdn.com', 'cdninstagram.com', 'fbcdn.net'];

export function checkAvatarUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('avatar url is not a valid URL');
  }
  if (url.protocol !== 'https:') throw new Error('avatar url must be https');
  if (!ALLOWED_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error(`avatar host ${url.hostname} is not allowed`);
  }
  return url;
}

export async function downloadAvatar(value: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  const url = checkAvatarUrl(value);
  const res = await fetchImpl(url.toString(), { redirect: 'error' });
  if (!res.ok) throw new Error(`avatar download failed (${res.status})`);
  if (!(res.headers.get('content-type') ?? '').startsWith('image/')) throw new Error('avatar is not an image');
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('avatar is too large');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error('avatar is too large');
  return bytes;
}

export async function saveAvatar(root: string, channel: string, bytes: Uint8Array): Promise<string> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(channel)) throw new Error(`unsafe channel name "${channel}"`);
  const relative = `avatars/${channel}.jpg`;
  const jpeg = await sharp(bytes).rotate().resize(256, 256, { fit: 'cover' }).jpeg({ quality: 82 }).toBuffer();
  await mkdir(join(root, 'avatars'), { recursive: true });
  const file = join(root, relative);
  await writeFile(`${file}.tmp`, jpeg);
  await rename(`${file}.tmp`, file);
  return relative;
}

export async function storeAvatar(args: {
  root: string;
  channel: string;
  picture: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const bytes = await downloadAvatar(args.picture, args.fetchImpl);
  const relative = await saveAvatar(args.root, args.channel, bytes);
  await setChannelField(args.root, args.channel, 'avatar', relative);
  return relative;
}
