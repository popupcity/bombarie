import { graph } from './graph.ts';
import { ProviderError, isVideo } from './types.ts';
import type { Channel, Credentials, Post, Provider, SendContext, SendResult } from './types.ts';

export const MAX_CHARS = 63206;
const MAX_IMAGES = 10;

const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
const mimeOf = (path: string): string | undefined => MIME[path.split('.').pop()?.toLowerCase() ?? ''];

const call = (context: SendContext, path: string, token: string, request: Parameters<typeof graph>[4], what: string, final = false) => graph(context, `Facebook ${what}`, path, token, request, final);

async function upload(context: SendContext, page: string, token: string, path: string, fields: Record<string, string>, what: string, final = false): Promise<Record<string, unknown>> {
  const mime = mimeOf(path);
  if (!mime) throw new ProviderError(`Facebook does not accept "${path}" (use JPEG, PNG, GIF or WebP)`, 'invalid');
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  body.append('source', new Blob([(await context.readMedia(path)) as unknown as BlobPart], { type: mime }), path);
  return call(context, `${page}/photos`, token, { body }, what, final);
}

export const postUrl = (id: string): string => `https://www.facebook.com/${id}`;

export const facebook: Provider = {
  platform: 'facebook',

  validate(post: Post, channel: Channel): string[] {
    if (post.replies?.length) return ['Facebook does not take replies; remove the parts after the first ---'];
    const issues: string[] = [];
    if (!channel.page) issues.push('this channel is not linked to a Facebook page yet; use Connect on the Channels page');
    if (post.type === 'story') issues.push('Facebook stories cannot be posted automatically; make it manual');
    if (post.text === '' && post.images.length === 0) issues.push('post needs text or an image');
    if (post.images.some(isVideo)) issues.push('video is only supported on LinkedIn for now');
    if (post.text.length > MAX_CHARS) issues.push(`text is over ${MAX_CHARS} characters`);
    if (post.images.length > MAX_IMAGES) issues.push(`more than ${MAX_IMAGES} images`);
    for (const image of post.images) {
      if (!mimeOf(image)) issues.push(`"${image}" must be JPEG, PNG, GIF or WebP`);
    }
    return issues;
  },

  async send(post: Post, _channel: Channel, credentials: Credentials, context: SendContext): Promise<SendResult> {
    const page = credentials.accountId;
    if (!page) throw new ProviderError('this channel has no Facebook page id; use Connect again on the Channels page', 'invalid');
    const token = credentials.accessToken;
    context.progress?.(post.images.length > 0 ? 'Uploading to Facebook…' : 'Posting to Facebook…');

    let result: Record<string, unknown>;
    if (post.images.length === 0) {
      result = await call(context, `${page}/feed`, token, { form: { message: post.text, ...(post.link && { link: post.link }) } }, 'post', true);
    } else if (post.images.length === 1) {
      result = await upload(context, page, token, post.images[0] as string, { caption: post.text, published: 'true' }, 'photo post', true);
    } else {
      const form: Record<string, string> = { message: post.text };
      let index = 0;
      for (const image of post.images) {
        const photo = await upload(context, page, token, image, { published: 'false' }, 'photo upload');
        if (typeof photo.id !== 'string') throw new ProviderError('Facebook photo upload returned no id', 'invalid');
        form[`attached_media[${index}]`] = JSON.stringify({ media_fbid: photo.id });
        index += 1;
      }
      result = await call(context, `${page}/feed`, token, { form }, 'post', true);
    }
    const id = typeof result.post_id === 'string' ? result.post_id : typeof result.id === 'string' ? result.id : null;
    if (!id) throw new ProviderError('Facebook accepted the post but returned no id; find it on Facebook', 'unconfirmed');
    await context.checkpoint(id);
    return { id, url: postUrl(id) };
  },

  async remove(remoteId: string, _channel: Channel, credentials: Credentials, fetchImpl: typeof fetch): Promise<void> {
    const context = { fetch: fetchImpl } as SendContext;
    await call(context, remoteId, credentials.accessToken, { remove: true }, 'delete');
  }
};
