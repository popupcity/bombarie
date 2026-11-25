import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export class RevisionConflict extends Error {}

export interface ContentStore {
  read(path: string): Promise<{ text: string; revision: string } | null>;
  write(path: string, text: string, expected: string): Promise<{ revision: string }>;
  create(path: string, text: string): Promise<{ revision: string }>;
  remove(path: string): Promise<void>;
  removeFolder(path: string): Promise<void>;
  renameFolder(from: string, to: string): Promise<void>;
  list(dir: string): Promise<string[]>;
  readFile(path: string): Promise<Uint8Array | null>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  removeFile(path: string): Promise<void>;
  renameFile(from: string, to: string): Promise<void>;
}

export const revisionOf = (text: string): string => createHash('sha1').update(text).digest('hex');

const POST_PATH = /^(posts|ideas)\/[^/]+\/[^/]+\.md$/;
const IMAGE_PATH = /^(posts|ideas)\/[^/]+\/[^/]+\.(jpe?g|png|gif|webp|pdf|mp4)$/i;
const FOLDER_PATH = /^(posts|ideas)\/[^/]+$/;

export function fileContentStore(root: string): ContentStore {
  const resolve = (path: string, pattern = POST_PATH): string => {
    if (!pattern.test(path) || path.includes('..')) throw new Error(`not a content path: ${path}`);
    return join(root, path);
  };
  return {
    async read(path) {
      const file = resolve(path);
      if (!existsSync(file)) return null;
      const text = readFileSync(file, 'utf8');
      return { text, revision: revisionOf(text) };
    },
    async create(path, text) {
      const file = resolve(path);
      if (existsSync(file)) throw new Error(`${path} already exists`);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, text, { flag: 'wx' });
      return { revision: revisionOf(text) };
    },
    async remove(path) {
      await rm(resolve(path), { force: true });
    },
    async removeFolder(path) {
      await rm(resolve(path, FOLDER_PATH), { recursive: true, force: true });
    },
    async renameFolder(from, to) {
      const target = resolve(to, FOLDER_PATH);
      if (existsSync(target)) throw new Error(`${to} already exists`);
      await rename(resolve(from, FOLDER_PATH), target);
    },
    async list(dir) {
      const folder = resolve(dir, FOLDER_PATH);
      return existsSync(folder) ? readdirSync(folder) : [];
    },
    async readFile(path) {
      const file = resolve(path, IMAGE_PATH);
      return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
    },
    async writeFile(path, bytes) {
      const file = resolve(path, IMAGE_PATH);
      const temp = `${file}.tmp`;
      await writeFile(temp, bytes);
      await rename(temp, file);
    },
    async renameFile(from, to) {
      const target = resolve(to, IMAGE_PATH);
      if (existsSync(target)) throw new Error(`${to} already exists`);
      await rename(resolve(from, IMAGE_PATH), target);
    },
    async removeFile(path) {
      await rm(resolve(path, IMAGE_PATH), { force: true });
    },
    async write(path, text, expected) {
      const file = resolve(path);
      const current = existsSync(file) ? revisionOf(readFileSync(file, 'utf8')) : null;
      if (current !== expected) throw new RevisionConflict(`${path} changed since it was opened`);
      const temp = `${file}.tmp`;
      await writeFile(temp, text);
      await rename(temp, file);
      return { revision: revisionOf(text) };
    }
  };
}
