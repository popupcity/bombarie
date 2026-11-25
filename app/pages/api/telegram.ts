import type { APIRoute } from 'astro';
import { handleUpdate, type Update, webhookSecret } from '../../../src/telegram-intake.ts';
import { content, root } from '../../lib/data.ts';
import { telegramOf } from '../../lib/telegram.ts';

export const POST: APIRoute = async ({ request, url }) => {
  const bot = await telegramOf();
  if (!bot) return new Response('Not set up.', { status: 404 });
  const { token, chat } = bot;
  if (request.headers.get('x-telegram-bot-api-secret-token') !== webhookSecret(token)) return new Response('Not allowed.', { status: 403 });
  const update = (await request.json().catch(() => ({}))) as Update;
  await handleUpdate(update, { root, store: content, token, chat, origin: url.origin });
  return new Response('ok');
};
