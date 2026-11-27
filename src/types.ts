export type Platform = 'linkedin' | 'instagram' | 'facebook' | 'threads' | 'substack' | 'website';

export const isDocument = (name: string): boolean => /\.pdf$/i.test(name);

export const isVideo = (name: string): boolean => /\.mp4$/i.test(name);

export const isMedia = (name: string): boolean => /\.(jpe?g|png|gif|webp|pdf|mp4)$/i.test(name) && !isCover(name);

export const isCover = (name: string): boolean => /\.(pdf|mp4)\.cover\.jpg$/i.test(name);

export const mediaKind = (name: string): 'pdf' | 'video' | 'image' => (/\.pdf(\.cover\.jpg)?$/i.test(name) ? 'pdf' : /\.mp4(\.cover\.jpg)?$/i.test(name) ? 'video' : 'image');

export const coverLabel = (name: string): string => (mediaKind(name) === 'video' ? 'Video' : 'PDF');

export const needsCover = (name: string): boolean => isDocument(name) || isVideo(name);

export const takesMedia = (platform: Platform, name: string): boolean => (platform === 'linkedin' ? true : platform === 'instagram' || platform === 'threads' || platform === 'substack' ? !isDocument(name) : !needsCover(name));

export const FEED_ONLY: Platform[] = ['website'];

export const COMPOSE_URL: Partial<Record<Platform, string>> = {
  linkedin: 'https://www.linkedin.com/feed/',
  facebook: 'https://www.facebook.com/',
  instagram: 'https://www.instagram.com/',
  threads: 'https://www.threads.com/',
  substack: 'https://substack.com/publish'
};

export const PLATFORM_LABEL: Record<Platform, string> = { linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', threads: 'Threads', substack: 'Substack', website: 'Website' };

export interface Channel {
  platform: Platform;
  handle?: string;
  page?: string;
  kind?: 'person' | 'organization';
  urn?: string;
  name?: string;
  avatar?: string;
  feed?: string;
}

export interface ChannelInfo {
  name: string;
  platform: Platform;
  label: string;
  avatar?: string;
  handle?: string;
}

export type PostStatus = 'draft' | 'planned';

export interface Post {
  id: string;
  channel: string;
  type: string | null;
  status: PostStatus;
  manual: boolean;
  date: Date;
  images: string[];
  mentions: Record<string, string>;
  link?: string;
  title?: string;
  text: string;
  replies?: string[];
  replyBy?: string[];
}

export interface Credentials {
  accessToken: string;
  refreshToken?: string;
  accountId?: string;
  expiresAt?: Date;
}

export interface RepliesDone {
  count: number;
  by?: string[];
  last?: string;
  ids?: string[];
}

export interface Speaker {
  urn: string;
  credentials: Credentials;
}

export interface ReplyResult {
  sent: number;
  ids: string[];
  by?: string[];
  last?: string;
  warning?: string;
}

export interface SendResult {
  id: string;
  url?: string;
  warning?: string;
  replies?: RepliesDone;
}

type ProviderErrorCode = 'auth' | 'rate' | 'transient' | 'invalid' | 'unconfirmed';

export class ProviderError extends Error {
  code: ProviderErrorCode;

  constructor(message: string, code: ProviderErrorCode) {
    super(message);
    this.code = code;
  }
}

export interface SendContext {
  fetch: typeof fetch;
  publicImage(path: string, options?: { story?: boolean }): Promise<string>;
  publicVideo(path: string): Promise<string>;
  sleep?(ms: number): Promise<void>;
  progress?(text: string): void;
  readMedia(path: string): Promise<Uint8Array>;
  checkpoint(id: string): Promise<void>;
  speaker?: (channel: string) => Promise<Speaker>;
}

export interface Provider {
  platform: Platform;
  validate(post: Post, channel: Channel): string[];
  send(post: Post, channel: Channel, credentials: Credentials, context: SendContext): Promise<SendResult>;
  remove?(remoteId: string, channel: Channel, credentials: Credentials, fetchImpl: typeof fetch): Promise<void>;
  removeReply?(input: { remoteId: string; replyId: string }, channel: Channel, credentials: Credentials, fetchImpl: typeof fetch): Promise<void>;
  reply?(input: { remoteId: string; texts: string[]; mentions?: Record<string, string>; by?: string[]; speaker?: (channel: string) => Promise<Speaker>; offset: number; last?: string }, channel: Channel, credentials: Credentials, fetchImpl: typeof fetch): Promise<ReplyResult>;
  refresh?(credentials: Credentials, fetchImpl: typeof fetch): Promise<Credentials>;
}
