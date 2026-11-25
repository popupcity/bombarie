import { MANUAL_ID, withAuthHint } from './unpost.ts';
import type { UnpostDeps } from './unpost.ts';

export const canReply = (providers: UnpostDeps['providers'], platform: keyof UnpostDeps['providers']): boolean => typeof providers[platform]?.reply === 'function';

export const canRemoveReply = (providers: UnpostDeps['providers'], platform: keyof UnpostDeps['providers']): boolean => typeof providers[platform]?.removeReply === 'function';

export async function postReplies(id: string, channelName: string, texts: string[], deps: UnpostDeps): Promise<{ sent: number; warning?: string }> {
  const state = await deps.store.get(id);
  if (state?.status !== 'posted') throw new Error('only a posted post can get a comment from here');
  if (state.remoteId === MANUAL_ID) throw new Error('this post was marked as posted by hand, so add the comment on the platform');
  const channel = deps.channels[channelName];
  const provider = channel && deps.providers[channel.platform];
  if (!channel || !provider?.reply) throw new Error('this platform cannot take comments from here');
  const offset = state.replies?.count ?? 0;
  const todo = texts.slice(offset);
  if (todo.some((text) => text.trim() === '')) throw new Error('a reply is empty; fill it in or remove it');
  if (todo.length === 0) return { sent: 0 };
  const credentials = await deps.credentials(channelName);
  if (!credentials) throw new Error('this channel is not connected; connect it first');
  const result = await withAuthHint(() => provider.reply!({ remoteId: state.remoteId, texts: todo, offset, ...(state.replies?.last !== undefined && { last: state.replies.last }) }, channel, credentials, deps.fetch));
  const known = state.replies?.ids ?? [];
  const ids = [...Array.from({ length: offset }, (_, index) => known[index] ?? ''), ...result.ids];
  const last = result.last ?? state.replies?.last;
  await deps.store.replace(id, { ...state, replies: { count: offset + result.sent, ids, ...(last !== undefined && { last }) } });
  return { sent: result.sent, ...(result.warning !== undefined && { warning: result.warning }) };
}

export async function removeReply(id: string, channelName: string, index: number, platformToo: boolean, deps: UnpostDeps): Promise<void> {
  const state = await deps.store.get(id);
  if (state?.status !== 'posted' || !state.replies || index < 0 || index >= state.replies.count) throw new Error('that reply was not posted from here');
  const ids = Array.from({ length: state.replies.count }, (_, position) => state.replies?.ids?.[position] ?? '');
  if (platformToo) {
    const channel = deps.channels[channelName];
    const provider = channel && deps.providers[channel.platform];
    if (!channel || !provider?.removeReply) throw new Error('this platform cannot delete replies from here; delete it there and choose Only here');
    const replyId = ids[index] ?? '';
    if (replyId === '') throw new Error('the id of this reply is not known; delete it on the platform and choose Only here');
    const credentials = await deps.credentials(channelName);
    if (!credentials) throw new Error('this channel is not connected; connect it first');
    await withAuthHint(() => provider.removeReply!({ remoteId: state.remoteId, replyId }, channel, credentials, deps.fetch));
  }
  ids.splice(index, 1);
  const last = ids.filter((known) => known !== '').at(-1);
  await deps.store.replace(id, { ...state, replies: { count: ids.length, ids, ...(last !== undefined && { last }) } });
}
