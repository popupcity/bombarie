import assert from 'node:assert/strict';
import { test } from 'node:test';
import { issue, SESSION_DAYS, who } from './auth.ts';

const now = new Date('2026-11-20T09:00:00Z');

test('a session cookie names its user, until it expires and only for the secret that signed it', () => {
  const token = issue('secret', 'anna', now);
  assert.equal(who('secret', token, now), 'anna');
  assert.equal(who('secret', token, new Date(now.getTime() + (SESSION_DAYS * 24 * 60 - 1) * 60_000)), 'anna');
  assert.equal(who('secret', token, new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60_000)), null);
  assert.equal(who('other', token, now), null);
});

test('a missing, cut or tampered cookie is refused, and the name cannot be swapped', () => {
  const token = issue('secret', 'anna', now);
  const [name, expires, signature] = token.split('.') as [string, string, string];
  assert.equal(who('secret', undefined, now), null);
  assert.equal(who('secret', '', now), null);
  assert.equal(who('secret', `${name}.${expires}`, now), null);
  assert.equal(who('secret', `jeroen.${expires}.${signature}`, now), null);
  assert.equal(who('secret', `${name}.${Number(expires) + 1}.${signature}`, now), null);
  assert.equal(who('secret', `${name}.${expires}.${signature.slice(1)}`, now), null);
});
