import { issue, who } from '../../src/auth.ts';
import { appsPath, readApp, readUsers, secretOf } from '../../src/secrets.ts';
import { hasAdmin } from '../../src/users.ts';

export const COOKIE = 'bombarie_session';
export const STATE_COOKIE = 'bombarie_oauth';
export const OPEN = ['/login', '/login/', '/setup', '/public/', '/healthz', '/api/telegram'];

const STARTED = Date.now();
export const setupOpen = (): boolean => Date.now() - STARTED < 15 * 60_000;

export const githubApp = () => readApp(appsPath(), 'github');
export const users = () => readUsers(appsPath());
export const installed = async (): Promise<boolean> => (await githubApp()) !== null && hasAdmin(await users());
export const required = async (): Promise<boolean> => import.meta.env.PROD || (await installed());

export const sessionToken = (name: string, now = new Date()): string => issue(secretOf(appsPath()), name, now);
export const signedInAs = (cookie: string | undefined, now = new Date()): string | null => who(secretOf(appsPath()), cookie, now);
