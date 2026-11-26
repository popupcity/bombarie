import { loadChannels } from '../../src/channels.ts';
import { localDeps } from '../../src/local.ts';
import { readPosts } from '../../src/posts.ts';
import { remind } from '../../src/remind.ts';
import { report } from '../../src/notify.ts';
import { thumbnail } from './thumbnail.ts';
import { telegram } from '../../src/telegram.ts';
import { refreshFeeds } from '../../src/feed.ts';
import { appsPath, readSetting, tokensPath } from '../../src/secrets.ts';
import { refreshThreadsTokens } from '../../src/threads.ts';
import { run } from '../../src/run.ts';
import { rearm } from '../../src/state.ts';
import { startScheduler } from '../../src/scheduler.ts';
import type { Scheduler } from '../../src/scheduler.ts';
import { root } from './data.ts';
import { telegramOf } from './telegram.ts';

const KEY = Symbol.for('social.scheduler');
type Holder = { [KEY]?: Scheduler };

async function tick(): Promise<void> {
  const now = new Date();
  const { posts } = readPosts(root, loadChannels(root));
  const deps = localDeps(root, now);
  for (const post of posts) await rearm(deps.store, post.id, post.date);
  const outcomes = await run(posts, deps);
  await refreshFeeds(root, deps.channels, fetch, now);
  await refreshThreadsTokens(tokensPath(), Object.entries(deps.channels).filter(([, channel]) => channel.platform === 'threads').map(([name]) => name), fetch, now);
  const bot = await telegramOf();
  if (!bot) return;
  const told = { store: deps.store, notify: telegram(bot.token, bot.chat), now, channels: deps.channels, base: (await readSetting(appsPath(), 'publicUrl')) ?? undefined };
  const failed = await report(posts, outcomes, { ...told, root, photo: (post) => thumbnail(root, post) });
  const reminded = await remind(posts, told);
  for (const problem of [...failed, ...reminded.flatMap((reminder) => (reminder.status === 'error' ? [reminder.message ?? 'a reminder failed'] : []))]) console.error(`telegram: ${problem}`);
}

export function ensureScheduler(): void {
  const holder = globalThis as Holder;
  holder[KEY] ??= startScheduler(tick, 60_000);
}

