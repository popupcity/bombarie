import { storeAvatar } from './avatars.ts';
import { setChannelField } from './channels.ts';
import { THREADS_GRAPH, graph } from './graph.ts';
import { readTokens, writeToken } from './secrets.ts';
import { ProviderError, isDocument, isVideo } from './types.ts';
import type { Channel, Credentials, Post, Provider, ReplyResult, SendContext, SendResult } from './types.ts';

export const MAX_CHARS = 500;
const MAX_ITEMS = 20;
const MAX_REPLIES = 20;
const POLLS = 20;
const POLL_MS = 3000;
const VIDEO_POLLS = 60;
const VIDEO_POLL_MS = 5000;
const AUTH = 'https://graph.threads.com';
const REFRESH_WITHIN_MS = 14 * 86_400_000;

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

export function threadsAuthorizeUrl(appId: string, redirectUri: string, state: string): string {
  return `https://threads.com/oauth/authorize?${new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, scope: 'threads_basic,threads_content_publish,threads_manage_replies', response_type: 'code', state })}`;
}

const call = (context: SendContext, path: string, token: string, params: Record<string, string>, what: string, final = false, read = false) =>
  graph(context, `Threads ${what}`, path, token, read ? { query: params } : { form: params }, final, THREADS_GRAPH);

async function container(context: SendContext, user: string, token: string, params: Record<string, string>, what: string): Promise<string> {
  const data = await call(context, `${user}/threads`, token, params, what);
  if (typeof data.id !== 'string') throw new ProviderError(`Threads ${what} returned no id`, 'invalid');
  return data.id;
}

async function ready(context: SendContext, id: string, token: string, video = false): Promise<void> {
  const wait = context.sleep ?? sleep;
  const [polls, delay] = video ? [VIDEO_POLLS, VIDEO_POLL_MS] : [POLLS, POLL_MS];
  for (let attempt = 0; attempt < polls; attempt += 1) {
    const data = await call(context, id, token, { fields: 'status,error_message' }, 'status check', false, true);
    if (data.status === 'FINISHED') return;
    if (data.status === 'ERROR' || data.status === 'EXPIRED') {
      throw new ProviderError(`Threads could not process the ${video ? 'video' : 'media'} (${String(data.error_message ?? data.status)})`, 'invalid');
    }
    await wait(delay);
  }
  throw new ProviderError(`Threads is still processing the ${video ? 'video' : 'media'}; nothing was posted, it will be tried again`, 'transient');
}

function userOf(credentials: Credentials): string {
  if (!credentials.accountId) throw new ProviderError('this channel has no Threads user id; use Connect again on the Channels page', 'invalid');
  return credentials.accountId;
}

export const threads: Provider = {
  platform: 'threads',

  validate(post: Post, channel: Channel): string[] {
    const issues: string[] = [];
    if (!channel.handle) issues.push('this channel is not linked to a Threads account yet; use Connect on the Channels page');
    if (post.text === '' && post.images.length === 0) issues.push('post needs text or a picture');
    if (post.text.length > MAX_CHARS) issues.push(`text is over ${MAX_CHARS} characters`);
    if (post.images.some(isDocument)) issues.push('Threads does not take a PDF');
    const videos = post.images.filter(isVideo);
    if (videos.length > 1 || (videos.length === 1 && post.images.length > 1)) issues.push('a video cannot be combined with other files; use one video or only images');
    if (post.images.length > MAX_ITEMS) issues.push(`more than ${MAX_ITEMS} images`);
    if (post.type === 'story') issues.push('Threads has no stories');
    const replies = post.replies ?? [];
    if (replies.length > MAX_REPLIES) issues.push(`more than ${MAX_REPLIES} replies`);
    replies.forEach((reply, index) => {
      if (reply === '') issues.push(`reply ${index + 1} is empty`);
      if (reply.length > MAX_CHARS) issues.push(`reply ${index + 1} is over ${MAX_CHARS} characters`);
    });
    return issues;
  },

  async send(post: Post, _channel: Channel, credentials: Credentials, context: SendContext): Promise<SendResult> {
    const user = userOf(credentials);
    const token = credentials.accessToken;
    const text: Record<string, string> = post.text === '' ? {} : { text: post.text };
    const clip = post.images.find(isVideo);

    let creation: string;
    if (clip) {
      context.progress?.('Sending the video to Threads…');
      creation = await container(context, user, token, { media_type: 'VIDEO', video_url: await context.publicVideo(clip), ...text }, 'video');
      context.progress?.('Threads is processing the video…');
      await ready(context, creation, token, true);
    } else if (post.images.length === 0) {
      creation = await container(context, user, token, { media_type: 'TEXT', ...text, ...(post.link ? { link_attachment: post.link } : {}) }, 'post');
      await ready(context, creation, token);
    } else if (post.images.length === 1) {
      context.progress?.('Sending the picture to Threads…');
      creation = await container(context, user, token, { media_type: 'IMAGE', image_url: await context.publicImage(post.images[0] as string), ...text }, 'picture');
      await ready(context, creation, token);
    } else {
      context.progress?.('Sending the pictures to Threads…');
      const children: string[] = [];
      for (const path of post.images) children.push(await container(context, user, token, { media_type: 'IMAGE', image_url: await context.publicImage(path), is_carousel_item: 'true' }, 'carousel picture'));
      for (const child of children) await ready(context, child, token);
      creation = await container(context, user, token, { media_type: 'CAROUSEL', children: children.join(','), ...text }, 'carousel');
      await ready(context, creation, token);
    }

    context.progress?.('Posting to Threads…');
    const posted = await call(context, `${user}/threads_publish`, token, { creation_id: creation }, 'post', true);
    const id = posted.id;
    if (typeof id !== 'string') throw new ProviderError('Threads accepted the post but returned no id; find it on Threads', 'unconfirmed');
    await context.checkpoint(id);

    let url: string | undefined;
    try {
      const info = await call(context, id, token, { fields: 'permalink' }, 'permalink', false, true);
      if (typeof info.permalink === 'string') url = info.permalink;
    } catch {
      url = undefined;
    }
    const replies = post.replies ?? [];
    const done = await chain(context, user, token, id, replies, 0);
    return { id, ...(url !== undefined && { url }), ...(done.warning !== undefined && { warning: `Posted, but ${done.warning}` }), ...(replies.length > 0 && { replies: { count: done.sent, ids: done.ids, ...(done.last !== undefined && { last: done.last }) } }) };
  },

  async reply(input, _channel, credentials, fetchImpl): Promise<ReplyResult> {
    return chain({ fetch: fetchImpl } as SendContext, userOf(credentials), credentials.accessToken, input.last ?? input.remoteId, input.texts, input.offset);
  }
};

