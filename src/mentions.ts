import type { Platform } from './types.ts';

export interface Entity {
  name: string;
  slug: string;
  linkedin?: string;
  instagram?: string;
}

export type Entities = Map<string, Entity>;

export const WIKILINK = /\[\[([^[\]|#]+)\]\]/g;
export function entityKey(name: string): string {
  return name.trim().normalize('NFC').toLowerCase();
}

export function expandWikilinks(body: string, platform: Platform, entities: Entities): { text: string; mentions: Record<string, string> } {
  const mentions: Record<string, string> = {};
  const text = body.replace(WIKILINK, (_, raw: string) => {
    const entity = entities.get(entityKey(raw));
    if (!entity) throw new Error(`unknown entity [[${raw.trim()}]]; create entities/${raw.trim()}.md`);
    if (platform === 'instagram' && entity.instagram) return `@${entity.instagram}`;
    if (platform === 'linkedin' && entity.linkedin) mentions[entity.name] = entity.linkedin;
    return entity.name;
  });
  if (text.includes('[[') || text.includes(']]')) {
    throw new Error('only [[Name]] links are supported, not aliases, headings or embeds');
  }
  return { text, mentions };
}

export type Trigger = 'at' | 'wiki';

const NAME_CHAR = /[\p{L}\p{N}._%+-]/u;
const MAX_QUERY = 40;

export function toEdit(body: string, entities: Entities): string {
  return body.replace(WIKILINK, (match, raw: string) => {
    const entity = entities.get(entityKey(raw));
    return entity ? `@${entity.name}` : match;
  });
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function fromEdit(text: string, entities: Entities): string {
  const names = [...entities.values()].map((entity) => entity.name).sort((a, b) => b.length - a.length);
  if (names.length === 0) return text;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}._%+-])@(${names.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  return text.replace(pattern, (_, name: string) => `[[${entities.get(entityKey(name))?.name ?? name}]]`);
}

export function suggest(query: string, entities: Entities, limit = 8): Entity[] {
  const wanted = entityKey(query);
  const byName = (a: Entity, b: Entity) => a.name.localeCompare(b.name);
  const all = [...entities.values()];
  const starts = all.filter((entity) => entityKey(entity.name).startsWith(wanted)).sort(byName);
  const contains = all
    .filter((entity) => !entityKey(entity.name).startsWith(wanted) && entityKey(entity.name).includes(wanted))
    .sort(byName);
  return [...starts, ...contains].slice(0, limit);
}

export function triggerAt(text: string, caret: number, kind: Trigger): { start: number; query: string } | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  const line = text.slice(Math.min(lineStart, caret), caret);
  const base = caret - line.length;
  if (kind === 'wiki') {
    const at = line.lastIndexOf('[[');
    if (at === -1 || line.slice(at).includes(']]')) return null;
    const query = line.slice(at + 2);
    return query.length > MAX_QUERY ? null : { start: base + at, query };
  }
  const at = line.lastIndexOf('@');
  if (at === -1) return null;
  const before = line[at - 1];
  if (before !== undefined && NAME_CHAR.test(before)) return null;
  const query = line.slice(at + 1);
  return query.length > MAX_QUERY ? null : { start: base + at, query };
}
