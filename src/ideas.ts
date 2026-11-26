import { fetchPreview, type PreviewDeps } from './link-preview.ts';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fitsSlug, freeFolder, slugify } from './campaign.ts';
import type { ContentStore } from './content-store.ts';
import { isRecord, setFrontmatter, splitFrontmatter, withBody, withImages } from './frontmatter.ts';
import { ymd } from './time.ts';

export type IdeaStatus = 'new' | 'approved' | 'made';

export interface Idea {
  folder: string;
  title: string;
  text: string;
  link?: string;
  linkTitle?: string;
  linkSite?: string;
  linkImage?: string;
  status: IdeaStatus;
  images: string[];
  post?: string;
}

const STATUSES: IdeaStatus[] = ['new', 'approved', 'made'];
const FILE = 'idea.md';

export const domainOf = (link: string): string => new URL(link).hostname.replace(/^www\./, '');

export function cleanLink(value: string): string | undefined {
  const text = value.trim();
  if (text === '') return undefined;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error('that link is not a web address; start it with https://');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('that link is not a web address; start it with https://');
  return url.toString();
}

function parseIdea(folder: string, raw: string): Idea {
  const { data, body } = splitFrontmatter(raw);
  const fields = isRecord(data) ? data : {};
  const status = typeof fields.status === 'string' && (STATUSES as string[]).includes(fields.status) ? (fields.status as IdeaStatus) : 'new';
  return {
    folder,
    title: typeof fields.title === 'string' ? fields.title.trim() : '',
    text: body.trim(),
    status,
    images: Array.isArray(fields.media) ? fields.media.filter((item): item is string => typeof item === 'string') : [],
    ...(typeof fields.link === 'string' && fields.link !== '' && { link: fields.link }),
    ...(typeof fields.linkTitle === 'string' && fields.linkTitle !== '' && { linkTitle: fields.linkTitle }),
    ...(typeof fields.linkSite === 'string' && fields.linkSite !== '' && { linkSite: fields.linkSite }),
    ...(typeof fields.linkImage === 'string' && fields.linkImage !== '' && { linkImage: fields.linkImage }),
    ...(typeof fields.post === 'string' && fields.post !== '' && { post: fields.post })
  };
}

export function ideaFolders(root: string): string[] {
  const dir = join(root, 'ideas');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, FILE)))
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

export function readIdea(root: string, folder: string): Idea | null {
  if (!ideaFolders(root).includes(folder)) return null;
  return parseIdea(folder, readFileSync(join(root, 'ideas', folder, FILE), 'utf8'));
}

export const listIdeas = (root: string): Idea[] => ideaFolders(root).map((folder) => readIdea(root, folder) as Idea);

export function titleFrom(input: string): { title: string; text?: string; link?: string } {
  const lines = input.trim().split(/\r?\n/);
  const first = (lines[0] ?? '').trim();
  const rest = lines.slice(1).join('\n').trim();
  const body = rest === '' ? {} : { text: rest };
  try {
    const link = cleanLink(first);
    if (link && !/\s/.test(first)) return { title: domainOf(link), link, ...body };
  } catch {
    return { title: first, ...body };
  }
  return { title: first, ...body };
}

export async function createIdea(root: string, store: ContentStore, input: { title?: string; text?: string; link?: string; name?: string }, now = new Date()): Promise<string> {
  const title = (input.title ?? '').trim();
  const slug = slugify(title) || slugify((input.name ?? '').replace(/\.[A-Za-z0-9]+$/, ''));
  if (!slug) throw new Error('give the idea a title with letters or numbers in it, or add an image');
  const link = input.link ? cleanLink(input.link) : undefined;
  const folder = freeFolder(new Set(ideaFolders(root)), `${ymd(now)}-`, slug);
  const base = setFrontmatter('---\ntitle: x\n---\n\n', { title: title === '' ? undefined : title, ...(link && { link }) });
  await store.create(`ideas/${folder}/${FILE}`, input.text ? withBody(base, input.text) : base);
  return folder;
}

