import { loadChannels } from '../../src/channels.ts';
import { localDeps } from '../../src/local.ts';
import { readPosts } from '../../src/posts.ts';
import { remind, telegram } from '../../src/remind.ts';
import { refreshFeeds } from '../../src/feed.ts';
import { tokensPath } from '../../src/secrets.ts';
import { refreshThreadsTokens } from '../../src/threads.ts';
import { run } from '../../src/run.ts';
import { startScheduler } from '../../src/scheduler.ts';
import type { Scheduler } from '../../src/scheduler.ts';
import { root } from './data.ts';

const KEY = Symbol.for('social.scheduler');
type Holder = { [KEY]?: Scheduler };

async function tick(): Promise<void> {
  const now = new Date();
  const { posts } = readPosts(root, loadChannels(root));
  const deps = localDeps(root, now);
  await run(posts, deps);
  await refreshFeeds(root, deps.channels, fetch, now);
  await refreshThreadsTokens(tokensPath(), Object.entries(deps.channels).filter(([, channel]) => channel.platform === 'threads').map(([name]) => name), fetch, now);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (token && chat) await remind(posts, { store: deps.store, notify: telegram(token, chat), now });
}

export function ensureScheduler(): void {
  const holder = globalThis as Holder;
  holder[KEY] ??= startScheduler(tick, 60_000);
}

