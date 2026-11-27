import { isDocument, isVideo, ProviderError } from './types.ts';
import type { Channel, Credentials, Post, Provider, ReplyResult, SendContext, SendResult } from './types.ts';

const VERSION = '202609';
const COMMENTS = 'https://api.linkedin.com/v2/socialActions';
const TAGGED_COMMENTS = 'https://api.linkedin.com/rest/socialActions';
export const MAX_CHARS = 3000;
const MAX_COMMENTS = 10;
const MAX_COMMENT_CHARS = 1250;
const MAX_IMAGES = 20;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const MIME = new Map([
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['gif', 'image/gif']
]);

function mimeOf(path: string): string | undefined {
  return MIME.get(path.split('.').pop()?.toLowerCase() ?? '');
}

export function escapeLittleText(text: string): string {
  return text.replace(/[\\|{}@[\]()<>#*_~]/g, (ch, offset: number) => {
    if (ch === '#') {
      const before = offset === 0 ? '' : text[offset - 1];
      const after = text[offset + 1] ?? '';
      if ((before === '' || /\s/.test(before ?? '')) && /[\p{L}\p{N}]/u.test(after)) return ch;
    }
    return `\\${ch}`;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function mentionSegments(text: string, mentions: Record<string, string>): { text: string; urn?: string }[] {
  const names = Object.keys(mentions).sort((a, b) => b.length - a.length);
  if (names.length === 0) return [{ text }];
  const pattern = new RegExp(`(${names.map(escapeRegExp).join('|')})`, 'g');
  return text.split(pattern).map((part, i) => (i % 2 === 1 ? { text: part, urn: mentions[part] as string } : { text: part }));
}

export function littleText(text: string, mentions: Record<string, string>): string {
  return mentionSegments(text, mentions)
    .map((segment) => (segment.urn === undefined ? escapeLittleText(segment.text) : `@[${escapeLittleText(segment.text)}](${segment.urn})`))
    .join('');
}

function urnProblem(channel: Channel): string | null {
  const organization = channel.kind === 'organization';
  const prefix = organization ? 'urn:li:organization:' : 'urn:li:person:';
  if (channel.urn?.startsWith(prefix)) return null;
  return organization ? `this channel needs an organization ID starting with ${prefix}` : 'this channel is not linked to a LinkedIn profile yet; use Connect on the Channels page';
}

function postUrl(id: string): string {
  return `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}/`;
}

function oldStyle(headers: Record<string, string>): Record<string, string> {
  const { 'LinkedIn-Version': _version, ...rest } = headers;
  return rest;
}

export function commentAttributes(text: string, mentions: Record<string, string>) {
  let start = 0;
  return mentionSegments(text, mentions).flatMap((segment) => {
    const at = start;
    start += segment.text.length;
    if (segment.urn === undefined) return [];
    const kind = segment.urn.startsWith('urn:li:person:') ? 'person' : 'organization';
    return [{ start: at, length: segment.text.length, value: { [kind]: { [kind]: segment.urn } } }];
  });
}

interface Authors {
  by?: string[] | undefined;
  speaker?: SendContext['speaker'] | undefined;
}

async function comment(context: SendContext, headers: Record<string, string>, owner: string, id: string, texts: string[], mentions: Record<string, string>, offset: number, authors: Authors = {}): Promise<ReplyResult> {
  const ids: string[] = [];
  const by: string[] = [];
  const who = (): { by?: string[] } => (by.some(Boolean) ? { by } : {});
  const untagged: string[] = [];
  let sent = 0;
  const told = (): string[] => (untagged.length > 0 ? [`posted without tags, LinkedIn refused them: ${untagged.join(', ')}`] : []);
  for (const [index, text] of texts.entries()) {
    const number = offset + index + 1;
    const other = authors.by?.[index] ?? '';
    try {
      let actor = owner;
      let own = headers;
      if (other) {
        if (!authors.speaker) throw new ProviderError(`no way to reply as ${other}`, 'invalid');
        const speaker = await authors.speaker(other);
        actor = speaker.urn;
        own = { ...headers, Authorization: `Bearer ${speaker.credentials.accessToken}` };
      }
      const post = (base: string, using: Record<string, string>, message: object) =>
        request(context, `${base}/${encodeURIComponent(id)}/comments`, { method: 'POST', headers: using, body: JSON.stringify({ actor, object: id, message }) }, `reply ${number}`, true);
      const attributes = commentAttributes(text, mentions);
      let res: Response | undefined;
      if (attributes.length > 0) {
        res = await post(TAGGED_COMMENTS, own, { text, attributes }).catch((err: unknown) => {
          if (err instanceof ProviderError && (err.code === 'invalid' || err.code === 'auth')) return undefined;
          throw err;
        });
        if (!res) untagged.push(`reply ${number}`);
      }
      res ??= await post(COMMENTS, oldStyle(own), { text });
      const data = (await res.json().catch(() => ({}))) as { id?: unknown };
      ids.push(typeof data.id === 'string' || typeof data.id === 'number' ? String(data.id) : (res.headers.get('x-restli-id') ?? ''));
      by.push(other);
      sent += 1;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { sent, ids, ...who(), warning: [`reply ${number} of ${offset + texts.length} failed: ${reason}${reason.includes('(403)') ? ' LinkedIn may not allow replies with this app yet.' : ''}`, ...told()].join('; ') };
    }
  }
  return { sent, ids, ...who(), ...(untagged.length > 0 && { warning: told()[0]! }) };
}

async function request(context: SendContext, url: string, init: RequestInit, what: string, final = false): Promise<Response> {
  let res: Response;
  try {
    res = await context.fetch(url, init);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new ProviderError(
      `LinkedIn ${what} failed: ${cause}${final ? '; the post may have been posted' : ''}`,
      final ? 'unconfirmed' : 'transient'
    );
  }
  if (res.ok) return res;

  const detail = (await res.text().catch(() => '')).slice(0, 300);
  const message = `LinkedIn ${what} failed (${res.status}): ${detail}`;
  if (res.status === 401 || res.status === 403) throw new ProviderError(message, 'auth');
  if (res.status === 429) throw new ProviderError(message, 'rate');
  if (res.status >= 500) throw new ProviderError(message, final ? 'unconfirmed' : 'transient');
  throw new ProviderError(message, 'invalid');
}

async function uploadDocument(context: SendContext, headers: Record<string, string>, owner: string, path: string): Promise<string> {
  const bytes = await context.readMedia(path);
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new ProviderError(`"${path}" is over 100 MB`, 'invalid');
  const init = await request(context, 'https://api.linkedin.com/rest/documents?action=initializeUpload', { method: 'POST', headers, body: JSON.stringify({ initializeUploadRequest: { owner } }) }, 'document init');
  const { uploadUrl, document } = ((await init.json().catch(() => ({}))) as { value?: { uploadUrl?: string; document?: string } }).value ?? {};
  if (!uploadUrl || !document) throw new ProviderError('LinkedIn document init returned no upload url', 'invalid');
  await request(context, uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: bytes as unknown as BodyInit }, 'document upload');
  const wait = context.sleep ?? sleep;
  for (let attempt = 0; attempt < 20; attempt++) {
    const state = await request(context, `https://api.linkedin.com/rest/documents/${encodeURIComponent(document)}`, { headers }, 'document check').then((res) => res.json() as Promise<{ status?: string }>).catch(() => null);
    if (state === null || state.status === 'AVAILABLE') return document;
    if (state.status === 'PROCESSING_FAILED') throw new ProviderError('LinkedIn could not process the PDF', 'invalid');
    await wait(1500);
  }
  return document;
}

interface VideoInstruction {
  uploadUrl: string;
  firstByte: number;
  lastByte: number;
}

function videoInstructions(value: unknown, size: number): VideoInstruction[] {
  const list = Array.isArray(value) ? (value as Partial<VideoInstruction>[]) : [];
  const out = list
    .map((entry) => ({ uploadUrl: String(entry.uploadUrl ?? ''), firstByte: Number(entry.firstByte), lastByte: Number(entry.lastByte) }))
    .sort((a, b) => a.firstByte - b.firstByte);
  let cursor = 0;
  for (const part of out) {
    if (!part.uploadUrl || !Number.isInteger(part.firstByte) || !Number.isInteger(part.lastByte) || part.firstByte !== cursor || part.lastByte < part.firstByte || part.lastByte >= size) {
      throw new ProviderError('LinkedIn video init returned invalid upload instructions', 'invalid');
    }
    cursor = part.lastByte + 1;
  }
  if (out.length === 0 || cursor !== size) throw new ProviderError('LinkedIn video init returned incomplete upload instructions', 'invalid');
  return out;
}

async function uploadVideo(context: SendContext, headers: Record<string, string>, owner: string, path: string): Promise<string> {
  const bytes = await context.readMedia(path);
  if (bytes.length > MAX_VIDEO_BYTES) throw new ProviderError(`"${path}" is over 100 MB`, 'invalid');
  const init = await request(context, 'https://api.linkedin.com/rest/videos?action=initializeUpload', { method: 'POST', headers, body: JSON.stringify({ initializeUploadRequest: { owner, fileSizeBytes: bytes.length, uploadCaptions: false, uploadThumbnail: false } }) }, 'video init');
  const { video, uploadToken, uploadInstructions } = ((await init.json().catch(() => ({}))) as { value?: { video?: string; uploadToken?: string; uploadInstructions?: unknown } }).value ?? {};
  if (!video) throw new ProviderError('LinkedIn video init returned no video', 'invalid');
  const parts = videoInstructions(uploadInstructions, bytes.length);
  const etags: string[] = [];
  for (const [index, part] of parts.entries()) {
    context.progress?.(`Uploading the video to LinkedIn, part ${index + 1} of ${parts.length}…`);
    const res = await request(context, part.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes.subarray(part.firstByte, part.lastByte + 1) as unknown as BodyInit }, 'video upload');
    const etag = res.headers.get('etag');
    if (!etag) throw new ProviderError('LinkedIn video upload returned no ETag', 'invalid');
    etags.push(etag.replace(/^"|"$/g, ''));
  }
  await request(context, 'https://api.linkedin.com/rest/videos?action=finalizeUpload', { method: 'POST', headers, body: JSON.stringify({ finalizeUploadRequest: { video, uploadToken: uploadToken ?? '', uploadedPartIds: etags } }) }, 'video finalize');
  context.progress?.('LinkedIn is processing the video…');
  const wait = context.sleep ?? sleep;
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = await request(context, `https://api.linkedin.com/rest/videos/${encodeURIComponent(video)}`, { headers }, 'video check').then((res) => res.json() as Promise<{ status?: string; processingFailureReason?: string }>).catch(() => null);
    if (state?.status === 'AVAILABLE') return video;
    if (state?.status === 'PROCESSING_FAILED') throw new ProviderError(`LinkedIn could not process the video${state.processingFailureReason ? `: ${state.processingFailureReason}` : ''}`, 'invalid');
    await wait(3000);
  }
  throw new ProviderError('LinkedIn is still processing the video; it will be tried again', 'transient');
}

