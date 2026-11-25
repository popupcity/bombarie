import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

test('every page with a save action uses the one action panel', () => {
  const offenders = files('app/pages')
    .filter((path) => path.endsWith('.astro'))
    .filter((path) => {
      const text = readFileSync(path, 'utf8');
      return /type="submit"[^>]*form="/.test(text) && !/<ActionPanel|<ChannelForm/.test(text);
    });
  assert.deepEqual(offenders, []);
});

test('pages never draw their own delete trash button, the action panel does', () => {
  const offenders = files('app/pages')
    .filter((path) => path.endsWith('.astro'))
    .filter((path) => /tone="bad"[^>]*icon[^>]*>\s*<Icon name="trash"/.test(readFileSync(path, 'utf8')));
  assert.deepEqual(offenders, []);
});
