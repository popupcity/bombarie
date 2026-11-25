export type Role = 'owner' | 'admin' | 'member';
export type Users = Record<string, string>;

const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export const nameIn = (users: Users, name: string): string | undefined => Object.keys(users).find((known) => known.toLowerCase() === name.toLowerCase());
export const roleOf = (users: Users, name: string): Role | null => {
  const known = nameIn(users, name);
  return known ? (users[known] as Role) : null;
};
export const hasOwner = (users: Users): boolean => Object.values(users).includes('owner');

export function change(users: Users, actor: string, name: string, role: Role | null): Users {
  const by = roleOf(users, actor);
  if (by !== 'owner' && by !== 'admin') throw new Error('only an owner or an admin can change users');
  if (!NAME.test(name)) throw new Error('that is not a GitHub name');
  const known = nameIn(users, name) ?? name;
  const current = users[known];
  if ((current === 'owner' || role === 'owner') && by !== 'owner') throw new Error('only an owner can change an owner');
  if (current === 'owner' && role !== 'owner' && Object.values(users).filter((each) => each === 'owner').length === 1) throw new Error('keep at least one owner');
  const next = { ...users };
  if (role === null) delete next[known];
  else next[known] = role;
  return next;
}
