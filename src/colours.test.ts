import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : /\.(astro|ts)$/.test(name) ? [join(dir, name)] : []));
const sources = files('app').map((file) => ({ file: file.replace(/^app\//, ''), lines: readFileSync(file, 'utf8').split('\n') }));

const MOCKS = new Set(['components/PlatformPreview.astro', 'scripts/lightbox.ts']);
const UTILITY = '(?:bg|text|ring|border|outline|fill|stroke|from|via|to|decoration|divide|shadow|accent|caret)';
const OPACITY = new RegExp(`(?<![\\w-])(?:[a-z@][a-z0-9/-]*:)*${UTILITY}-(?:[a-z][a-z-]*|\\([^)]+\\)|\\[[^\\]]+\\])/(?:\\d+|\\[[\\d.]+\\])(?![\\w-])`, 'g');
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/g;
const REMOVED = /(?<![\w-])(?:[a-z@][a-z0-9/-]*:)*(?:bg|ring|border|text)-(?:avatar|field)(?![\w-])/g;
const ALLOWED = new Set(['ring-(--tone-text)/40']);

const hits = (pattern: RegExp, skip: (file: string) => boolean = () => false): string[] =>
  sources.flatMap(({ file, lines }) => (skip(file) ? [] : lines.flatMap((line, index) => [...line.matchAll(pattern)].map((match) => `${file}:${index + 1} ${match[0]}`))));

test('colours come from the named set: no opacity on a colour class, except the tone ring and the platform mocks', () => {
  assert.deepEqual(
    hits(OPACITY, (file) => MOCKS.has(file)).filter((hit) => !ALLOWED.has(hit.split(' ').pop()!.replace(/^(?:[a-z@][a-z0-9/-]*:)+/, ''))),
    []
  );
});

test('no colour literal in a component or a script', () => {
  assert.deepEqual(hits(LITERAL, (file) => MOCKS.has(file) || file === 'components/AppHead.astro'), []);
});

test('the retired grey names are gone', () => {
  assert.deepEqual(hits(REMOVED), []);
});

test('element opacity is 0, 100 or one of the two named values, never a loose grey', () => {
  const all = [...files('app'), ...files('packages/ui/src')];
  const found = all.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) => [...line.matchAll(/(?<![\w-])(?:[a-z@][a-z0-9/-]*:)*opacity-(?!0\b|100\b|\(--dim\)|\(--hover-opacity\))[^\s"'`]+/g)].map((match) => `${file}:${index + 1} ${match[0]}`))
  );
  assert.deepEqual(found, []);
});
