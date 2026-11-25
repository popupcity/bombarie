import { issue, signingSecret, who } from '../../src/auth.ts';
import { adminsOf } from '../../src/github-login.ts';

export const COOKIE = 'bombarie_session';
export const STATE_COOKIE = 'bombarie_oauth';
export const OPEN = ['/login', '/login/', '/public/', '/healthz', '/api/telegram'];

export const github = () => ({ clientId: process.env.GITHUB_CLIENT_ID ?? '', clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '', admins: adminsOf(process.env.BOMBARIE_ADMINS) });
export const configured = (): boolean => {
  const { clientId, clientSecret, admins } = github();
  return clientId !== '' && clientSecret !== '' && admins.length > 0;
};
export const required = (): boolean => import.meta.env.PROD || configured();
export const sessionToken = (name: string, now = new Date()): string => issue(signingSecret(), name, now);
export const signedInAs = (cookie: string | undefined, now = new Date()): string | null => who(signingSecret(), cookie, now);
