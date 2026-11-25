import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_DAYS = 30;

const mac = (secret: string, text: string): string => createHmac('sha256', secret).update(text).digest('hex');

export function issue(secret: string, name: string, now: Date): string {
  const expires = now.getTime() + SESSION_DAYS * 24 * 60 * 60_000;
  return `${name}.${expires}.${mac(secret, `${name}.${expires}`)}`;
}

export function who(secret: string, token: string | undefined, now: Date): string | null {
  if (!token) return null;
  const [name = '', expires = '', signature = ''] = token.split('.');
  const expected = Buffer.from(mac(secret, `${name}.${expires}`));
  const given = Buffer.from(signature);
  if (name === '' || given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return Number(expires) > now.getTime() ? name : null;
}
