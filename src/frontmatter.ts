import { isSeq, parse, parseDocument } from 'yaml';
import { joinFirst, splitFirst } from './parts.ts';
import type { PostStatus } from './types.ts';

export type Fields =
  | { ok: true; date: string; manual: boolean; status: PostStatus; by?: string; images: string[]; title: string; body: string }
  | { ok: false; error: string; body: string };

const NO_HEAD = 'the file has no properties at the top (a block between two --- lines)';
const NOT_CLOSED = 'the properties at the top are not closed with a second ---';
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parts(raw: string): { head: string; rest: string } {
  const text = raw.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) throw new Error(NO_HEAD);
  const end = text.indexOf('\n---\n', 3);
  if (end === -1) throw new Error(NOT_CLOSED);
  return { head: text.slice(0, end + 5), rest: text.slice(end + 5) };
}

export function splitFrontmatter(raw: string): { data: unknown; body: string } {
  const { head, rest } = parts(raw);
  return { data: parse(head.slice(4, -5)), body: rest.trim() };
}

export function readFields(raw: string): Fields {
  try {
    const { data, body } = splitFrontmatter(raw);
    if (!isRecord(data)) return { ok: false, error: 'the properties at the top must be name: value lines', body };
    const first = splitFirst(body);
    return {
      ok: true,
      date: typeof data.date === 'string' && LOCAL_DATE.test(data.date) ? data.date : '',
      manual: data.manual === true,
      status: data.status === 'planned' ? 'planned' : 'draft',
      ...(typeof data.by === 'string' && data.by !== '' && { by: data.by }),
      images: first.images,
      title: typeof data.title === 'string' ? data.title : '',
      body: first.images.length > 0 ? joinFirst(first.text, [], first.rest) : body
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), body: raw };
  }
}

export const statusOfRaw = (raw: string): PostStatus => {
  const fields = readFields(raw);
  return fields.ok ? fields.status : 'draft';
};

const written = (head: string, body: string): string => `${head}${body.replace(/\r\n/g, '\n').trim()}\n`;

function compose(raw: string, body: string, images: string[]): string {
  const next = splitFirst(body.replace(/\r\n/g, '\n'));
  return written(parts(raw).head, joinFirst(next.text, [...images, ...next.images.filter((name) => !images.includes(name))], next.rest));
}

export const withBody = (raw: string, body: string): string => compose(raw, body, splitFirst(parts(raw).rest).images);

export function setFrontmatter(raw: string, changes: Record<string, string | boolean | string[] | undefined>): string {
  const { head, rest } = parts(raw);
  const doc = parseDocument(head.slice(4, -5));
  if (doc.errors.length > 0) throw new Error(`the properties at the top are not valid: ${doc.errors[0]?.message}`);
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) doc.delete(key);
    else if (Array.isArray(value)) {
      const style = doc.get(key, true);
      const list = doc.createNode(value);
      list.flow = isSeq(style) ? (style.flow ?? false) : true;
      doc.set(key, list);
    } else doc.set(key, value);
  }
  return `---\n${doc.toString({ flowCollectionPadding: false })}---\n${rest}`;
}

export const withDate = (raw: string, date: string): string => (date === '' ? raw : setFrontmatter(raw, { date }));
export const withManual = (raw: string, manual: boolean): string => setFrontmatter(raw, { manual: manual ? true : undefined });
export function withImages(raw: string, images: string[]): string {
  const current = splitFirst(parts(raw).rest);
  return written(parts(raw).head, joinFirst(current.text, images, current.rest));
}
export const withTitle = (raw: string, title: string): string => setFrontmatter(raw, { title: title.trim() === '' ? undefined : title });
export const withStatus = (raw: string, status: PostStatus): string => setFrontmatter(raw, { status });
