import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isRecord, splitFrontmatter } from './frontmatter.ts';
import { slugify } from './campaign.ts';
import { entityKey } from './mentions.ts';
import type { Entities, Entity } from './mentions.ts';

const KEYS = new Set(['name', 'linkedin', 'instagram']);
const URN = /^urn:li:(person|organization):\S+$/;
const HANDLE = /^[A-Za-z0-9._]+$/;

function parseEntity(slug: string, text: string): Entity {
  const { data } = splitFrontmatter(`${text}\n`);
  if (!isRecord(data)) throw new Error('the properties at the top must be name: value lines, starting with name');
  for (const key of Object.keys(data)) {
    if (!KEYS.has(key)) throw new Error(`unknown key "${key}"; use name, linkedin or instagram`);
  }
  if (typeof data.name !== 'string' || data.name.trim() === '') throw new Error('name is missing');
  const name = data.name.trim();
  if (/[[\]|#]/.test(name)) throw new Error('the name cannot contain [ ] | or #');
  const entity: Entity = { name, slug };
  if (data.linkedin !== undefined) {
    if (typeof data.linkedin !== 'string' || !URN.test(data.linkedin)) {
      throw new Error('linkedin must be a urn:li:person: or urn:li:organization: urn');
    }
    entity.linkedin = data.linkedin;
  }
  if (data.instagram !== undefined) {
    if (typeof data.instagram !== 'string' || !HANDLE.test(data.instagram)) {
      throw new Error('instagram must be a handle without @');
    }
    entity.instagram = data.instagram;
  }
  return entity;
}

export function loadEntities(root: string): { entities: Entities; errors: string[] } {
  const entities: Entities = new Map();
  const errors: string[] = [];
  const dir = join(root, 'entities');
  if (!existsSync(dir)) return { entities, errors };

  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.md')) continue;
    try {
      const entity = parseEntity(file.slice(0, -3), readFileSync(join(dir, file), 'utf8'));
      const existing = entities.get(entityKey(entity.name));
      if (existing) throw new Error(`same name as ${existing.name} apart from case`);
      entities.set(entityKey(entity.name), entity);
    } catch (err) {
      errors.push(`entities/${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { entities, errors };
}

export function findEntity(root: string, slug: string): Entity | undefined {
  return [...loadEntities(root).entities.values()].find((entity) => entity.slug === slug);
}

const entityFile = (root: string, slug: string): string => join(root, 'entities', `${slug}.md`);
const yamlText = (text: string): string => (/^[\p{L}\p{N}][\p{L}\p{N} ._()-]*$/u.test(text) && !text.endsWith(' ') ? text : JSON.stringify(text));

type EntityInput = { name: string; linkedin: string; instagram: string };

function clean(input: EntityInput): EntityInput {
  const name = input.name.trim();
  const linkedin = input.linkedin.trim();
  const instagram = input.instagram.trim().replace(/^@/, '');
  if (!/[A-Za-z0-9À-ÿ]/.test(name)) throw new Error('give it a name with letters or numbers in it');
  if (/[[\]|#/\\]/.test(name) || name.startsWith('.')) throw new Error('the name cannot contain [ ] | # / or \\');
  if (linkedin !== '' && !URN.test(linkedin)) throw new Error('linkedin must be a urn:li:person: or urn:li:organization: urn');
  if (instagram !== '' && !HANDLE.test(instagram)) throw new Error('instagram must be a handle without @');
  return { name, linkedin, instagram };
}

function slugFor(name: string, others: Entity[]): string {
  const slug = slugify(name);
  const clash = others.find((entity) => entity.slug === slug);
  if (slug === '' || slug === 'new' || clash) throw new Error(`the name is too close to ${clash ? clash.name : 'a reserved word'}`);
  return slug;
}

const render = ({ name, linkedin, instagram }: EntityInput, body: string): string => {
  const lines = [`name: ${yamlText(name)}`, ...(linkedin ? [`linkedin: ${linkedin}`] : []), ...(instagram ? [`instagram: ${instagram}`] : [])];
  return `---\n${lines.join('\n')}\n---\n${body === '' ? '' : `\n${body}\n`}`;
};

export async function addEntity(root: string, input: EntityInput): Promise<string> {
  const entity = clean(input);
  const { entities } = loadEntities(root);
  const existing = entities.get(entityKey(entity.name));
  if (existing) throw new Error(`${existing.name} already exists`);
  const slug = slugFor(entity.name, [...entities.values()]);
  await mkdir(join(root, 'entities'), { recursive: true });
  await writeFile(entityFile(root, slug), render(entity, ''));
  return entity.name;
}

export async function updateEntity(root: string, slug: string, input: EntityInput): Promise<{ slug: string; name: string; posts: number }> {
  const entity = clean(input);
  const { entities } = loadEntities(root);
  const existing = [...entities.values()].find((candidate) => candidate.slug === slug);
  if (!existing) throw new Error('entity not found');
  const others = [...entities.values()].filter((candidate) => candidate !== existing);
  const same = others.find((candidate) => entityKey(candidate.name) === entityKey(entity.name));
  if (same) throw new Error(`${same.name} already exists`);
  const next = slugFor(entity.name, others);
  const from = entityFile(root, slug);
  await writeFile(from, render(entity, splitFrontmatter(`${readFileSync(from, 'utf8')}\n`).body.trim()));
  if (next !== slug) await rename(from, entityFile(root, next));
  return { slug: next, name: entity.name, posts: entity.name === existing.name ? 0 : await renameMentions(root, existing.name, entity.name) };
}

function* postFiles(root: string): Generator<string> {
  const dir = join(root, 'posts');
  for (const folder of existsSync(dir) ? readdirSync(dir) : []) {
    const path = join(dir, folder);
    for (const file of existsSync(path) ? readdirSync(path).filter((item) => item.endsWith('.md')) : []) yield join(path, file);
  }
}

async function renameMentions(root: string, from: string, to: string): Promise<number> {
  const pattern = new RegExp(`\\[\\[${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`, 'gi');
  let changed = 0;
  for (const file of postFiles(root)) {
    const text = readFileSync(file, 'utf8');
    const next = text.replace(pattern, () => `[[${to}]]`);
    if (next === text) continue;
    await writeFile(file, next);
    changed++;
  }
  return changed;
}

export function entityMentions(root: string, name: string): number {
  const needle = `[[${name.toLowerCase()}]]`;
  let count = 0;
  for (const file of postFiles(root)) if (readFileSync(file, 'utf8').toLowerCase().includes(needle)) count++;
  return count;
}

export async function removeEntity(root: string, name: string): Promise<void> {
  const existing = loadEntities(root).entities.get(entityKey(name));
  if (!existing) throw new Error('entity not found');
  const used = entityMentions(root, existing.name);
  if (used > 0) throw new Error(`${existing.name} is used in ${used} ${used === 1 ? 'post' : 'posts'}; remove it there first`);
  await rm(entityFile(root, existing.slug), { force: true });
}
