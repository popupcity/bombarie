import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : name.endsWith('.astro') ? [join(dir, name)] : []));

const CONTROL = /<(?:ChannelChip|Button|TrashButton|ChoiceMenu|ValueButton|Input)\b|\{CHIP\}|\$\{CHIP\}|<slot name="actions"/g;
const depth = (line: string): number => line.length - line.trimStart().length;

function rows(file: string): { where: string; classes: string; gaps: string[] }[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  return lines.flatMap((line, index) => {
    const classes = /<(?:div|form|nav|span|Card)\b.*?class(?::list)?=["'{]([^>]*)/.exec(line)?.[1] ?? '';
    if (!/(?<![\w-])(?:inline-)?flex(?![\w-])/.test(classes) || classes.includes('flex-col')) return [];
    const inside: string[] = [];
    for (const next of lines.slice(index + 1)) {
      if (next.trim() !== '' && depth(next) <= depth(line)) break;
      inside.push(next);
    }
    const body = line.includes('<slot name="identity"') ? line : inside.join('\n');
    const oneStandsForMore = body.includes('CHIP}') || body.includes('<ChannelChip') || line.includes('<slot name="identity"');
    if (!line.includes('<slot name="identity"') && (body.match(CONTROL) ?? []).length < (oneStandsForMore ? 1 : 2)) return [];
    return [{ where: `${file}:${index + 1}`, classes, gaps: [...classes.matchAll(/(?<![\w-])(?:[a-z]+:)?gap(?:-[xy])?-\d+/g)].map((match) => match[0]) }];
  });
}

const BLOCKS = [/has-\[#conflict/, /^flex items-center gap-4"$/];

test('buttons, fields and chips that stand side by side are 12 px apart', () => {
  const found = files('app').flatMap(rows);
  assert.ok(found.length > 8, 'the scan should find the rows of buttons');
  assert.deepEqual(
    found.filter((row) => !BLOCKS.some((block) => block.test(row.classes)) && !(row.gaps.length === 1 && row.gaps[0] === 'gap-3')).map((row) => `${row.where} ${row.gaps.join(' ') || 'no gap'}`),
    []
  );
});
