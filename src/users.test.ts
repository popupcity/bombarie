import assert from 'node:assert/strict';
import { test } from 'node:test';
import { change, hasAdmin, roleOf } from './users.ts';

const users = { jeroen: 'admin', anna: 'admin', joop: 'member' };

test('names are found whatever their case, and an admin is known', () => {
  assert.equal(roleOf(users, 'JOOP'), 'member');
  assert.equal(roleOf(users, 'nobody'), null);
  assert.equal(hasAdmin(users), true);
  assert.equal(hasAdmin({ joop: 'member' }), false);
});

test('an admin adds, promotes and removes users', () => {
  assert.deepEqual(change(users, 'anna', 'newbie', 'member').newbie, 'member');
  assert.equal(change(users, 'anna', 'joop', 'admin').joop, 'admin');
  assert.equal('joop' in change(users, 'jeroen', 'JOOP', null), false);
});

test('a member cannot change anyone', () => {
  assert.throws(() => change(users, 'joop', 'x', 'member'), /only an admin/);
});

test('the last admin stays, and a name must be a GitHub name', () => {
  const alone = { jeroen: 'admin', joop: 'member' };
  assert.throws(() => change(alone, 'jeroen', 'jeroen', 'member'), /keep at least one admin/);
  assert.throws(() => change(alone, 'jeroen', 'jeroen', null), /keep at least one admin/);
  assert.equal('anna' in change(users, 'jeroen', 'anna', null), false);
  assert.throws(() => change(users, 'jeroen', 'not a name', 'member'), /not a GitHub name/);
  assert.throws(() => change(users, 'jeroen', '-bad', 'member'), /not a GitHub name/);
});
