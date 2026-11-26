import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Channels } from './channels.ts';
import { due, LATE_AFTER_MS } from './plan.ts';
import { postPath, titleOf, whereOf } from './remind.ts';
import type { Outcome } from './run.ts';
import { unstarted } from './state.ts';
import type { StateStore } from './state.ts';
import type { Message, Notify } from './telegram.ts';
import type { Post } from './types.ts';

const LATE_WINDOW_MS = LATE_AFTER_MS + 24 * 60 * 60_000;

export interface ReportDeps {
  root: string;
  store: StateStore;
  notify: Notify;
  channels: Channels;
  now: Date;
  base?: string | undefined;
  photo?: (post: Post) => Promise<Uint8Array | undefined>;
}

const toldFile = (root: string): string => join(root, '.state', 'told-late.json');

async function told(root: string): Promise<string[]> {
  try {
    const list: unknown = JSON.parse(await readFile(toldFile(root), 'utf8'));
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

async function remember(root: string, keys: string[]): Promise<void> {
  const file = toldFile(root);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, `${JSON.stringify(keys, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}

async function message(post: Post, posts: Post[], heading: string, detail: string | undefined, view: string | undefined, deps: ReportDeps): Promise<Message> {
  const title = titleOf(post, posts);
  const photo = await deps.photo?.(post).catch(() => undefined);
  return {
    text: [`${heading} ${whereOf(post, deps.channels)}:`, ...(title ? ['', title] : []), ...(detail ? ['', detail] : [])].join('\n'),
    ...(title && { bold: title }),
    ...(view && { view }),
    ...(photo && { photo })
  };
}

export async function report(posts: Post[], outcomes: Outcome[], deps: ReportDeps): Promise<string[]> {
  const errors: string[] = [];
  const own = (post: Post): string | undefined => (deps.base ? `${deps.base}${postPath(post)}` : undefined);
  const tell = async (build: () => Promise<Message>): Promise<boolean> => {
    try {
      await deps.notify(await build());
      return true;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  for (const outcome of outcomes) {
    const post = posts.find((candidate) => candidate.id === outcome.id);
    if (!post) continue;
    if (outcome.status === 'posted') {
      const state = await deps.store.get(post.id);
      const live = state?.status === 'posted' ? state.url : undefined;
      const warning = outcome.message === live ? undefined : outcome.message;
      await tell(() => message(post, posts, 'Posted on', warning, live ?? own(post), deps));
    } else if (outcome.status === 'failed') {
      await tell(() => message(post, posts, 'Not posted on', outcome.message, own(post), deps));
    } else if (outcome.status === 'unconfirmed') {
      await tell(() => message(post, posts, 'It may or may not be posted. Check', outcome.message, own(post), deps));
    }
  }

  const known = await told(deps.root);
  const late = (await unstarted(deps.store, due(posts, deps.now).late)).filter((post) => deps.now.getTime() - post.date.getTime() <= LATE_WINDOW_MS);
  for (const post of late) {
    const key = `${post.id}@${post.date.toISOString()}`;
    if (known.includes(key)) continue;
    if (await tell(() => message(post, posts, 'Skipped, more than an hour late, on', undefined, own(post), deps))) {
      known.push(key);
      await remember(deps.root, known);
    }
  }
  return errors;
}
