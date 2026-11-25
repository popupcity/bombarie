import { graph } from './graph.ts';
import { ProviderError, isDocument, isVideo } from './types.ts';
import type { Channel, Credentials, Post, Provider, SendContext, SendResult } from './types.ts';

export const MAX_CHARS = 2200;
const MAX_IMAGES = 10;
const POLLS = 20;
const POLL_MS = 3000;
const VIDEO_POLLS = 60;
const VIDEO_POLL_MS = 5000;

const isStory = (post: Post): boolean => post.type === 'story';
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

function accountProblem(credentials: Credentials | null): string | null {
  return credentials?.accountId ? null : 'this channel has no Instagram account id; use Connect again on the Channels page';
}

const call = (context: SendContext, path: string, token: string, params: Record<string, string>, what: string, final = false, read = false) =>
  graph(context, `Instagram ${what}`, path, token, read ? { query: params } : { form: params }, final);

const get = (context: SendContext, path: string, token: string, query: Record<string, string>, what: string) => call(context, path, token, query, what, false, true);

async function container(context: SendContext, account: string, token: string, params: Record<string, string>, what: string): Promise<string> {
  const data = await call(context, `${account}/media`, token, params, what);
  const id = data.id;
  if (typeof id !== 'string') throw new ProviderError(`Instagram ${what} returned no id`, 'invalid');
  return id;
}

async function ready(context: SendContext, id: string, token: string, video = false): Promise<void> {
  const wait = context.sleep ?? sleep;
  const [polls, delay, what] = video ? [VIDEO_POLLS, VIDEO_POLL_MS, 'video'] : [POLLS, POLL_MS, 'image'];
  for (let attempt = 0; attempt < polls; attempt += 1) {
    const data = await get(context, id, token, { fields: 'status_code,status' }, 'status check');
    const status = data.status_code;
    if (status === 'FINISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new ProviderError(`Instagram could not process the ${what} (${String(data.status ?? status)})`, 'invalid');
    }
    await wait(delay);
  }
  throw new ProviderError(`Instagram is still processing the ${what}; nothing was posted, it will be tried again`, 'transient');
}

export const instagram: Provider = {
  platform: 'instagram',

  validate(post: Post, channel: Channel): string[] {
    if (post.replies?.length) return ['Instagram does not take replies; remove the parts after the first ---'];
    const issues: string[] = [];
    if (!channel.handle) issues.push('this channel is not linked to an Instagram account yet; use Connect on the Channels page');
    if (post.images.length === 0) issues.push('an Instagram post needs an image or a video');
    if (post.images.some(isDocument)) issues.push('Instagram does not take a PDF');
    const videos = post.images.filter(isVideo);
    if (videos.length > 1 || (videos.length === 1 && post.images.length > 1)) issues.push('a video cannot be combined with other files; use one video or only images');
    if (isStory(post)) {
      if (post.images.length > 1) issues.push('a story takes one image or one video');
      if (post.link) issues.push('a story with a link sticker cannot be posted automatically; make it manual');
    } else {
      if (post.images.length > MAX_IMAGES) issues.push(`more than ${MAX_IMAGES} images`);
      if (post.text.length > MAX_CHARS) issues.push(`text is over ${MAX_CHARS} characters`);
    }
    return issues;
  },

  async send(post: Post, _channel: Channel, credentials: Credentials, context: SendContext): Promise<SendResult> {
    const problem = accountProblem(credentials);
    if (problem) throw new ProviderError(problem, 'invalid');
    const account = credentials.accountId as string;
    const token = credentials.accessToken;

    const clip = post.images.find(isVideo);
    let creation: string;
    if (clip) {
      context.progress?.('Preparing the video for Instagram…');
      const params: Record<string, string> = { media_type: isStory(post) ? 'STORIES' : 'REELS', video_url: await context.publicVideo(clip) };
      if (!isStory(post)) {
        params.share_to_feed = 'true';
        if (post.text) params.caption = post.text;
        try {
          params.cover_url = await context.publicImage(`${clip}.cover.jpg`);
        } catch {
          delete params.cover_url;
        }
      }
      context.progress?.('Sending the video to Instagram…');
      creation = await container(context, account, token, params, isStory(post) ? 'video story' : 'reel');
      context.progress?.('Instagram is processing the video…');
      await ready(context, creation, token, true);
    } else {
      context.progress?.('Preparing the image for Instagram…');
      const urls: string[] = [];
      for (const path of post.images) urls.push(await context.publicImage(path, { story: isStory(post) }));

      context.progress?.('Sending the image to Instagram…');
      if (isStory(post)) {
        creation = await container(context, account, token, { media_type: 'STORIES', image_url: urls[0] as string }, 'story');
      } else if (urls.length === 1) {
        creation = await container(context, account, token, { image_url: urls[0] as string, caption: post.text }, 'image');
      } else {
        const children: string[] = [];
        for (const url of urls) children.push(await container(context, account, token, { image_url: url, is_carousel_item: 'true' }, 'carousel image'));
        for (const child of children) await ready(context, child, token);
        creation = await container(context, account, token, { media_type: 'CAROUSEL', children: children.join(','), caption: post.text }, 'carousel');
      }
      context.progress?.('Instagram is processing the image…');
      await ready(context, creation, token);
    }
    context.progress?.('Posting to Instagram…');

    const posted = await call(context, `${account}/media_publish`, token, { creation_id: creation }, 'post', true);
    const id = posted.id;
    if (typeof id !== 'string') throw new ProviderError('Instagram accepted the post but returned no id; find it on Instagram', 'unconfirmed');
    await context.checkpoint(id);

    let url: string | undefined;
    try {
      const info = await get(context, id, token, { fields: 'permalink' }, 'permalink');
      if (typeof info.permalink === 'string') url = info.permalink;
    } catch {
      url = undefined;
    }
    return { id, ...(url !== undefined && { url }) };
  }
};
