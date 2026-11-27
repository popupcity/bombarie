import { due } from './plan.ts';
import type { Channels } from './channels.ts';
import { speakers } from './speaker.ts';
import { checkpoint, claim, complete, fail, unstarted, isNotice } from './state.ts';
import type { StateStore } from './state.ts';
import { ProviderError } from './types.ts';
import type { Credentials, Platform, Post, Provider, SendContext } from './types.ts';

export interface RunDeps {
  store: StateStore;
  channels: Channels;
  providers: Partial<Record<Platform, Provider>>;
  credentials(channel: string): Promise<Credentials | null>;
  context(post: Post): Omit<SendContext, 'checkpoint'>;
  now: Date;
  dryRun?: boolean;
  by?: string;
}

type OutcomeStatus = 'posted' | 'would-post' | 'invalid' | 'skipped' | 'retry' | 'failed' | 'unconfirmed' | 'error';

export interface Outcome {
  id: string;
  status: OutcomeStatus;
  message?: string;
}

const RETRYABLE = new Set(['transient', 'rate', 'auth']);

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function failure(post: Post, err: unknown, deps: RunDeps): Promise<Outcome> {
  const message = messageOf(err);
  const code = err instanceof ProviderError ? err.code : 'unconfirmed';
  if (RETRYABLE.has(code)) {
    await deps.store.remove(post.id);
    return { id: post.id, status: 'retry', message };
  }
  const unconfirmed = code === 'unconfirmed';
  await fail(deps.store, post.id, message, deps.now, unconfirmed);
  return { id: post.id, status: unconfirmed ? 'unconfirmed' : 'failed', message };
}

export interface RunHooks {
  onClaimed?: () => void;
}

async function sendOne(post: Post, deps: RunDeps, hooks: RunHooks = {}): Promise<Outcome> {
  const { id } = post;
  const channel = deps.channels[post.channel];
  const provider = channel && deps.providers[channel.platform];
  if (!channel || !provider) return { id, status: 'skipped', message: `no provider for ${post.channel}` };

  const issues = provider.validate(post, channel);
  if (issues.length > 0) return { id, status: 'invalid', message: issues.join('; ') };
  if (deps.dryRun) return { id, status: 'would-post' };

  const credentials = await deps.credentials(post.channel);
  if (!credentials) return { id, status: 'skipped', message: `no credentials for ${post.channel}` };

  if (!(await claim(deps.store, id, deps.now, deps.by))) return { id, status: 'skipped', message: 'already claimed' };
  hooks.onClaimed?.();

  let result;
  try {
    result = await provider.send(post, channel, credentials, {
      ...deps.context(post),
      speaker: speakers(deps.channels, deps.credentials),
      checkpoint: (remoteId) => checkpoint(deps.store, id, remoteId)
    });
  } catch (err) {
    return failure(post, err, deps);
  }

  try {
    await complete(deps.store, id, result.id, result.url, deps.now, result.replies);
  } catch (err) {
    return {
      id,
      status: 'unconfirmed',
      message: `posted as ${result.id} but saving the state failed: ${messageOf(err)}`
    };
  }
  return { id, status: 'posted', ...((result.warning ?? result.url) !== undefined && { message: (result.warning ?? result.url) as string }) };
}

export async function runNow(post: Post, deps: RunDeps, hooks: RunHooks = {}): Promise<Outcome> {
  if (post.manual) return { id: post.id, status: 'skipped', message: 'this post is a reminder only' };
  try {
    const state = await deps.store.get(post.id);
    if (state && isNotice(state)) await deps.store.remove(post.id);
    return await sendOne({ ...post, status: 'planned', date: deps.now }, deps, hooks);
  } catch (err) {
    return { id: post.id, status: 'error', message: messageOf(err) };
  }
}

export async function run(posts: Post[], deps: RunDeps): Promise<Outcome[]> {
  const pending = await unstarted(deps.store, due(posts, deps.now).ready);
  const outcomes: Outcome[] = [];
  for (const post of pending) {
    try {
      outcomes.push(await sendOne(post, deps));
    } catch (err) {
      outcomes.push({ id: post.id, status: 'error', message: messageOf(err) });
    }
  }
  return outcomes;
}
