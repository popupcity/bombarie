import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileContentStore } from '../../src/content-store.ts';
import { buildCalendarData } from '../../src/calendar.ts';
import type { CalendarData } from '../../src/calendar.ts';

import { sendProblem } from '../../src/connect.ts';
import { channelInfos, loadChannels } from '../../src/channels.ts';
import { localDeps } from '../../src/local.ts';
import { clearProgress, forgetOutcome, rememberOutcome } from '../../src/progress.ts';
import { readPosts } from '../../src/posts.ts';
import { runNow } from '../../src/run.ts';
import type { Outcome, RunDeps } from '../../src/run.ts';
import { announce } from '../../src/notify.ts';
import { reportingOf } from './telegram.ts';
import { postReplies, removeReply } from '../../src/reply.ts';
import { MANUAL_ID, unpost } from '../../src/unpost.ts';
import { PlanBlocked, deletePost, deleteVariant, loadCampaign, saveVariant } from '../../src/campaign.ts';
import { LATE_AFTER_MS } from '../../src/plan.ts';
import { parseDate } from '../../src/time.ts';
import { readFields, withDate, withStatus } from '../../src/frontmatter.ts';
import { sentence } from '../../src/text.ts';
import { needsCover } from '../../src/types.ts';
import { readTokens, tokensPath } from '../../src/secrets.ts';
import { createHash } from 'node:crypto';
import { readFeed } from '../../src/feed.ts';
import { attention, fileStore, rearm } from '../../src/state.ts';
import type { State } from '../../src/state.ts';
import type { Post } from '../../src/types.ts';

export const root = process.env.BOMBARIE_ROOT ?? join(process.cwd(), 'data');
export const content = fileContentStore(root);
export const states = fileStore(root);

export async function loadCalendar(now = new Date()): Promise<CalendarData> {
  const channels = loadChannels(root);
  const feedOf = (name: string) => {
    const file = readFeed(root, name);
    return file && file.source === channels[name]?.feed ? file : null;
  };
  const read = readPosts(root, channels);
  const posts = read.posts.map((post) => ({
    ...post,
    images: post.images.flatMap((name) => (needsCover(name) ? (existsSync(join(root, 'posts', post.id.split('/')[0] ?? '', `${name}.cover.jpg`)) ? [`${name}.cover.jpg`] : []) : [name]))
  }));
  const errors = read.errors;
  const stateOf = new Map<string, State | null>();
  for (const post of posts) stateOf.set(post.id, await states.get(post.id));
  const connections = await loadConnections(now);
  const data = buildCalendarData({
    posts,
    states: stateOf,
    errors,
    attention: await attention(
      states,
      posts.map((p) => p.id),
      now
    ),
    channels: channelInfos(channels),
    feeds: Object.keys(channels).flatMap((name) =>
      (feedOf(name)?.items ?? []).map((item) => ({ id: `feed/${name}/${createHash('sha1').update(item.guid).digest('hex').slice(0, 12)}`, channel: name, title: item.title, url: item.url, at: item.at, text: item.text }))
    ),
    now
  });
  return {
    ...data,
    cards: data.cards.map((card) => ({ ...card, manual: card.manual || (card.status === 'draft' && Boolean(connections[card.channel])) })),
    channels: data.channels.map((channel) => ({ ...channel, ...(connections[channel.name] ? { problem: connections[channel.name]! } : {}) }))
  };
}

export async function loadConnections(now = new Date()): Promise<Record<string, string | null>> {
  const channels = loadChannels(root);
  let tokens: Awaited<ReturnType<typeof readTokens>> = {};
  let unreadable: string | null = null;
  try {
    tokens = await readTokens(tokensPath());
  } catch (err) {
    unreadable = `cannot read the tokens: ${err instanceof Error ? err.message : String(err)}`;
  }
  return Object.fromEntries(
    Object.entries(channels).map(([name, channel]) => [name, unreadable ?? sendProblem(channel, tokens[name], now)])
  );
}

