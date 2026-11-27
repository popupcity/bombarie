import { appsPath, readSetting } from '../../src/secrets.ts';
import { telegram } from '../../src/telegram.ts';
import type { ReportDeps } from '../../src/notify.ts';
import type { RunDeps } from '../../src/run.ts';
import { thumbnail } from './thumbnail.ts';

export async function telegramOf(): Promise<{ token: string; chat: string } | null> {
  const token = await readSetting(appsPath(), 'telegramToken');
  const chat = await readSetting(appsPath(), 'telegramChat');
  return token && chat ? { token, chat } : null;
}

export async function reportingOf(root: string, { store, channels, now }: RunDeps): Promise<ReportDeps | null> {
  const bot = await telegramOf();
  if (!bot) return null;
  return { root, store, channels, now, notify: telegram(bot.token, bot.chat), base: (await readSetting(appsPath(), 'publicUrl')) ?? undefined, photo: (post) => thumbnail(root, post) };
}
