import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Credentials } from './types.ts';
import { isSealed, open, seal } from './vault.ts';

const location = (file: string, name: string, env: NodeJS.ProcessEnv): string => env[name] ?? join(homedir(), '.config', 'social', file);

export const tokensPath = (env: NodeJS.ProcessEnv = process.env): string => location('tokens.json', 'BOMBARIE_TOKENS', env);
export const appsPath = (env: NodeJS.ProcessEnv = process.env): string => location('apps.json', 'BOMBARIE_APPS', env);

export function secretOf(path: string): string {
  if (process.env.BOMBARIE_SECRET) return process.env.BOMBARIE_SECRET;
  const file = join(dirname(path), 'secret.key');
  if (!existsSync(file)) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(file, `${randomBytes(32).toString('base64')}\n`, { mode: 0o600, flag: 'wx' });
    } catch (err) {
      if ((err as { code?: unknown }).code !== 'EEXIST') throw err;
    }
  }
  return readFileSync(file, 'utf8').trim();
}

async function readPrivate(path: string): Promise<Record<string, Record<string, unknown>>> {
  let mode: number;
  try {
    mode = statSync(path).mode;
  } catch (err) {
    if ((err as { code?: unknown }).code === 'ENOENT') return {};
    throw err;
  }
  if ((mode & 0o077) !== 0) throw new Error(`${path} is readable by others; make it private (mode 600)`);
  const file: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!isSealed(file)) throw new Error(`${path} is not encrypted; encrypt it once with the BOMBARIE_SECRET (see docs/decisions.md)`);
  const raw = open(file, secretOf(path));
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`${path}: expected a map`);
  for (const [name, entry] of Object.entries(raw)) {
    if (typeof entry !== 'object' || entry === null) throw new Error(`${path}: ${name} must be a map`);
  }
  return raw as Record<string, Record<string, unknown>>;
}

async function writePrivate(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp`;
  await writeFile(temp, seal(data, secretOf(path)), { mode: 0o600 });
  await rename(temp, path);
}

const text = (path: string, name: string, entry: Record<string, unknown>, key: string): string => {
  const value = entry[key];
  if (typeof value !== 'string' || value === '') throw new Error(`${path}: ${name} is missing ${key}`);
  return value;
};

export async function readTokens(path: string): Promise<Record<string, Credentials>> {
  const tokens: Record<string, Credentials> = {};
  for (const [name, entry] of Object.entries(await readPrivate(path))) {
    const credentials: Credentials = { accessToken: text(path, name, entry, 'accessToken') };
    if (entry.refreshToken !== undefined) credentials.refreshToken = text(path, name, entry, 'refreshToken');
    if (entry.accountId !== undefined) credentials.accountId = text(path, name, entry, 'accountId');
    if (entry.expiresAt !== undefined) {
      const expiresAt = new Date(typeof entry.expiresAt === 'string' ? entry.expiresAt : NaN);
      if (Number.isNaN(expiresAt.getTime())) throw new Error(`${path}: ${name} expiresAt is not a date`);
      credentials.expiresAt = expiresAt;
    }
    tokens[name] = credentials;
  }
  return tokens;
}

const stored = (c: Credentials) => ({
  accessToken: c.accessToken,
  ...(c.refreshToken !== undefined && { refreshToken: c.refreshToken }),
  ...(c.accountId !== undefined && { accountId: c.accountId }),
  ...(c.expiresAt !== undefined && { expiresAt: c.expiresAt.toISOString() })
});

async function saveTokens(path: string, tokens: Record<string, Credentials>): Promise<void> {
  await writePrivate(path, Object.fromEntries(Object.entries(tokens).map(([name, credentials]) => [name, stored(credentials)])));
}

export async function writeToken(path: string, channel: string, credentials: Credentials): Promise<void> {
  await saveTokens(path, { ...(await readTokens(path)), [channel]: credentials });
}

export async function removeToken(path: string, channel: string): Promise<boolean> {
  const tokens = await readTokens(path);
  if (!(channel in tokens)) return false;
  delete tokens[channel];
  await saveTokens(path, tokens);
  return true;
}

export function credentialsFrom(path: string, now: Date): (channel: string) => Promise<Credentials | null> {
  return async (channel) => {
    const credentials = (await readTokens(path))[channel];
    if (!credentials) return null;
    if (credentials.expiresAt && credentials.expiresAt <= now) {
      throw new Error(`token for ${channel} expired on ${credentials.expiresAt.toISOString().slice(0, 10)}`);
    }
    return credentials;
  };
}

interface AppCredentials {
  clientId: string;
  clientSecret: string;
  configId?: string;
}

export async function readApp(path: string, name: string): Promise<AppCredentials | null> {
  const entry = (await readPrivate(path))[name];
  if (!entry) return null;
  const configId = (entry as Record<string, unknown>).configId;
  return { clientId: text(path, name, entry, 'clientId'), clientSecret: text(path, name, entry, 'clientSecret'), ...(typeof configId === 'string' && configId !== '' && { configId }) };
}

export async function readSetting(path: string, key: string): Promise<string | null> {
  const value = (await readPrivate(path)).settings?.[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

export async function writeSetting(path: string, key: string, value: string | null): Promise<void> {
  const all = await readPrivate(path);
  const settings: Record<string, unknown> = { ...all.settings };
  if (value === null || value === '') delete settings[key];
  else settings[key] = value;
  await writePrivate(path, { ...all, settings });
}

export async function writeApp(path: string, name: string, credentials: AppCredentials): Promise<void> {
  const clientId = credentials.clientId.trim();
  const clientSecret = credentials.clientSecret.trim();
  const configId = credentials.configId?.trim() ?? '';
  if (!clientId || !clientSecret) throw new Error('fill in both the client ID and the client secret');
  if (/\s/.test(clientId + clientSecret) || clientId.length > 200 || clientSecret.length > 200) {
    throw new Error('the client ID and secret are plain text without spaces; copy them again from LinkedIn');
  }
  await writePrivate(path, { ...(await readPrivate(path)), [name]: { clientId, clientSecret, ...(configId !== '' && { configId }) } });
}

export async function readUsers(path: string): Promise<Record<string, string>> {
  return Object.fromEntries(Object.entries((await readPrivate(path)).users ?? {}).filter(([, role]) => typeof role === 'string')) as Record<string, string>;
}

export async function writeUsers(path: string, users: Record<string, string>): Promise<void> {
  await writePrivate(path, { ...(await readPrivate(path)), users });
}
