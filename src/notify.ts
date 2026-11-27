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
  store: StateStore;
  notify: Notify;
  channels: Channels;
  now: Date;
  base?: string | undefined;
  photo?: (post: Post) => Promise<Uint8Array | undefined>;
}

async function message(post: Post, posts: Post[], heading: string, detail: string | undefined, view: string | undefined, deps: ReportDeps): Promise<Message> {
  const title = titleOf(post, posts);
  const photo = await deps.photo?.(post).catch(() => undefined);
  return {
    text: [`${heading} ${whereOf(post, deps.channels)}${title ? `: ${title}` : ''}`, ...(detail ? [detail] : [])].join('\n'),
    ...(title && { bold: title }),
    ...(view && { view }),
    ...(photo && { photo })
  };
}

const own = (post: Post, deps: ReportDeps): string | undefined => (deps.base ? `${deps.base}${postPath(post)}` : undefined);

async function tell(errors: string[], deps: ReportDeps, build: () => Promise<Message>): Promise<boolean> {
  try {
    await deps.notify(await build());
    return true;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return false;
  }
}

export async function announce(posts: Post[], outcomes: Outcome[], deps: ReportDeps): Promise<string[]> {
  const errors: string[] = [];
  for (const outcome of outcomes) {
    const post = posts.find((candidate) => candidate.id === outcome.id);
    if (!post) continue;
    if (outcome.status === 'posted') {
      const state = await deps.store.get(post.id);
      const live = state?.status === 'posted' ? state.url : undefined;
      const warning = outcome.message === live ? undefined : outcome.message;
      await tell(errors, deps, () => message(post, posts, 'Posted', warning, live ?? own(post, deps), deps));
    } else if (outcome.status === 'failed') {
      await tell(errors, deps, () => message(post, posts, 'Not posted', outcome.message, own(post, deps), deps));
    } else if (outcome.status === 'unconfirmed') {
      await tell(errors, deps, () => message(post, posts, 'Check whether this was posted', outcome.message, own(post, deps), deps));
    }
  }
  return errors;
}

export async function report(posts: Post[], outcomes: Outcome[], deps: ReportDeps): Promise<string[]> {
  const errors = await announce(posts, outcomes, deps);
  const late = (await unstarted(deps.store, due(posts, deps.now).late)).filter((post) => deps.now.getTime() - post.date.getTime() <= LATE_WINDOW_MS);
  for (const post of late) {
    if (await tell(errors, deps, () => message(post, posts, 'Not posted', 'Skipped, more than an hour late.', own(post, deps), deps))) await deps.store.create(post.id, { status: 'skipped', at: deps.now.toISOString() });
  }
  return errors;
}
