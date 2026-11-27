import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

test('the web app manifest opens without a browser bar and every icon it names exists', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as { name: string; display: string; start_url: string; icons: { src: string }[] };
  assert.equal(manifest.name, 'Bombarie');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  for (const icon of [...manifest.icons.map((entry) => entry.src), '/apple-touch-icon.png', '/favicon.svg']) assert.ok(existsSync(`public${icon}`), icon);
});

test('every page of its own has the same head, with the manifest and the touch icon', () => {
  const head = readFileSync('app/components/AppHead.astro', 'utf8');
  assert.match(head, /rel="manifest"/);
  assert.match(head, /rel="apple-touch-icon"/);
  for (const file of ['app/layouts/Shell.astro', 'app/pages/login.astro', 'app/pages/setup.astro', 'app/pages/ideas/add.astro']) assert.match(readFileSync(file, 'utf8'), /<AppHead \/>/);
});
