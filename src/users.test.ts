import assert from 'node:assert/strict';
import { test } from 'node:test';
import { change, hasOwner, roleOf } from './users.ts';

const users = { jeroen: 'owner', anna: 'admin', joop: 'member' };

test('names are found whatever their case, and the owner is known', () => {
  assert.equal(roleOf(users, 'JOOP'), 'member');
  assert.equal(roleOf(users, 'nobody'), null);
  assert.equal(hasOwner(users), true);
  assert.equal(hasOwner({ joop: 'member' }), false);
});

test('an owner or an admin adds, promotes and removes members', () => {
  assert.deepEqual(change(users, 'anna', 'newbie', 'member').newbie, 'member');
  assert.equal(change(users, 'anna', 'joop', 'admin').joop, 'admin');
  assert.equal('joop' in change(users, 'jeroen', 'JOOP', null), false);
});

test('a member cannot change anyone, and only an owner touches an owner', () => {
  assert.throws(() => change(users, 'joop', 'x', 'member'), /only an owner or an admin/);
  assert.throws(() => change(users, 'anna', 'jeroen', 'member'), /only an owner can change an owner/);
  assert.throws(() => change(users, 'anna', 'joop', 'owner'), /only an owner can change an owner/);
  assert.equal(change(users, 'jeroen', 'anna', 'owner').anna, 'owner');
});

test('the last owner stays, and a name must be a GitHub name', () => {
  assert.throws(() => change(users, 'jeroen', 'jeroen', 'admin'), /keep at least one owner/);
  assert.throws(() => change(users, 'jeroen', 'jeroen', null), /keep at least one owner/);
  assert.throws(() => change(users, 'jeroen', 'not a name', 'member'), /not a GitHub name/);
  assert.throws(() => change(users, 'jeroen', '-bad', 'member'), /not a GitHub name/);
});