export const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const wording = (status: string, message: string | undefined): string => {
  const detail = message ? ` ${message}` : '';
  switch (status) {
    case 'posted':
      return message?.startsWith('Posted, but') ? message : 'Posted.';
    case 'retry':
      return `Nothing was posted. Try again in a moment.${message ? ` (${message})` : ''}`;
    case 'unconfirmed':
      return `It may or may not be live. Check the channel before trying again.${detail}`;
    case 'skipped':
      return message === 'already claimed' ? 'This post was already posted or is being posted.' : `Not posted: ${message ?? 'unknown reason'}.`;
    default:
      return `Not posted: ${message ?? 'unknown error'}.`;
  }
};

export const outcomeWording = wording;

type Done = { ok: boolean; text: string };

const findPost = (folder: string, base: string): Post | undefined => readPosts(root, loadChannels(root)).posts.find((candidate) => candidate.id === `${folder}/${base}.md`);

async function onPost(folder: string, base: string, work: (post: Post, id: string) => Promise<string>): Promise<Done> {
  const post = findPost(folder, base);
  if (!post) return { ok: false, text: 'This post could not be read.' };
  try {
    return { ok: true, text: await work(post, `${folder}/${base}.md`) };
  } catch (err) {
    return { ok: false, text: sentence(err instanceof Error ? err.message : String(err)) };
  }
}