async function chain(context: SendContext, user: string, token: string, from: string, texts: string[], offset: number): Promise<ReplyResult> {
  let parent = from;
  const ids: string[] = [];
  let sent = 0;
  for (const [index, text] of texts.entries()) {
    const label = `reply ${offset + index + 1}`;
    try {
      const created = await container(context, user, token, { media_type: 'TEXT', text, reply_to_id: parent }, label);
      await ready(context, created, token);
      const published = await call(context, `${user}/threads_publish`, token, { creation_id: created }, label, true);
      if (typeof published.id !== 'string') throw new ProviderError(`Threads accepted ${label} but returned no id`, 'unconfirmed');
      parent = published.id;
      ids.push(published.id);
      sent += 1;
    } catch (err) {
      return { sent, ids, ...(parent !== from && { last: parent }), warning: `${label} of ${offset + texts.length} failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  return { sent, ids, ...(parent !== from && { last: parent }) };
}

export interface ThreadsConnected {
  username: string;
  expiresAt: Date;
  avatar: string;
}

async function json(res: Response, what: string): Promise<Record<string, unknown>> {
  if (!res.ok) throw new Error(`Threads ${what} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function finishThreads(args: {
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
}): Promise<ThreadsConnected> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const short = await json(
    await fetchImpl(`${AUTH}/oauth/access_token`, {
      method: 'POST',
      body: new URLSearchParams({ client_id: args.clientId, client_secret: args.clientSecret, code: args.code, grant_type: 'authorization_code', redirect_uri: args.redirectUri })
    }),
    'token exchange'
  );
  const shortToken = short.access_token;
  const userId = short.user_id;
  if (typeof shortToken !== 'string' || (typeof userId !== 'number' && typeof userId !== 'string')) throw new Error('Threads token exchange returned no access token or user id');
  const long = await json(await fetchImpl(`${AUTH}/access_token?${new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: args.clientSecret, access_token: shortToken })}`), 'long-lived token');
  const token = long.access_token;
  const lifetime = Number(long.expires_in);
  if (typeof token !== 'string' || !Number.isFinite(lifetime)) throw new Error('Threads long-lived token exchange returned no token');
  const expiresAt = new Date(args.now.getTime() + lifetime * 1000);

  const profile = await json(await fetchImpl(`${THREADS_GRAPH}/me?${new URLSearchParams({ fields: 'id,username', access_token: token })}`), 'profile');
  const username = typeof profile.username === 'string' ? profile.username : '';
  if (!username) throw new Error('Threads returned no username for this login');
  if (args.channel.handle && args.channel.handle !== username) throw new Error(`this login is @${username}, not @${args.channel.handle}; nothing was saved`);
  const accountId = typeof profile.id === 'string' && profile.id !== '' ? profile.id : String(userId);
  await writeToken(args.tokens, args.name, { accessToken: token, accountId, expiresAt });
  if (!args.channel.handle) await setChannelField(args.root, args.name, 'handle', username);

  let avatar = 'Threads returned no profile picture';
  try {
    const picture = await json(await fetchImpl(`${THREADS_GRAPH}/me?${new URLSearchParams({ fields: 'threads_profile_picture_url', access_token: token })}`), 'profile picture');
    if (typeof picture.threads_profile_picture_url === 'string') avatar = `avatar saved as ${await storeAvatar({ root: args.root, channel: args.name, picture: picture.threads_profile_picture_url, fetchImpl })}`;
  } catch (err) {
    avatar = `avatar not saved: ${err instanceof Error ? err.message : String(err)}`;
  }
  return { username, expiresAt, avatar };
}

export async function refreshThreadsTokens(tokensFile: string, names: string[], fetchImpl: typeof fetch, now: Date): Promise<string[]> {
  const stored = await readTokens(tokensFile).catch(() => ({}) as Awaited<ReturnType<typeof readTokens>>);
  const refreshed: string[] = [];
  for (const name of names) {
    const current = stored[name];
    if (!current?.expiresAt) continue;
    const left = current.expiresAt.getTime() - now.getTime();
    if (left <= 0 || left > REFRESH_WITHIN_MS) continue;
    try {
      const data = await json(await fetchImpl(`${AUTH}/refresh_access_token?${new URLSearchParams({ grant_type: 'th_refresh_token', access_token: current.accessToken })}`), 'token refresh');
      const token = data.access_token;
      const lifetime = Number(data.expires_in);
      if (typeof token !== 'string' || !Number.isFinite(lifetime)) continue;
      await writeToken(tokensFile, name, { ...current, accessToken: token, expiresAt: new Date(now.getTime() + lifetime * 1000) });
      refreshed.push(name);
    } catch {
      continue;
    }
  }
  return refreshed;
}
