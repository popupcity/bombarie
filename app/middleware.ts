import { defineMiddleware } from 'astro:middleware';
import { COOKIE, installed, OPEN, required, signedInAs, users } from './lib/auth.ts';
import { roleOf } from '../src/users.ts';
import { ensureScheduler } from './lib/scheduler.ts';
import { registerWebhook } from '../src/telegram-intake.ts';

let registered = false;

export const onRequest = defineMiddleware(async (context, next) => {
  ensureScheduler();
  const bot = process.env.TELEGRAM_BOT_TOKEN;
  if (bot && process.env.TELEGRAM_CHAT_ID && !registered && context.url.protocol === 'https:') {
    registered = true;
    void registerWebhook(bot, context.url.origin);
  }
  const { pathname } = context.url;
  if (OPEN.some((open) => pathname === open || (open.endsWith('/') && pathname.startsWith(open)))) return next();
  if (!(await required())) return next();
  if (!(await installed())) return context.redirect('/setup');
  const user = signedInAs(context.cookies.get(COOKIE)?.value);
  const role = user ? roleOf(await users(), user) : null;
  if (user && role) {
    context.locals.user = user;
    context.locals.role = role;
    return next();
  }
  if (pathname.startsWith('/api/') || pathname.startsWith('/img/')) return new Response('Not signed in.', { status: 401 });
  return context.redirect('/login');
});
