import { randomBytes } from 'node:crypto';
import { appsPath, credentialsFrom, readApp, removeToken, tokensPath, writeApp, writeSetting } from '../../src/secrets.ts';
import { finishThreads, threadsAuthorizeUrl } from '../../src/threads.ts';
import { authorizeUrl, connectProblem, finishFacebook, finishInstagram, finishLinkedin, metaAuthorizeUrl, refreshLinkedinAvatar } from '../../src/connect.ts';
import type { Credentials, Platform } from '../../src/types.ts';
import { loadChannels } from '../../src/channels.ts';

export interface Outcome {
  name: string;
  ok: boolean;
  message: string;
}

interface Pending {
  state: string;
  name: string;
  platform: Platform;
  redirectUri: string;
  expires: number;
}

const WAIT_MS = 10 * 60_000;

let pending: Pending | null = null;
let outcome: Outcome | null = null;

function plain(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (/\(401\)/.test(text)) return 'LinkedIn no longer accepts this connection. Press Reconnect.';
  if (/\(403\)/.test(text)) return 'LinkedIn did not allow this. Check that your LinkedIn app has the Share on LinkedIn product.';
  if (/Instagram token exchange failed/.test(text)) return 'Meta refused the app ID or secret, or the redirect URL does not match. Check them in the Instagram app block, and that the redirect URL is also saved in the configuration and under Facebook Login for Business, Valid OAuth Redirect URIs.';
  if (/\(400\)/.test(text) && /token exchange/.test(text)) return 'LinkedIn refused the client ID or secret, or the redirect URL does not match. Check both in the LinkedIn app block.';
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

export const callbackUrl = (origin: string): string => `${origin}/channels/callback`;

export function setOutcome(next: Outcome): void {
  outcome = next;
}

export function takeOutcome(): Outcome | null {
  const found = outcome;
  outcome = null;
  return found;
}

export const appKey = (platform: Platform): 'instagram' | 'facebook' | 'threads' | 'linkedin' => (platform === 'instagram' ? 'instagram' : platform === 'facebook' ? 'facebook' : platform === 'threads' ? 'threads' : 'linkedin');

export const appSaved = async (platform: Platform = 'linkedin'): Promise<string | null> => (await readApp(appsPath(), appKey(platform)))?.clientId ?? null;

export async function saveApp(platform: Platform, fields: { clientId: string; clientSecret: string; configId: string }, origin: string): Promise<void> {
  const meta = platform === 'instagram' || platform === 'facebook';
  if ((platform === 'instagram' || platform === 'threads') && origin.startsWith('https://')) await writeSetting(appsPath(), 'publicUrl', origin);
  if (meta && fields.configId.trim() === '') throw new Error('fill in the configuration ID');
  const kept = /^•+$/.test(fields.clientSecret) ? (await readApp(appsPath(), appKey(platform)))?.clientSecret : undefined;
  await writeApp(appsPath(), appKey(platform), { clientId: fields.clientId, clientSecret: kept ?? fields.clientSecret, ...(meta && { configId: fields.configId }) });
}

export async function startConnect(root: string, name: string, origin: string): Promise<string> {
  const channel = loadChannels(root)[name];
  const unfit = connectProblem(channel);
  if (unfit || !channel) throw new Error(unfit ?? 'unknown channel');
  const app = await readApp(appsPath(), appKey(channel.platform));
  if (!app) throw new Error(`Fill in the ${channel.platform === 'instagram' ? 'Meta app ID, secret and configuration ID' : channel.platform === 'facebook' ? 'Meta app ID, secret and configuration ID' : channel.platform === 'threads' ? 'Threads app ID and secret' : 'LinkedIn client ID and secret'} first`);
  if ((channel.platform === 'instagram' || channel.platform === 'facebook') && !app.configId) throw new Error('Fill in the configuration ID first');
  pending = { state: randomBytes(16).toString('hex'), name, platform: channel.platform, redirectUri: callbackUrl(origin), expires: Date.now() + WAIT_MS };
  if (channel.platform === 'threads') return threadsAuthorizeUrl(app.clientId, pending.redirectUri, pending.state);
  return channel.platform === 'instagram' || channel.platform === 'facebook' ? metaAuthorizeUrl(app.clientId, app.configId as string, pending.redirectUri, pending.state) : authorizeUrl(app.clientId, pending.redirectUri, pending.state);
}

export async function completeConnect(root: string, params: URLSearchParams, now = new Date()): Promise<string> {
  const waiting = pending;
  pending = null;
  if (!waiting || waiting.expires < Date.now() || params.get('state') !== waiting.state) {
    outcome = { name: '', ok: false, message: 'That LinkedIn answer did not match a connection you started. Start Connect again.' };
    return '';
  }
  const { name } = waiting;
  const error = params.get('error');
  const code = params.get('code');
  if (error || !code) {
    outcome = { name, ok: false, message: `LinkedIn did not connect: ${params.get('error_description') ?? error ?? 'no code returned'}` };
    return name;
  }
  try {
    const channel = loadChannels(root)[name];
    const app = await readApp(appsPath(), appKey(waiting.platform));
    if (!channel || !app) throw new Error('the channel or the app settings disappeared');
    const base = { root, name, channel, clientId: app.clientId, clientSecret: app.clientSecret, code, redirectUri: waiting.redirectUri, tokens: tokensPath(), now };
    if (waiting.platform === 'instagram') {
      const done = await finishInstagram(base);
      outcome = { name, ok: true, message: `Connected as @${done.username}. ${done.expiresAt ? `The token lasts until ${done.expiresAt.toISOString().slice(0, 10)}.` : 'The token does not expire.'}` };
    } else if (waiting.platform === 'threads') {
      const done = await finishThreads(base);
      outcome = { name, ok: true, message: `Connected as @${done.username}. The token lasts until ${done.expiresAt.toISOString().slice(0, 10)} and is renewed by itself.` };
    } else if (waiting.platform === 'facebook') {
      const done = await finishFacebook(base);
      outcome = { name, ok: true, message: `Connected to ${done.pageName}. ${done.expiresAt ? `The token lasts until ${done.expiresAt.toISOString().slice(0, 10)}.` : 'The token does not expire.'}` };
    } else {
      const done = await finishLinkedin(base);
      outcome = { name, ok: true, message: `Connected${done.profileName ? ` as ${done.profileName}` : ''}.${done.expiresAt ? ` The token lasts until ${done.expiresAt.toISOString().slice(0, 10)}.` : ''}` };
    }
  } catch (err) {
    outcome = { name, ok: false, message: plain(err) };
  }
  return name;
}

export async function refreshPhoto(root: string, name: string): Promise<string> {
  const channel = loadChannels(root)[name];
  const unfit = connectProblem(channel);
  if (unfit) throw new Error(unfit);
  const credentials = await credentialsFrom(tokensPath(), new Date())(name);
  if (!credentials) throw new Error('This channel is not connected');
  try {
    const saved = await refreshLinkedinAvatar({ root, channel: name, accessToken: credentials.accessToken });
    return saved ? 'Photo updated.' : 'LinkedIn returned no profile picture.';
  } catch (err) {
    throw new Error(plain(err));
  }
}

export async function disconnect(name: string): Promise<string> {
  return (await removeToken(tokensPath(), name)) ? 'Disconnected. The token is removed from this computer.' : 'There was no token to remove.';
}

export function channelState(
  channel: { platform: Platform },
  problem: string | null | undefined,
  token: Credentials | undefined,
  now = new Date()
): { tone: 'ok' | 'warn' | 'ink'; label: string; broken: boolean } {
  if (!problem) return { tone: 'ok', label: 'Auto', broken: false };
  const expired = token?.expiresAt !== undefined && token.expiresAt <= now;
  if (channel.platform === 'instagram' && token && !expired) return { tone: 'ok', label: 'Connected', broken: false };
  if (connectProblem(channel as never) === null && token) return { tone: 'warn', label: 'Reconnect', broken: true };
  return { tone: 'ink', label: 'Manual', broken: false };
}
