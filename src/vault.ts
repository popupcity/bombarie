import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const keys = new Map<string, Buffer>();
const keyFor = (secret: string, salt: Buffer): Buffer => {
  const id = `${secret}:${salt.toString('base64')}`;
  let key = keys.get(id);
  if (!key) {
    key = scryptSync(secret, salt, 32);
    keys.set(id, key);
  }
  return key;
};

export function seal(data: unknown, secret: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret, salt), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  const parts = { salt, iv, tag: cipher.getAuthTag(), data: body };
  return `${JSON.stringify({ v: 1, ...Object.fromEntries(Object.entries(parts).map(([name, value]) => [name, value.toString('base64')])) })}\n`;
}

export function isSealed(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && (raw as { v?: unknown }).v === 1 && typeof (raw as { data?: unknown }).data === 'string';
}

export function open(raw: unknown, secret: string): unknown {
  const file = raw as Record<'salt' | 'iv' | 'tag' | 'data', string>;
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFor(secret, Buffer.from(file.salt, 'base64')), Buffer.from(file.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(file.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(file.data, 'base64')), decipher.final()]).toString('utf8'));
  } catch {
    throw new Error('cannot decrypt: the BOMBARIE_SECRET is wrong or the file is damaged');
  }
}
