import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { needsCover } from '../../src/types.ts';

export type Size = { width?: number; height?: number };

export const photoSizes = async (names: string[], ...folder: string[]): Promise<Record<string, Size>> =>
  Object.fromEntries(await Promise.all(names.map(async (name) => [name, await photoSize(...folder, name)] as const)));

const known = new Map<string, Promise<Size>>();

async function photoSize(...parts: string[]): Promise<Size> {
  const file = join(...parts);
  const path = needsCover(file) ? `${file}.cover.jpg` : file;
  try {
    const key = `${path}:${(await stat(path)).mtimeMs}`;
    let found = known.get(key);
    if (!found) {
      found = sharp(path)
        .metadata()
        .then(({ width, height, orientation }): Size => (!width || !height ? {} : (orientation ?? 1) >= 5 ? { width: height, height: width } : { width, height }))
        .catch((): Size => ({}));
      known.set(key, found);
    }
    return await found;
  } catch {
    return {};
  }
}
