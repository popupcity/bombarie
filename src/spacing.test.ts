import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

test('text sizes come from the scale: 10, 12, 14, 16, 18, 20, 24 and 32 px, and 8 px for initials in a 16 px avatar', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : /\.(astro|ts)$/.test(name) ? [join(dir, name)] : []));
  const found = walk('app')
    .filter((file) => !file.endsWith('PlatformPreview.astro'))
    .flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/(?<![\w-])text-(?:[3-9]xl|\[[0-9.]+(?:px|rem|em|%)\])(?![\w-])/g)].map((match) => `${file} ${match[0]}`));
  assert.deepEqual(found, ['app/components/PostChip.astro text-[8px]']);
});

test('the root font size is the browser default, so every text size is a whole step of the scale', () => {
  assert.doesNotMatch(readFileSync('app/lib/ui.ts', 'utf8').match(/export const HTML_CLASS = .*/)![0], /(?<![\w-])text-(?:\[|xs|sm|base|lg|xl)/);
  assert.doesNotMatch(readFileSync('app/styles/global.css', 'utf8'), /(?:html|:root)\s*\{[^}]*font-size/);
});

const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : /\.(astro|ts)$/.test(name) ? [join(dir, name)] : []));
const sources = files('app').map((file) => ({ file, lines: readFileSync(file, 'utf8').split('\n') }));

const TOKEN = (pattern: string): RegExp => new RegExp(`(?<![\\w-])(?:[a-z@][a-z0-9/-]*:)*${pattern}(?![\\w-])`, 'g');
const HALF = TOKEN('(?:gap(?:-[xy])?|[pm][xytblr]?|size|h|w|top|left|right|bottom|inset(?:-[xy])?)-\\d+\\.5');
const HAIRLINE = new Set(['h-0.5', 'w-0.5']);
const SPACE = TOKEN('space-[xy]-\\S+');
const MARGIN = TOKEN('m[xytblr]?-[1-9]\\d*');
const GAP = TOKEN('gap(?:-[xy])?-(\\d+)');
const GAPS = new Set(['0', '1', '2', '3', '4', '8', '12']);

const MARGINS = new Set([
  'components/ChoiceMenu.astro',
  'components/DeleteDialog.astro',
  'components/CardActions.astro',
  'components/AgendaCard.astro',
  'components/AccountMenu.astro',
  'components/NewPostMenu.astro',
  'pages/ideas.astro'
]);

function hits(pattern: RegExp, skip: (file: string, line: string) => boolean = () => false): string[] {
  return sources.flatMap(({ file, lines }) =>
    lines.flatMap((line, index) => (skip(file, line) ? [] : [...line.matchAll(pattern)].map((match) => `${file}:${index + 1} ${match[0]}`)))
  );
}

test('no half steps in spacing or sizes, except the 2 px hairline bars', () => {
  assert.deepEqual(hits(HALF).filter((hit) => !HAIRLINE.has(hit.split(' ').pop()!.replace(/^.*:/, ''))), []);
});

test('the parent owns the space: no space-y or space-x', () => {
  assert.deepEqual(hits(SPACE), []);
});

test('no positive margins, except an icon nudge or a separator in a menu (listed here with the file)', () => {
  assert.deepEqual(
    hits(MARGIN, (file) => MARGINS.has(file.replace(/^app\//, ''))),
    []
  );
});

test('gaps come from one set: 4, 8, 12 (inside a control or a chip) and 16, 32, 48 (rhythm)', () => {
  const bad = sources.flatMap(({ file, lines }) =>
    lines.flatMap((line, index) => [...line.matchAll(GAP)].filter((match) => !GAPS.has(match[1]!)).map((match) => `${file}:${index + 1} ${match[0]}`))
  );
  assert.deepEqual(bad, []);
});

test('the spacing scale is in pixels, so every gap, padding and size sits on the 4px grid', () => {
  const css = readFileSync('app/styles/global.css', 'utf8');
  assert.match(css, /--spacing:\s*4px;/);
});

test('line heights come from the 4px scale: no ratio utilities such as leading-relaxed', () => {
  const sources = [...files('app'), ...files('packages/ui/src')].filter((path) => /\.(astro|ts)$/.test(path));
  const offenders = sources.filter((path) => /\bleading-(relaxed|snug|normal|tight|none|loose)\b/.test(readFileSync(path, 'utf8')));
  assert.deepEqual(offenders, []);
});

test('corners come from three sizes: no bare rounded, no rem radii', () => {
  const sources = [...files('app'), ...files('packages/ui/src')].filter((path) => /\.(astro|ts)$/.test(path));
  const offenders = sources.filter((path) => /\brounded(?![-\w])/.test(readFileSync(path, 'utf8')));
  assert.deepEqual(offenders, []);
  assert.match(readFileSync('app/styles/global.css', 'utf8'), /--radius-sm:\s*4px;[\s\S]*--radius-lg:\s*8px;[\s\S]*--radius-xl:\s*12px;/);
});
