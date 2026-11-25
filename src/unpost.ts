import type { Channels } from './channels.ts';
import type { StateStore } from './state.ts';
import { ProviderError } from './types.ts';
import type { Credentials, Platform, Provider } from './types.ts';

export const MANUAL_ID = 'manual';

export interface UnpostDeps {
  store: StateStore;
  channels: Channels;
  providers: Partial<Record<Platform, Provider>>;
  credentials(channel: string): Promise<Credentials | null>;
  fetch: typeof fetch;
  now: Date;
}

export async function withAuthHint<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ProviderError && err.code === 'auth') throw new Error(`${err.message}; connect the channel again`);
    throw err;
  }
}

export const canUnpost = (providers: UnpostDeps['providers'], platform: Platform): boolean => typeof providers[platform]?.remove === 'function';

export async function unpost(id: string, channelName: string, deps: UnpostDeps): Promise<void> {
  const state = await deps.store.get(id);
  if (state?.status !== 'posted') throw new Error('only a posted post can be deleted from the platform');
  if (state.remoteId === MANUAL_ID) throw new Error('this post was marked as posted by hand, so there is nothing to delete from here; delete it on the platform');
  const channel = deps.channels[channelName];
  const provider = channel && deps.providers[channel.platform];
  if (!channel || !provider?.remove) throw new Error('this platform cannot delete posts from here; delete it in the app');
  const credentials = await deps.credentials(channelName);
  if (!credentials) throw new Error('this channel is not connected; connect it first');
  await withAuthHint(() => provider.remove!(state.remoteId, channel, credentials, deps.fetch));
  await deps.store.replace(id, { status: 'deleted', at: deps.now.toISOString(), remoteId: state.remoteId, ...(state.url !== undefined && { url: state.url }) });
}
