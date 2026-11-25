export type Role = 'admin' | 'member';
export type Users = Record<string, string>;

const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export const nameIn = (users: Users, name: string): string | undefined => Object.keys(users).find((known) => known.toLowerCase() === name.toLowerCase());
export const roleOf = (users: Users, name: string): Role | null => {
  const known = nameIn(users, name);
  return known ? (users[known] as Role) : null;
};
export const hasAdmin = (users: Users): boolean => Object.values(users).includes('admin');

export function change(users: Users, actor: string, name: string, role: Role | null): Users {
  if (roleOf(users, actor) !== 'admin') throw new Error('only an admin can change users');
  if (!NAME.test(name)) throw new Error('that is not a GitHub name');
  const known = nameIn(users, name) ?? name;
  if (users[known] === 'admin' && role !== 'admin' && Object.values(users).filter((each) => each === 'admin').length === 1) throw new Error('keep at least one admin');
  const next = { ...users };
  if (role === null) delete next[known];
  else next[known] = role;
  return next;
}