async function uploadImage(context: SendContext, headers: Record<string, string>, owner: string, path: string): Promise<string> {
  const mime = mimeOf(path);
  if (!mime) throw new ProviderError(`LinkedIn does not accept "${path}" (use JPEG, PNG or GIF)`, 'invalid');
  const bytes = await context.readMedia(path);
  if (bytes.length > MAX_IMAGE_BYTES) throw new ProviderError(`"${path}" is over 8 MB`, 'invalid');

  const init = await request(
    context,
    'https://api.linkedin.com/rest/images?action=initializeUpload',
    { method: 'POST', headers, body: JSON.stringify({ initializeUploadRequest: { owner } }) },
    'image init'
  );
  const data = (await init.json().catch(() => ({}))) as {
    value?: { uploadUrl?: string; image?: string };
  };
  const { uploadUrl, image } = data.value ?? {};
  if (!uploadUrl || !image) throw new ProviderError('LinkedIn image init returned no upload url', 'invalid');

  await request(
    context,
    uploadUrl,
    { method: 'PUT', headers: { 'Content-Type': mime }, body: bytes as unknown as BodyInit },
    'image upload'
  );
  return image;
}

export const linkedin: Provider = {
  platform: 'linkedin',

  validate(post: Post, channel: Channel): string[] {
    const replies = post.replies ?? [];
    const commentIssues = [
      ...(post.replyImages ? ['a LinkedIn reply cannot take images from here'] : []),
      ...(replies.length > MAX_COMMENTS ? [`more than ${MAX_COMMENTS} replies`] : []),
      ...replies.flatMap((reply, index) => [...(reply === '' ? [`reply ${index + 1} is empty`] : []), ...(reply.length > MAX_COMMENT_CHARS ? [`reply ${index + 1} is over ${MAX_COMMENT_CHARS} characters`] : [])])
    ];
    const issues: string[] = [];
    const problem = urnProblem(channel);
    if (problem) issues.push(problem);
    if (post.text === '' && post.images.length === 0) issues.push('post needs text or an image');
    if (post.text.length > MAX_CHARS) issues.push(`text is over ${MAX_CHARS} characters`);
    if (post.images.length > MAX_IMAGES) issues.push(`more than ${MAX_IMAGES} images`);
    const documents = post.images.filter(isDocument);
    if (documents.length > 1 || (documents.length === 1 && post.images.length > 1)) issues.push('a PDF cannot be combined with other files; use one PDF or only images');
    const videos = post.images.filter(isVideo);
    if (videos.length > 1 || (videos.length === 1 && post.images.length > 1)) issues.push('a video cannot be combined with other files; use one video or only images');
    for (const image of post.images) {
      if (!mimeOf(image) && !isDocument(image) && !isVideo(image)) issues.push(`"${image}" must be JPEG, PNG, GIF, PDF or MP4`);
    }
    for (const name of Object.keys(post.mentions)) {
      if (!post.text.includes(name)) issues.push(`mention "${name}" does not appear in the text`);
    }
    return [...issues, ...commentIssues];
  },

  async send(post: Post, channel: Channel, credentials: Credentials, context: SendContext): Promise<SendResult> {
    const problem = urnProblem(channel);
    if (problem) throw new ProviderError(problem, 'invalid');
    const owner = channel.urn as string;

    const headers = {
      Authorization: `Bearer ${credentials.accessToken}`,
      'LinkedIn-Version': VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json'
    };

    const document = post.images.find(isDocument);
    const clip = post.images.find(isVideo);
    const images: string[] = [];
    if (document) context.progress?.('Uploading the PDF to LinkedIn…');
    const documentId = document ? await uploadDocument(context, headers, owner, document) : null;
    const videoId = clip ? await uploadVideo(context, headers, owner, clip) : null;
    if (post.images.length > 0 && !document && !clip) context.progress?.('Uploading the images to LinkedIn…');
    for (const path of document || clip ? [] : post.images) images.push(await uploadImage(context, headers, owner, path));

    context.progress?.('Posting to LinkedIn…');
    const body: Record<string, unknown> = {
      author: owner,
      commentary: littleText(post.text, post.mentions),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false
    };
    if (documentId) body.content = { media: { title: post.title?.trim() || (document as string).replace(/\.pdf$/i, ''), id: documentId } };
    if (videoId) body.content = { media: { id: videoId } };
    if (images.length === 1) body.content = { media: { id: images[0] } };
    if (images.length > 1) body.content = { multiImage: { images: images.map((id) => ({ id })) } };

    const res = await request(
      context,
      'https://api.linkedin.com/rest/posts',
      { method: 'POST', headers, body: JSON.stringify(body) },
      'post',
      true
    );
    const id = res.headers.get('x-restli-id');
    if (!id) {
      throw new ProviderError('LinkedIn accepted the post but returned no id; find it on LinkedIn', 'unconfirmed');
    }
    await context.checkpoint(id);
    const replies = post.replies ?? [];
    const done = await comment(context, headers, owner, id, replies, post.mentions, 0, { by: post.replyBy, speaker: context.speaker });
    return { id, url: postUrl(id), ...(done.warning !== undefined && { warning: `Posted, but ${done.warning}` }), ...(replies.length > 0 && { replies: { count: done.sent, ids: done.ids, ...(done.by && { by: done.by }) } }) };
  },

  async reply(input, channel, credentials, fetchImpl): Promise<ReplyResult> {
    const problem = urnProblem(channel);
    if (problem) throw new ProviderError(problem, 'invalid');
    const headers = { Authorization: `Bearer ${credentials.accessToken}`, 'LinkedIn-Version': VERSION, 'X-Restli-Protocol-Version': '2.0.0', 'Content-Type': 'application/json' };
    return comment({ fetch: fetchImpl } as SendContext, headers, channel.urn as string, input.remoteId, input.texts, input.mentions ?? {}, input.offset, { by: input.by, speaker: input.speaker });
  },

  async removeReply(input, channel, credentials, fetchImpl): Promise<void> {
    const problem = urnProblem(channel);
    if (problem) throw new ProviderError(problem, 'invalid');
    const headers = oldStyle({ Authorization: `Bearer ${credentials.accessToken}`, 'LinkedIn-Version': VERSION, 'X-Restli-Protocol-Version': '2.0.0' });
    const url = `${COMMENTS}/${encodeURIComponent(input.remoteId)}/comments/${encodeURIComponent(input.replyId)}?actor=${encodeURIComponent(channel.urn as string)}`;
    try {
      await request({ fetch: fetchImpl } as SendContext, url, { method: 'DELETE', headers }, 'delete reply');
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'invalid' && /\(404\)/.test(err.message)) return;
      throw err;
    }
  },

  async remove(remoteId: string, _channel: Channel, credentials: Credentials, fetchImpl: typeof fetch): Promise<void> {
    const headers = { Authorization: `Bearer ${credentials.accessToken}`, 'LinkedIn-Version': VERSION, 'X-Restli-Protocol-Version': '2.0.0' };
    const context = { fetch: fetchImpl } as SendContext;
    try {
      await request(context, `https://api.linkedin.com/rest/posts/${encodeURIComponent(remoteId)}`, { method: 'DELETE', headers }, 'delete');
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'invalid' && /\(404\)/.test(err.message)) return;
      throw err;
    }
  }
};