async function announceNow(outcome: Outcome, deps: RunDeps): Promise<void> {
  try {
    const told = await reportingOf(root, deps);
    if (!told) return;
    for (const problem of await announce(readPosts(root, loadChannels(root)).posts, [outcome], told)) console.error(`telegram: ${problem}`);
  } catch (err) {
    console.error(`telegram: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function startPostNow(folder: string, base: string, by?: string): Promise<Done> {
  const id = `${folder}/${base}.md`;
  const post = findPost(folder, base);
  if (!post) return { ok: false, text: 'This post could not be read. Fix it first.' };
  const problem = (await loadConnections())[post.channel];
  if (problem) return { ok: false, text: problem };
  forgetOutcome(id);
  clearProgress(id);
  let claimed: () => void = () => {};
  const claimedFirst = new Promise<'claimed'>((resolve) => {
    claimed = () => resolve('claimed');
  });
  const deps = { ...localDeps(root, new Date()), ...(by && { by }) };
  const finished = runNow(post, deps, { onClaimed: claimed }).then((outcome) => {
    void announceNow(outcome, deps);
    clearProgress(id);
    if (outcome.status !== 'would-post') rememberOutcome(id, { status: outcome.status, message: outcome.message ?? '', at: new Date().toISOString() });
    return outcome;
  });
  const first = await Promise.race([claimedFirst, finished]);
  if (first === 'claimed') return { ok: true, text: 'Posting…' };
  return { ok: first.status === 'posted', text: wording(first.status, first.message) };
}

let flash: { text: string; tone: 'ok' | 'bad' } | null = null;

export function setFlash(next: { text: string; tone: 'ok' | 'bad' }): void {
  flash = next;
}

export function takeFlash(): { text: string; tone: 'ok' | 'bad' } | null {
  const found = flash;
  flash = null;
  return found;
}

export async function cardAction(action: string, id: string, value: string, by?: string): Promise<{ ok: boolean; text: string }> {
  const [folder = '', file = ''] = id.split('/');
  const base = file.replace(/\.md$/, '');
  const path = `posts/${folder}/${base}.md`;
  try {
    if (action === 'delete') {
      const campaign = loadCampaign(root, folder);
      if (!campaign) return { ok: false, text: 'This post no longer exists.' };
      if (campaign.variants.length === 1) await deletePost(root, content, states, folder);
      else await deleteVariant(root, content, states, folder, base);
      return { ok: true, text: 'Deleted.' };
    }
    const current = await content.read(path);
    if (!current) return { ok: false, text: 'This post no longer exists.' };
    let raw: string;
    if (action === 'plan') raw = withStatus(value === '' ? current.text : withDate(current.text, value), 'planned');
    else if (action === 'draft') raw = withStatus(current.text, 'draft');
    else if (action === 'replan') {
      const date = parseDate(value);
      const fields = readFields(current.text);
      const saved = { planned: fields.ok && fields.status === 'planned', manual: fields.ok && fields.manual };
      if (saved.planned && !saved.manual && Date.now() - date.getTime() > LATE_AFTER_MS) return { ok: false, text: 'Pick a time in the future.' };
      raw = withDate(current.text, value);
    } else return { ok: false, text: 'Unknown action.' };
    const saved = await saveVariant(root, content, folder, base, { raw, revision: current.revision, by }, new Date(), async (name) => (await loadConnections())[name] ?? null);
    if (saved.post) await rearm(states, id, saved.post);
    return { ok: true, text: action === 'plan' ? 'Planned.' : action === 'draft' ? 'Back to draft.' : 'Date changed.' };
  } catch (err) {
    if (err instanceof PlanBlocked) return { ok: false, text: sentence(err.problems.join('; ')) };
    return { ok: false, text: sentence(err instanceof Error ? err.message : String(err)) };
  }
}

export async function handleCardPost(request: Request, page: '/' | '/calendar', by?: string): Promise<{ redirect: string | null; problem: string }> {
  const form = await request.formData();
  const action = String(form.get('action') ?? form.get('intent') ?? '');
  const id = String(form.get('id') ?? form.get('variant') ?? '');
  const date = String(form.get('date') ?? '');
  const result = await cardAction(action, id, date, by);
  if (!result.ok) return { redirect: null, problem: result.text };
  setFlash({ text: result.text, tone: 'ok' });
  const day = date !== '' && (action === 'replan' || action === 'plan') ? date.slice(0, 10) : String(form.get('day') ?? '');
  const anchor = page === '/' && action !== 'delete' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? `#${day}` : '';
  return { redirect: `${page}${anchor}`, problem: '' };
}

export function folderCountsOf(cards: { id: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const card of cards) {
    const folder = card.id.split('/')[0] ?? card.id;
    counts[folder] = (counts[folder] ?? 0) + 1;
  }
  return counts;
}

export const deleteFromPlatform = (folder: string, base: string): Promise<Done> =>
  onPost(folder, base, async (post, id) => {
    await unpost(id, post.channel, { ...localDeps(root, new Date()), fetch });
    return 'Deleted from the platform.';
  });

export const postRepliesNow = (folder: string, base: string): Promise<Done> =>
  onPost(folder, base, async (post, id) => {
    const deps = localDeps(root, new Date());
    const result = await postReplies(id, post.channel, post.replies ?? [], { ...deps, fetch }, post.mentions, post.replyBy, { images: post.replyImages, publicImage: deps.context(post).publicImage, publicVideo: deps.context(post).publicVideo });
    if (result.warning) throw new Error(result.warning);
    return result.sent === 0 ? 'Nothing new to post.' : result.sent === 1 ? 'Reply posted.' : `${result.sent} replies posted.`;
  });

export const deleteReplyNow = (folder: string, base: string, index: number, platformToo: boolean): Promise<Done> =>
  onPost(folder, base, async (post, id) => {
    await removeReply(id, post.channel, index, platformToo, { ...localDeps(root, new Date()), fetch });
    return platformToo ? 'Deleted from the platform and here.' : 'Deleted here.';
  });

export async function markPosted(folder: string, base: string, by?: string): Promise<void> {
  const id = `${folder}/${base}.md`;
  const current = await states.get(id);
  if (current?.status === 'posted') return;
  if (current) await states.remove(id);
  await states.create(id, { status: 'posted', at: new Date().toISOString(), remoteId: MANUAL_ID, ...(by && { by }) });
}

export async function unmarkPosted(folder: string, base: string): Promise<void> {
  const id = `${folder}/${base}.md`;
  const current = await states.get(id);
  if (current?.status === 'posted' && current.remoteId === MANUAL_ID) await states.remove(id);
}
