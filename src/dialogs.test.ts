import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

test('text in a dialog is always small', () => {
  const offenders = readdirSync('app/components')
    .filter((name) => name.endsWith('Dialog.astro'))
    .map((name) => join('app/components', name))
    .filter((path) => /<Text\b[^>]*variant="(?!small")/.test(readFileSync(path, 'utf8')));
  assert.deepEqual(offenders, []);
});
