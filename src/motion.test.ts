import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : /\.(astro|ts)$/.test(name) ? [join(dir, name)] : []));

test('one motion: no own duration, and no easing besides ease-pop for arriving and ease-leave for leaving', () => {
  const own = [...files('app'), ...files('packages/ui/src')].flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) => [...line.matchAll(/(?<![\w-])(?:duration-(?:\d+|\(|\[)|ease-(?!pop\b|leave\b)(?:\(|\[|in|out|linear))[\w)\]-]*/g)].map((match) => `${file}:${index + 1} ${match[0]}`))
  );
  assert.deepEqual(own, []);
});
