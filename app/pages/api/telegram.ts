import type { APIRoute } from 'astro';
import { handleUpdate, type Update, webhookSecret } from '../../../src/telegram-intake.ts';
import { content, root } from '../../lib/data.ts';

export const POST: APIRoute = async ({ request, url }) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return new Response('Not set up.', { status: 404 });
  if (request.headers.get('x-telegram-bot-api-secret-token') !== webhookSecret(token)) return new Response('Not allowed.', { status: 403 });
  const update = (await request.json().catch(() => ({}))) as Update;
  await handleUpdate(update, { root, store: content, token, chat, origin: url.origin });
  return new Response('ok');
};
