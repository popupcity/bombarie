import { createHash } from 'node:crypto';
import type { ContentStore } from './content-store.ts';
import { renameMedia } from './parts.ts';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,100}\.(jpe?g|png|gif|webp|pdf|mp4)$/i;

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0): boolean => signature.every((value, i) => bytes[offset + i] === value);

export function sniff(bytes: Uint8Array): 'jpg' | 'png' | 'gif' | 'webp' | 'pdf' | 'mp4' | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4) && !startsWith(bytes, [0x71, 0x74, 0x20, 0x20], 8)) return 'mp4';
  return null;
}

const digest = (bytes: Uint8Array): string => createHash('sha1').update(bytes).digest('hex');

export function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  return base.normalize('NFC').replace(/[^A-Za-z0-9 ._()-]/g, '-').replace(/^[^A-Za-z0-9]+/, '');
}

export function tidyName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const suffix = /\.(pdf|mp4)\.cover\.jpg$/i.exec(base)?.[0] ?? /\.[A-Za-z0-9]+$/.exec(base)?.[0] ?? '';
  const stem = base
    .slice(0, base.length - suffix.length)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `${stem || 'image'}${suffix.toLowerCase()}`;
}

export async function saveImage(store: ContentStore, folder: string, filename: string, bytes: Uint8Array, area: 'posts' | 'ideas' = 'posts'): Promise<string> {
  if (bytes.length === 0) throw new Error('the file is empty');
  const kind = sniff(bytes);
  if ((kind === 'pdf' || kind === 'mp4') && area === 'ideas') throw new Error(`${kind === 'pdf' ? 'PDF files' : 'Videos'} can be added to a post, not to an idea`);
  const limit = kind === 'mp4' ? MAX_VIDEO_BYTES : kind === 'pdf' ? MAX_DOCUMENT_BYTES : MAX_IMAGE_BYTES;
  if (bytes.length > limit) throw new Error(kind === 'mp4' ? 'the video is over 100 MB' : kind === 'pdf' ? 'the PDF is over 50 MB' : 'the image is over 10 MB');
  if (!kind) throw new Error(startsWith(bytes, [0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20], 4) ? 'a QuickTime (.mov) video must be converted to MP4 first' : 'only JPEG, PNG, GIF and WebP images, MP4 videos and PDF files are accepted');
  const cleaned = tidyName(filename);
  if (!SAFE_NAME.test(cleaned)) throw new Error('the file name is not usable');
  const dot = cleaned.lastIndexOf('.');
  const stem = cleaned.slice(0, dot);
  const extension = kind === 'jpg' ? (/\.jpe?g$/i.test(cleaned) ? cleaned.slice(dot + 1) : 'jpg') : kind;
  const taken = new Set(await store.list(`${area}/${folder}`));
  const hash = digest(bytes);
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? `${stem}.${extension}` : `${stem}-${n}.${extension}`;
    if (taken.has(candidate)) {
      const existing = await store.readFile(`${area}/${folder}/${candidate}`);
      if (existing && digest(existing) === hash) return candidate;
      continue;
    }
    await store.writeFile(`${area}/${folder}/${candidate}`, bytes);
    return candidate;
  }
  throw new Error('too many files with that name');
}

export async function renameImage(store: ContentStore, folder: string, from: string, wanted: string): Promise<string> {
  const files = await store.list(`posts/${folder}`);
  if (!files.includes(from)) throw new Error('file not found');
  const dot = from.lastIndexOf('.');
  const extension = from.slice(dot);
  const typed = cleanName(wanted.trim());
  const stem = (typed.toLowerCase().endsWith(extension.toLowerCase()) ? typed.slice(0, -extension.length) : typed).replace(/[. ]+$/, '');
  const to = `${stem}${extension}`;
  if (stem === '' || !SAFE_NAME.test(to)) throw new Error('the file name is not usable');
  if (to === from) return from;
  if (files.includes(to)) throw new Error(`${to} already exists in this post`);
  await store.renameFile(`posts/${folder}/${from}`, `posts/${folder}/${to}`);
  if (files.includes(`${from}.cover.jpg`)) await store.renameFile(`posts/${folder}/${from}.cover.jpg`, `posts/${folder}/${to}.cover.jpg`);
  for (const file of files.filter((name) => name.endsWith('.md'))) {
    const current = await store.read(`posts/${folder}/${file}`);
    if (!current) continue;
    const next = renameMedia(current.text, from, to);
    if (next === current.text) continue;
    await store.write(`posts/${folder}/${file}`, next, current.revision);
  }
  return to;
}

export function byteRange(header: string | null, size: number): { first: number; last: number } | 'unsatisfiable' | null {
  const range = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!range || (!range[1] && !range[2])) return null;
  const first = range[1] ? Number(range[1]) : Math.max(size - Number(range[2]), 0);
  const last = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  return first > last || first >= size ? 'unsatisfiable' : { first, last };
}

export async function removeUnusedFile(store: ContentStore, folder: string, file: string, used: string[]): Promise<void> {
  const files = await store.list(`posts/${folder}`);
  if (!SAFE_NAME.test(file) || !files.includes(file)) throw new Error('file not found');
  if (used.includes(file)) throw new Error('a variant still uses this file');
  await store.removeFile(`posts/${folder}/${file}`);
  if (files.includes(`${file}.cover.jpg`)) await store.removeFile(`posts/${folder}/${file}.cover.jpg`);
}
