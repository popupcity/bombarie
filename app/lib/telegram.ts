import { appsPath, readSetting } from '../../src/secrets.ts';

export async function telegramOf(): Promise<{ token: string; chat: string } | null> {
  const token = await readSetting(appsPath(), 'telegramToken');
  const chat = await readSetting(appsPath(), 'telegramChat');
  return token && chat ? { token, chat } : null;
}
