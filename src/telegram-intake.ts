import { createHmac } from 'node:crypto';
import { loadChannels } from './channels.ts';
import { readPosts } from './posts.ts';
import { postPath, titleOf, whereOf } from './remind.ts';
import { fileStore, unstarted } from './state.ts';
import { clock, whenLabel, ymd } from './time.ts';
import type { ContentStore } from './content-store.ts';
import { addIdeaImage, attachPreview, createIdea, ideaTitle, readIdea, titleFrom } from './ideas.ts';
import { MAX_IMAGE_BYTES, saveImage } from './media.ts';
import { telegram } from './telegram.ts';
import type { Message } from './telegram.ts';

const API = 'https://api.telegram.org';

interface Photo {
  file_id: string;
  file_size?: number;
}

export interface Update {
  message?: { chat?: { id?: number | string }; text?: string; caption?: string; photo?: Photo[] };
}

export interface Intake {
  root: string;
  store: ContentStore;
  token: string;
  chat: string;
  origin: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}

export const webhookSecret = (token: string): string => createHmac('sha256', token).update('bombarie-telegram').digest('hex').slice(0, 48);

const send = (intake: Intake, message: Message): Promise<void> => telegram(intake.token, intake.chat, intake.fetchImpl ?? fetch)(message).catch(() => undefined);

async function download(intake: Intake, photo: Photo): Promise<Uint8Array> {
  const fetchImpl = intake.fetchImpl ?? fetch;
  const info = (await (await fetchImpl(`${API}/bot${intake.token}/getFile?file_id=${encodeURIComponent(photo.file_id)}`)).json()) as { result?: { file_path?: string } };
  const path = info.result?.file_path;
  if (!path) throw new Error('Telegram did not give the file');
  const response = await fetchImpl(`${API}/file/bot${intake.token}/${path}`);
  if (!response.ok) throw new Error('could not download the photo');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('the photo is over 10 MB');
  return bytes;
}

const SHOWN = 5;

export const COMMANDS = [{ command: 'planned', description: 'The next planned posts' }];

const HELP = `Send a text, a link or a photo and it is saved as an idea.\n${COMMANDS.map(({ command, description }) => `/${command}: ${description.toLowerCase()}`).join('\n')}`;

async function planned(intake: Intake): Promise<void> {
  const now = intake.now ?? new Date();
  const channels = loadChannels(intake.root);
  const { posts } = readPosts(intake.root, channels);
  const store = fileStore(intake.root);
  const ahead = posts.filter((post) => post.status === 'planned' && post.date.getTime() >= now.getTime());
  const next = (await unstarted(store, ahead)).slice(0, SHOWN);
  if (next.length === 0) return send(intake, { text: 'Nothing planned.' });
  for (const post of next) {
    const title = titleOf(post, posts);
    const at = whenLabel(`${ymd(post.date)}T${clock(post.date)}`).replace(', ', ' at ');
    const where = whereOf(post, channels);
    const when = post.manual ? `Reminder on ${at} to post ${where}` : `Posting ${at} ${where}`;
    await send(intake, { text: title ? `${when}: ${title}` : when, ...(title && { bold: title }), view: `${intake.origin}${postPath(post)}` });
  }
}

async function answer(text: string, intake: Intake): Promise<void> {
  const command = text.slice(1).split(/[\s@]/)[0]!.toLowerCase();
  if (command === 'planned') return planned(intake);
  await send(intake, { text: HELP });
}

export async function handleUpdate(update: Update, intake: Intake): Promise<'saved' | 'answered' | 'ignored' | 'failed'> {
  const message = update.message;
  if (!message || String(message.chat?.id ?? '') !== intake.chat) return 'ignored';
  const text = (message.text ?? message.caption ?? '').trim();
  const photo = message.photo?.at(-1);
  if (text === '' && !photo) return 'ignored';
  try {
    if (!photo && text.startsWith('/')) {
      await answer(text, intake);
      return 'answered';
    }
    const parts = text === '' ? { name: 'photo' } : titleFrom(text);
    const folder = await createIdea(intake.root, intake.store, parts);
    if (photo) {
      const bytes = await download(intake, photo);
      const name = await saveImage(intake.store, folder, 'photo.jpg', bytes, 'ideas');
      await addIdeaImage(intake.root, intake.store, folder, name);
    }
    await attachPreview(intake.root, intake.store, folder);
    const idea = readIdea(intake.root, folder);
    const title = (idea && ideaTitle(idea)) || 'Untitled';
    await send(intake, { text: `Saved to Ideas: ${title}`, bold: title, view: `${intake.origin}/ideas/${encodeURIComponent(folder)}` });
    return 'saved';
  } catch (err) {
    await send(intake, { text: `Not saved: ${err instanceof Error ? err.message : String(err)}` });
    return 'failed';
  }
}

export async function registerWebhook(token: string, origin: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  await fetchImpl(`${API}/bot${token}/setMyCommands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commands: COMMANDS })
  }).catch(() => null);
  const response = await fetchImpl(`${API}/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: `${origin}/api/telegram`, secret_token: webhookSecret(token), allowed_updates: ['message'] })
  }).catch(() => null);
  return response?.ok ?? false;
}
