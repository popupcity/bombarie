import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Post, RepliesDone } from './types.ts';

export type State =
  | { status: 'posting'; at: string; remoteId?: string; by?: string }
  | { status: 'posted'; at: string; remoteId: string; url?: string; by?: string; replies?: RepliesDone }
  | { status: 'failed'; at: string; message: string }
  | { status: 'unconfirmed'; at: string; message: string; remoteId?: string }
  | { status: 'reminded'; at: string }
  | { status: 'deleted'; at: string; remoteId: string; url?: string };

export interface StateStore {
  get(id: string): Promise<State | null>;
  create(id: string, state: State): Promise<boolean>;
  replace(id: string, state: State): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface Attention {
  id: string;
  status: State['status'];
  message: string;
}

const STALE_AFTER_MS = 10 * 60_000;

export function claim(store: StateStore, id: string, now: Date, by?: string): Promise<boolean> {
  return store.create(id, { status: 'posting', at: now.toISOString(), ...(by && { by }) });
}

async function current(store: StateStore, id: string) {
  const state = await store.get(id);
  if (state?.status !== 'posting') {
    throw new Error(`${id}: expected posting, found ${state?.status ?? 'no state'}`);
  }
  return state;
}

export async function checkpoint(store: StateStore, id: string, remoteId: string): Promise<void> {
  await store.replace(id, { ...(await current(store, id)), remoteId });
}

export async function complete(store: StateStore, id: string, remoteId: string, url: string | undefined, now: Date, replies?: RepliesDone): Promise<void> {
  const { by } = await current(store, id);
  await store.replace(id, {
    status: 'posted',
    at: now.toISOString(),
    remoteId,
    ...(url !== undefined && { url }),
    ...(by && { by }),
    ...(replies && { replies })
  });
}

export async function fail(store: StateStore, id: string, message: string, now: Date, unconfirmed = false): Promise<void> {
  const { remoteId } = await current(store, id);
  const at = now.toISOString();
  await store.replace(
    id,
    unconfirmed ? { status: 'unconfirmed', at, message, ...(remoteId !== undefined && { remoteId }) } : { status: 'failed', at, message }
  );
}

export async function rearm(store: StateStore, id: string, date: Date): Promise<boolean> {
  const state = await store.get(id);
  if (state?.status !== 'reminded' || date.getTime() <= Date.parse(state.at)) return false;
  await store.remove(id);
  return true;
}

export async function unstarted(store: Pick<StateStore, 'get'>, posts: Post[]): Promise<Post[]> {
  const states = await Promise.all(posts.map((p) => store.get(p.id)));
  return posts.filter((_, i) => states[i] === null);
}

export async function attention(store: Pick<StateStore, 'get'>, ids: string[], now: Date): Promise<Attention[]> {
  const found: Attention[] = [];
  for (const id of ids) {
    const state = await store.get(id);
    if (!state) continue;
    const remote = 'remoteId' in state && state.remoteId ? ` (remote id ${state.remoteId})` : '';
    if (state.status === 'failed') {
      found.push({ id, status: state.status, message: state.message });
    } else if (state.status === 'unconfirmed') {
      found.push({
        id,
        status: state.status,
        message: `${state.message}${remote}; check the platform before retrying`
      });
    } else if (state.status === 'posting' && now.getTime() - Date.parse(state.at) > STALE_AFTER_MS) {
      found.push({ id, status: state.status, message: `stuck since ${state.at}${remote}` });
    }
  }
  return found;
}

function hasCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === code;
}

export function fileStore(root: string): StateStore {
  function path(id: string): string {
    const [folder, file, ...rest] = id.split('/');
    if (!folder || !file || rest.length > 0 || folder.startsWith('.') || file.startsWith('.') || !file.endsWith('.md')) throw new Error(`invalid id "${id}"`);
    return join(root, 'posts', folder, `${file.slice(0, -3)}.state.json`);
  }
  const json = (state: State) => `${JSON.stringify(state, null, 2)}\n`;

  return {
    async get(id) {
      try {
        return JSON.parse(await readFile(path(id), 'utf8')) as State;
      } catch (err) {
        if (hasCode(err, 'ENOENT')) return null;
        throw err;
      }
    },
    async create(id, state) {
      const file = path(id);
      await mkdir(dirname(file), { recursive: true });
      try {
        await writeFile(file, json(state), { flag: 'wx' });
        return true;
      } catch (err) {
        if (hasCode(err, 'EEXIST')) return false;
        throw err;
      }
    },
    async replace(id, state) {
      const file = path(id);
      const temp = `${file}.tmp`;
      await writeFile(temp, json(state));
      await rename(temp, file);
    },
    async remove(id) {
      await rm(path(id), { force: true });
    }
  };
}
