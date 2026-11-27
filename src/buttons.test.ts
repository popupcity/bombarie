import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : name.endsWith('.astro') ? [join(dir, name)] : []));
const buttons = files('app').flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/<(Button|ValueButton)\b((?:[^>{]|\{[^}]*\})*)>([\s\S]*?)<\/\1>/g)].map((match) => ({ file, attrs: match[2]!, inner: match[3]! })));

const label = (inner: string): string => inner.replace(/<Icon\b[^>]*\/>/g, '').replace(/<\/?span\b(?:[^>{]|\{[^}]*\})*>/g, '').replace(/\s+/g, ' ').trim();

const ADDS = '<Icon name="plus" weight="bold" />';

test('a button with a label starts with no icon but the plus of one that adds: other icons go after it (an arrow out, a caret) or the button is icon only', () => {
  const bad = buttons.filter(({ inner }) => label(inner) !== '' && inner.trimStart().startsWith('<Icon') && !inner.trimStart().startsWith(ADDS)).map(({ file, inner }) => `${file}: ${label(inner).slice(0, 40)}`);
  assert.deepEqual(bad, []);
});

test('an icon-only button always says what it does', () => {
  const bad = buttons.filter(({ inner }) => label(inner) === '' && inner.includes('<Icon')).filter(({ attrs }) => !/aria-label=/.test(attrs)).map(({ file }) => file);
  assert.deepEqual(bad, []);
});

test('the trailing icon of a labelled button is an arrow out or a caret', () => {
  const bad = buttons
    .filter(({ inner }) => label(inner) !== '')
    .flatMap(({ file, inner }) => [...inner.trimStart().replace(ADDS, '').matchAll(/<Icon name="([^"]+)"/g)].map((icon) => `${file}: ${icon[1]}`))
    .filter((entry) => !/: (arrow-square-out|caret-down|caret-right)$/.test(entry));
  assert.deepEqual(bad, []);
});

test('a separator is the Phosphor dot, never a typed character', () => {
  const all = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? all(join(dir, name)) : /\.(astro|ts)$/.test(name) ? [join(dir, name)] : []));
  const typed = [...all('app'), ...all('src').filter((file) => !file.endsWith('.test.ts'))].filter((file) => /\u00b7|&middot;| \u2022 |\u2219|\u22c5/.test(readFileSync(file, 'utf8')));
  assert.deepEqual(typed, []);
});

test('a drawing gets the tooltip of the app, not the bare one of the browser', () => {
  const all = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? all(join(dir, name)) : /\.(astro|ts)$/.test(name) ? [join(dir, name)] : []));
  const bare = all('app').filter((file) => /<svg[\s\S]*?<title>[\s\S]*?<\/svg>/.test(readFileSync(file, 'utf8')));
  assert.deepEqual(bare, []);
});
