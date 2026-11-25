import { defineMiddleware } from 'astro:middleware';
import { configured, COOKIE, OPEN, required, signedInAs } from './lib/auth.ts';
import { ensureScheduler } from './lib/scheduler.ts';
import { registerWebhook } from '../src/telegram-intake.ts';

let registered = false;

export const onRequest = defineMiddleware((context, next) => {
  ensureScheduler();
  const bot = process.env.TELEGRAM_BOT_TOKEN;
  if (bot && process.env.TELEGRAM_CHAT_ID && !registered && context.url.protocol === 'https:') {
    registered = true;
    void registerWebhook(bot, context.url.origin);
  }
  const { pathname } = context.url;
  if (OPEN.some((open) => pathname === open || (open.endsWith('/') && pathname.startsWith(open)))) return next();
  if (!required()) return next();
  if (!configured()) return new Response('Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and BOMBARIE_ADMINS before using this app.', { status: 503 });
  const user = signedInAs(context.cookies.get(COOKIE)?.value);
  if (user) {
    context.locals.user = user;
    return next();
  }
  if (pathname.startsWith('/api/') || pathname.startsWith('/img/')) return new Response('Not signed in.', { status: 401 });
  return context.redirect('/login');
});
