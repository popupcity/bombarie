import { storeAvatar } from './avatars.ts';
import { linkedin } from './linkedin.ts';
import { facebook } from './facebook.ts';
import { instagram } from './instagram.ts';
import { threads } from './threads.ts';
import { setChannelField } from './channels.ts';
import { writeToken } from './secrets.ts';
import { PLATFORM_LABEL } from './types.ts';
import type { Channel, Credentials, Platform } from './types.ts';

const LINKEDIN_SCOPES = ['openid', 'profile', 'w_member_social'];

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: LINKEDIN_SCOPES.join(' '),
    state
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
}

export async function exchangeCode(
  args: { clientId: string; clientSecret: string; code: string; redirectUri: string; now: Date },
  fetchImpl: typeof fetch = fetch
): Promise<Credentials> {
  const res = await fetchImpl('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: args.code,
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.redirectUri
    })
  });
  if (!res.ok) {
    throw new Error(`LinkedIn token exchange failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('LinkedIn token exchange returned no access token');
  return {
    accessToken: data.access_token,
    ...(data.refresh_token && { refreshToken: data.refresh_token }),
    ...(data.expires_in && { expiresAt: new Date(args.now.getTime() + data.expires_in * 1000) })
  };
}

export async function fetchProfile(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ sub: string; name?: string; picture?: string }> {
  const res = await fetchImpl('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`LinkedIn userinfo failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { sub?: string; name?: string; picture?: string };
  if (!data.sub) throw new Error('LinkedIn userinfo returned no sub');
  return { sub: data.sub, ...(data.name && { name: data.name }), ...(data.picture && { picture: data.picture }) };
}

export function connectProblem(channel: Channel | undefined): string | null {
  if (!channel) return 'unknown channel';
  if (channel.platform === 'instagram' || channel.platform === 'facebook' || channel.platform === 'threads') return null;
  if (channel.platform !== 'linkedin') return 'only LinkedIn, Instagram, Facebook and Threads can be connected so far';
  if (channel.kind === 'organization') return 'posting as an organization needs the Community Management API, connect a person channel';
  return null;
}

export interface Connected {
  profileName?: string;
  urn: string;
  expiresAt?: Date;
  avatar: string;
}

export async function finishLinkedin(args: {
  root: string;
  name: string;
  channel: Channel;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  tokens: string;
  now: Date;
  fetchImpl?: typeof fetch;
}): Promise<Connected> {
  const credentials = await exchangeCode(
    { clientId: args.clientId, clientSecret: args.clientSecret, code: args.code, redirectUri: args.redirectUri, now: args.now },
    args.fetchImpl
  );
  const profile = await fetchProfile(credentials.accessToken, args.fetchImpl);
  const urn = `urn:li:person:${profile.sub}`;
  await writeToken(args.tokens, args.name, credentials);
  if (args.channel.urn !== urn) await setChannelField(args.root, args.name, 'urn', urn);
  let avatar = 'LinkedIn returned no profile picture';
  if (profile.picture) {
    try {
      avatar = `avatar saved as ${await storeAvatar({ root: args.root, channel: args.name, picture: profile.picture, ...(args.fetchImpl && { fetchImpl: args.fetchImpl }) })}`;
    } catch (err) {
      avatar = `avatar not saved: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return {
    ...(profile.name && { profileName: profile.name }),
    urn,
    ...(credentials.expiresAt && { expiresAt: credentials.expiresAt }),
    avatar
  };
}

const GRAPH = 'https://graph.facebook.com/v23.0';

export function metaAuthorizeUrl(appId: string, configId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, response_type: 'code', config_id: configId, override_default_response_type: 'true', state });
  return `https://www.facebook.com/v23.0/dialog/oauth?${params}`;
}

async function json(res: Response, what: string): Promise<Record<string, unknown>> {
  if (!res.ok) throw new Error(`Instagram ${what} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as Record<string, unknown>;
}

export interface InstagramConnected {
  username: string;
  name?: string;
  expiresAt?: Date;
  handleWritten: boolean;
  avatar: string;
}

interface MetaArgs {
  root: string;
  name: string;
  channel: Channel;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  tokens: string;
  now: Date;
  fetchImpl?: typeof fetch;
}

async function metaToken(args: MetaArgs, fetchImpl: typeof fetch, needed: string[]): Promise<{ token: string; expiresAt?: Date }> {
  const exchanged = await json(
    await fetchImpl(`${GRAPH}/oauth/access_token?${new URLSearchParams({ client_id: args.clientId, client_secret: args.clientSecret, redirect_uri: args.redirectUri, code: args.code })}`),
    'token exchange'
  );
  const token = exchanged.access_token;
  if (typeof token !== 'string') throw new Error('Instagram token exchange returned no access token');
  const inspected = await json(
    await fetchImpl(`${GRAPH}/debug_token?${new URLSearchParams({ input_token: token, access_token: `${args.clientId}|${args.clientSecret}` })}`),
    'token check'
  );
  const data = (inspected.data ?? {}) as { expires_at?: number; scopes?: string[] };
  const missing = needed.filter((scope) => !(data.scopes ?? []).includes(scope));
  if (missing.length > 0) throw new Error(`the configuration in Meta does not include ${missing.join(' and ')}; add it, then connect again. Nothing was saved`);
  return { token, ...(data.expires_at && { expiresAt: new Date(data.expires_at * 1000) }) };
}

export async function finishInstagram(args: MetaArgs): Promise<InstagramConnected> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const { token, expiresAt } = await metaToken(args, fetchImpl, ['instagram_basic', 'instagram_content_publish']);

  const listed = await json(
    await fetchImpl(`${GRAPH}/me/assigned_instagram_accounts?${new URLSearchParams({ fields: 'id,username,name,profile_picture_url', access_token: token })}`),
    'account list'
  );
  const accounts = (Array.isArray(listed.data) ? listed.data : []) as { id?: string; username?: string; name?: string; profile_picture_url?: string }[];
  if (accounts.length === 0) {
    throw new Error('Meta shared no Instagram account with this login. In the Meta dialog choose the business portfolio and the Instagram account; if the app and the account are in the same portfolio, assign the account to the app in Business Settings. Nothing was saved');
  }
  const account = args.channel.handle ? accounts.find((candidate) => candidate.username === args.channel.handle) : accounts.length === 1 ? accounts[0] : undefined;
  if (!account || !account.id || !account.username) {
    const names = accounts.map((candidate) => `@${candidate.username}`).join(', ');
    throw new Error(args.channel.handle ? `none of the shared accounts (${names}) is @${args.channel.handle}; nothing was saved` : `several accounts were shared (${names}); set the handle of this channel first. Nothing was saved`);
  }
  await writeToken(args.tokens, args.name, { accessToken: token, accountId: account.id, ...(expiresAt && { expiresAt }) });
  if (!args.channel.handle) await setChannelField(args.root, args.name, 'handle', account.username);
  let avatar = 'Instagram returned no profile picture';
  if (account.profile_picture_url) {
    try {
      avatar = `avatar saved as ${await storeAvatar({ root: args.root, channel: args.name, picture: account.profile_picture_url, fetchImpl })}`;
    } catch (err) {
      avatar = `avatar not saved: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return { username: account.username, ...(account.name && { name: account.name }), ...(expiresAt && { expiresAt }), handleWritten: !args.channel.handle, avatar };
}

export interface FacebookConnected {
  pageName: string;
  expiresAt?: Date;
  avatar: string;
}

export async function finishFacebook(args: MetaArgs): Promise<FacebookConnected> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const { token, expiresAt } = await metaToken(args, fetchImpl, ['pages_manage_posts']);
  const fields = 'id,name,access_token,picture{url}';
  let listed = await json(await fetchImpl(`${GRAPH}/me/assigned_pages?${new URLSearchParams({ fields, access_token: token })}`), 'page list');
  let pages = (Array.isArray(listed.data) ? listed.data : []) as { id?: string; name?: string; access_token?: string; picture?: { data?: { url?: string } } }[];
  if (pages.length === 0) {
    listed = await json(await fetchImpl(`${GRAPH}/me/accounts?${new URLSearchParams({ fields, access_token: token })}`), 'page list');
    pages = (Array.isArray(listed.data) ? listed.data : []) as typeof pages;
  }
  if (pages.length === 0) {
    throw new Error('Meta shared no Facebook page with this login. In the Meta dialog choose the business portfolio and the page, and make sure the configuration has the page as asset. Nothing was saved');
  }
  const wanted = args.channel.page;
  const page = wanted ? pages.find((candidate) => candidate.id === wanted) : pages.length === 1 ? pages[0] : pages.find((candidate) => candidate.name?.toLowerCase() === (args.channel.name ?? '').toLowerCase());
  if (!page || !page.id || !page.name) {
    const names = pages.map((candidate) => candidate.name).join(', ');
    throw new Error(wanted ? `none of the shared pages (${names}) has the id ${wanted}; nothing was saved` : `several pages were shared (${names}); give this channel the name of the page first. Nothing was saved`);
  }
  if (!page.access_token) throw new Error(`Meta gave no access to ${page.name}; give the app Manage posts on that page. Nothing was saved`);
  await writeToken(args.tokens, args.name, { accessToken: page.access_token, accountId: page.id });
  if (!args.channel.page) await setChannelField(args.root, args.name, 'page', page.id);
  let avatar = 'Facebook returned no page picture';
  const picture = page.picture?.data?.url;
  if (picture) {
    try {
      avatar = `avatar saved as ${await storeAvatar({ root: args.root, channel: args.name, picture, fetchImpl })}`;
    } catch (err) {
      avatar = `avatar not saved: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return { pageName: page.name, ...(expiresAt && { expiresAt }), avatar };
}

export const providers = { linkedin, instagram, facebook, threads };

export const isAutomatic = (platform: Platform): boolean => platform in providers;

export function sendProblem(channel: Channel, credentials: Credentials | undefined, now: Date): string | null {
  if (channel.platform === 'substack') return 'Substack has no posting API, so you post by hand and get a reminder';
  if (channel.platform === 'feed') return 'a feed is not posted to from here; its posts are only shown';
  if (!(channel.platform in providers)) return `automatic posting to ${PLATFORM_LABEL[channel.platform]} is not built yet`;
  if (channel.platform === 'linkedin' && channel.kind === 'organization') return 'posting as a company page is not supported yet';
  if (!credentials) return 'manual until you connect it; use Connect on the Channels page';
  if (credentials.expiresAt && credentials.expiresAt <= now) return `the token expired on ${credentials.expiresAt.toISOString().slice(0, 10)}`;
  return null;
}

export async function refreshLinkedinAvatar(args: {
  root: string;
  channel: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<string | null> {
  const profile = await fetchProfile(args.accessToken, args.fetchImpl);
  if (!profile.picture) return null;
  return storeAvatar({ ...args, picture: profile.picture });
}
