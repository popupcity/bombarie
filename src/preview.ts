import { WIKILINK, entityKey } from './mentions.ts';
import type { Entities } from './mentions.ts';
import { MAX_CHARS, mentionSegments } from './linkedin.ts';
import { splitParts } from './parts.ts';
import { PLATFORM_LABEL } from './types.ts';
import type { Platform } from './types.ts';

interface Segment {
  kind: 'text' | 'mention' | 'link' | 'handle' | 'plain' | 'unknown';
  text: string;
}

export interface Preview {
  segments: Segment[];
  length: number;
  limit?: number;
  notes: string[];
  replies?: Segment[][];
}

const LINK = /((?:https?:\/\/|www\.)[^\s]*[^\s.,;:!?)\]}'"])/g;

const LIMITS: Partial<Record<Platform, number>> = { linkedin: MAX_CHARS, instagram: 2200, threads: 500 };

type Chunk = { kind: 'text' | 'handle' | 'plain' | 'unknown'; text: string };

export function preview(body: string, platform: Platform, entities: Entities): Preview {
  const [first = '', ...later] = splitParts(body);
  const main = previewPart(first, platform, entities);
  if (later.length === 0) return main;
  const notes = [...main.notes];
  const replies: Segment[][] = [];
  if (platform === 'threads' || platform === 'linkedin') {
    const word = platform === 'threads' ? 'reply' : 'comment';
    later.forEach((part, index) => {
      const reply = previewPart(part, platform, entities);
      replies.push(reply.segments);
      if (reply.length === 0) notes.push(`${word} ${index + 1} is empty`);
      if (platform === 'linkedin' && reply.length > 1250) notes.push(`${word} ${index + 1} is over the LinkedIn comment limit of 1250`);
      notes.push(...reply.notes.map((note) => `${word} ${index + 1}: ${note}`));
    });
  } else notes.push(`${PLATFORM_LABEL[platform]} does not take replies; the ${later.length} ${later.length === 1 ? 'part' : 'parts'} after the first --- would not be posted`);
  return { ...main, notes, ...(replies.length > 0 && { replies }) };
}

const linked = (text: string): Segment[] =>
  text
    .split(LINK)
    .map((piece, index): Segment => ({ kind: index % 2 === 1 ? 'link' : 'text', text: piece }))
    .filter((segment) => segment.text !== '');

function previewPart(body: string, platform: Platform, entities: Entities): Preview {
  const notes: string[] = [];
  const mentions: Record<string, string> = {};
  const chunks: Chunk[] = [];
  let at = 0;

  for (const match of body.matchAll(WIKILINK)) {
    chunks.push({ kind: 'text', text: body.slice(at, match.index) });
    at = match.index + match[0].length;
    const raw = (match[1] as string).trim();
    const entity = entities.get(entityKey(raw));
    if (!entity) {
      chunks.push({ kind: 'unknown', text: match[0] });
      notes.push(`unknown entity [[${raw}]]; add it under Entities`);
    } else if ((platform === 'instagram' || platform === 'threads') && entity.instagram) {
      chunks.push({ kind: 'handle', text: `@${entity.instagram}` });
    } else if (platform === 'linkedin' && entity.linkedin) {
      mentions[entity.name] = entity.linkedin;
      chunks.push({ kind: 'text', text: entity.name });
    } else {
      if (platform !== 'facebook' && platform !== 'substack' && platform !== 'website') notes.push(`${entity.name} has no ${PLATFORM_LABEL[platform === 'threads' ? 'instagram' : platform]} ID and is posted as plain text`);
      chunks.push({ kind: 'plain', text: entity.name });
    }
  }
  chunks.push({ kind: 'text', text: body.slice(at) });

  const segments = chunks.flatMap((chunk): Segment[] =>
    chunk.kind === 'text'
      ? mentionSegments(chunk.text, mentions)
          .filter((part) => part.text !== '')
          .flatMap((part): Segment[] => (part.urn !== undefined ? [{ kind: 'mention', text: part.text }] : platform === 'linkedin' ? linked(part.text) : [{ kind: 'text', text: part.text }]))
      : [{ kind: chunk.kind, text: chunk.text }]
  );
  const length = segments.reduce((sum, segment) => sum + segment.text.length, 0);
  const limit = LIMITS[platform];
  if (limit !== undefined && length > limit) notes.push(`the text is ${length - limit} characters over the ${PLATFORM_LABEL[platform]} limit of ${limit}`);
  return { segments, length, ...(limit !== undefined && { limit }), notes };
}