async function change(root: string, store: ContentStore, folder: string, edit: (raw: string) => string): Promise<void> {
  if (!readIdea(root, folder)) throw new Error('idea not found');
  const path = `ideas/${folder}/${FILE}`;
  const current = await store.read(path);
  if (!current) throw new Error('idea not found');
  await store.write(path, edit(current.text), current.revision);
}

export async function saveIdea(root: string, store: ContentStore, folder: string, input: { title: string; text: string; link: string }, keepFolder = false): Promise<string> {
  const title = input.title.trim();
  const idea = readIdea(root, folder);
  if (!idea) throw new Error('idea not found');
  const link = cleanLink(input.link);
  if (!slugify(title) && idea.images.length === 0 && input.text.trim() === '' && !link) throw new Error('give the idea a title with letters or numbers in it, or add an image');
  await change(root, store, folder, (raw) => withBody(setFrontmatter(raw, { title: title === '' ? undefined : title, link }), input.text));
  return keepFolder ? folder : syncIdeaFolder(root, store, folder, title);
}

async function syncIdeaFolder(root: string, store: ContentStore, folder: string, title: string): Promise<string> {
  const slug = slugify(title);
  const date = /^\d{4}-\d{2}-\d{2}-/.exec(folder)?.[0];
  if (!slug || !date) return folder;
  const current = folder.slice(date.length);
  if (fitsSlug(current, slug)) return folder;
  const next = freeFolder(new Set(ideaFolders(root)), date, slug);
  await store.renameFolder(`ideas/${folder}`, `ideas/${next}`);
  return next;
}

export const setIdeaStatus = (root: string, store: ContentStore, folder: string, status: IdeaStatus, post?: string): Promise<void> =>
  change(root, store, folder, (raw) => setFrontmatter(raw, { status: status === 'new' ? undefined : status, post }));

export async function attachPreview(root: string, store: ContentStore, folder: string, deps?: PreviewDeps): Promise<void> {
  const idea = readIdea(root, folder);
  if (!idea) return;
  const preview = idea.link ? await fetchPreview(idea.link, deps) : null;
  let image: string | undefined;
  if (preview?.image) {
    image = `link.${preview.image.ext}`;
    await store.writeFile(`ideas/${folder}/${image}`, preview.image.bytes);
  }
  if (idea.linkImage && idea.linkImage !== image) await store.removeFile(`ideas/${folder}/${idea.linkImage}`).catch(() => undefined);
  const named = preview?.title && idea.link && idea.title === domainOf(idea.link) ? { title: preview.title } : {};
  await change(root, store, folder, (raw) => setFrontmatter(raw, { linkTitle: preview?.title, linkSite: preview?.site, linkImage: image, ...named }));
}

export async function deleteIdea(root: string, store: ContentStore, folder: string): Promise<void> {
  if (!readIdea(root, folder)) throw new Error('idea not found');
  await store.removeFolder(`ideas/${folder}`);
}

export async function addIdeaImage(root: string, store: ContentStore, folder: string, name: string): Promise<void> {
  await change(root, store, folder, (raw) => withImages(raw, [...new Set([...parseIdea(folder, raw).images, name])]));
}

export async function removeIdeaImage(root: string, store: ContentStore, folder: string, name: string): Promise<void> {
  const idea = readIdea(root, folder);
  if (!idea?.images.includes(name)) throw new Error('image not found');
  await change(root, store, folder, (raw) => withImages(raw, parseIdea(folder, raw).images.filter((item) => item !== name)));
  await store.removeFile(`ideas/${folder}/${name}`);
}

export const ideaTitle = (idea: Idea): string => idea.title || idea.text.split('\n').find((line) => line.trim() !== '') || '';

export async function relinkIdeas(root: string, store: ContentStore, from: string, to: string): Promise<void> {
  for (const idea of listIdeas(root)) {
    if (idea.post === from) await setIdeaStatus(root, store, idea.folder, idea.status, to);
  }
}
