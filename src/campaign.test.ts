import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PlanBlocked, addVariant, loadCampaign, saveVariant } from './campaign.ts';
import { RevisionConflict, fileContentStore } from './content-store.ts';

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'campaign-'));
  mkdirSync(join(root, 'entities'));
  mkdirSync(join(root, 'posts', '2026-11-20-expo'), { recursive: true });
  writeFileSync(
    join(root, 'channels.yml'),
    'jeroen-linkedin:\n  platform: linkedin\n  kind: person\n  urn: urn:li:person:abc\n  avatar: avatars/jeroen-linkedin.jpg\nnourn-linkedin:\n  platform: linkedin\n  kind: person\ninsta:\n  platform: instagram\n'
  );
  writeFileSync(join(root, 'entities', 'pop-up-city.md'), '---\nname: Pop-Up City\nlinkedin: urn:li:organization:1\ninstagram: popupcity\n---\n');
  const folder = join(root, 'posts', '2026-11-20-expo');
  writeFileSync(join(folder, 'jeroen-linkedin.md'), '---\ndate: 2026-11-20T10:30\n---\nOpent [[Pop-Up City]].\n');
  writeFileSync(join(folder, 'insta.md'), '---\ndate: 2026-11-20T11:00\n---\nOpent [[Pop-Up City]].\n');
  writeFileSync(join(folder, 'nourn-linkedin.md'), '---\ndate: 2026-11-20T12:00\n---\nHallo\n');
  writeFileSync(join(folder, 'broken.md'), 'no frontmatter here');
  return root;
}

test('only a folder that exists directly under posts can be loaded', () => {
  const root = repo();
  for (const folder of ['..', '../posts', 'nope', '2026-11-20-expo/..', '']) assert.equal(loadCampaign(root, folder), null);
  assert.equal(loadCampaign(root, '2026-11-20-expo')?.title, 'Expo');
});

test('the first variant with a title in its frontmatter names the campaign', () => {
  const root = repo();
  writeFileSync(join(root, 'posts', '2026-11-20-expo', 'jeroen-linkedin.md'), '---\ntitle: "Expo: Stad van Morgen"\ndate: 2026-11-20T10:30\n---\nHallo\n');
  assert.equal(loadCampaign(root, '2026-11-20-expo')?.title, 'Expo: Stad van Morgen');
});

test('variants come back sorted, with the file, the preview and the problems per variant', () => {
  const campaign = loadCampaign(repo(), '2026-11-20-expo');
  assert.deepEqual(
    campaign?.variants.map((v) => v.base),
    ['insta', 'jeroen-linkedin', 'nourn-linkedin']
  );
  const [insta, linkedin, nourn] = campaign!.variants;
  assert.deepEqual(
    insta!.preview.segments.map((s) => s.kind),
    ['text', 'handle', 'text']
  );
  assert.equal(
    linkedin!.preview.segments.some((s) => s.kind === 'mention'),
    true
  );
  assert.equal(linkedin!.error, null);
  assert.equal(linkedin!.avatar, 'avatars/jeroen-linkedin.jpg');
  assert.equal(insta!.avatar, undefined);
  assert.deepEqual(nourn!.issues, ['this channel is not linked to a LinkedIn profile yet; use Connect on the Channels page']);
});

test('a file that cannot be parsed is still listed with its error', () => {
  const root = repo();
  writeFileSync(join(root, 'channels.yml'), 'broken:\n  platform: linkedin\n');
  writeFileSync(join(root, 'posts', '2026-11-20-expo', 'broken-x.md'), '---\ndate: nonsense\n---\nText\n');
  const variants = loadCampaign(root, '2026-11-20-expo')?.variants ?? [];
  const bad = variants.find((v) => v.base === 'broken-x');
  assert.match(bad?.error ?? '', /invalid date/);
  assert.equal(bad?.preview.length, 4);
  assert.match(variants.find((v) => v.base === 'broken')?.error ?? '', /no properties at the top/);
});

const FILE = '2026-11-20-expo';
const variantOf = (root: string, base: string) => loadCampaign(root, FILE)!.variants.find((v) => v.base === base)!;
const save = (root: string, base: string, raw: string, now = new Date('2026-11-18T09:00:00Z')) =>
  saveVariant(root, fileContentStore(root), FILE, base, { raw, revision: variantOf(root, base).revision }, now);

test('saving writes exactly the text it is given and returns the new revision and the problems', async () => {
  const root = repo();
  const before = variantOf(root, 'jeroen-linkedin');
  const raw = '---\n# keep\ndate: 2026-11-21T09:15\nmedia: [ a.jpg ]\n---\nNieuw met [[Onbekend]]';
  const after = await save(root, 'jeroen-linkedin', raw);
  assert.equal(readFileSync(join(root, 'posts', FILE, 'jeroen-linkedin.md'), 'utf8'), raw);
  assert.notEqual(after.revision, before.revision);
  assert.match(after.error ?? '', /unknown entity|image/);
});

test('saving with an old revision is refused and nothing is written', async () => {
  const root = repo();
  const store = fileContentStore(root);
  const before = variantOf(root, 'jeroen-linkedin');
  writeFileSync(join(root, 'posts', FILE, 'jeroen-linkedin.md'), '---\ndate: 2026-11-20T10:30\n---\nElsewhere\n');
  await assert.rejects(saveVariant(root, store, FILE, 'jeroen-linkedin', { raw: 'mine', revision: before.revision }), RevisionConflict);
  assert.equal(variantOf(root, 'jeroen-linkedin').fields.body, 'Elsewhere');
});

test('saving a post that does not exist, or a file that is too long, is an error', async () => {
  const root = repo();
  const store = fileContentStore(root);
  await assert.rejects(saveVariant(root, store, '..', 'jeroen-linkedin', { raw: 'x', revision: 'r' }), /post not found/);
  await assert.rejects(saveVariant(root, store, FILE, 'nope', { raw: 'x', revision: 'r' }), /post not found/);
  await assert.rejects(saveVariant(root, store, FILE, 'jeroen-linkedin', { raw: 'x'.repeat(200_001), revision: 'r' }), /too long/);
});

test('a file without frontmatter can still be saved as a draft', async () => {
  const root = repo();
  const saved = await save(root, 'jeroen-linkedin', 'just text');
  assert.match(saved.error ?? '', /no properties at the top/);
});

test('becoming planned is checked on the saved text, wherever the change was typed', async () => {
  const root = repo();
  const file = join(root, 'posts', FILE, 'nourn-linkedin.md');
  const before = readFileSync(file, 'utf8');
  await assert.rejects(
    save(root, 'nourn-linkedin', '---\nstatus: planned\ndate: 2026-11-20T12:00\n---\nHallo\n'),
    (err) => err instanceof PlanBlocked && err.problems.includes('this channel is not linked to a LinkedIn profile yet; use Connect on the Channels page')
  );
  await assert.rejects(
    save(root, 'jeroen-linkedin', '---\nstatus: planned\ndate: 2026-11-20T10:30\n---\nMet [[Onbekend]]\n'),
    (err) => err instanceof PlanBlocked && /unknown entity/.test(err.problems[0] ?? '')
  );
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('planning works for a valid post, but not for a date more than an hour in the past', async () => {
  const root = repo();
  const ok = await save(root, 'jeroen-linkedin', '---\nstatus: planned\ndate: 2026-11-20T10:30\n---\nOpent [[Pop-Up City]].\n');
  assert.equal(ok.post?.status, 'planned');
  const late = new Date('2026-11-18T08:30:00Z');
  await assert.rejects(
    save(root, 'jeroen-linkedin', '---\nstatus: draft\ndate: 2026-11-18T07:00\n---\nOpent [[Pop-Up City]].\n', late).then(() =>
      save(root, 'jeroen-linkedin', '---\nstatus: planned\ndate: 2026-11-18T07:00\n---\nOpent [[Pop-Up City]].\n', late)
    ),
    (err) => err instanceof PlanBlocked && /in the future/.test(err.problems.join())
  );
  await save(root, 'jeroen-linkedin', '---\nstatus: draft\ndate: 2026-11-18T07:00\nmanual: true\n---\nX\n', late);
  const manual = await save(root, 'jeroen-linkedin', '---\nstatus: planned\ndate: 2026-11-18T07:00\nmanual: true\n---\nX\n', late);
  assert.equal(manual.post?.manual, true);
});

test('saving an already planned post is not checked again: it stays planned even with a problem', async () => {
  const root = repo();
  await save(root, 'jeroen-linkedin', '---\nstatus: planned\ndate: 2026-11-20T10:30\n---\nOpent [[Pop-Up City]].\n');
  const saved = await save(root, 'jeroen-linkedin', '---\nstatus: planned\ndate: 2026-11-20T10:30\n---\nNu met [[Onbekend]]\n');
  assert.match(saved.error ?? '', /unknown entity/);
  assert.ok(saved.fields.ok && saved.fields.status === 'planned');
});

test('planning for a channel that is not connected makes the post a reminder', async () => {
  const root = repo();
  const file = join(root, 'posts', FILE, 'jeroen-linkedin.md');
  const raw = '---\nstatus: planned\ndate: 2026-11-20T10:30\n---\nOpent [[Pop-Up City]].\n';
  const input = { raw, revision: variantOf(root, 'jeroen-linkedin').revision };
  const now = new Date('2026-11-18T09:00:00Z');
  const saved = await saveVariant(root, fileContentStore(root), FILE, 'jeroen-linkedin', input, now, async () => 'no token');
  assert.equal(saved.post?.manual, true);
  assert.match(readFileSync(file, 'utf8'), /^manual: true$/m);
});

test('a new empty draft shows no problems, and the problems come back once it has text or is planned', async () => {
  const root = repo();
  writeFileSync(join(root, 'posts', FILE, 'jeroen-linkedin.md'), '---\ndate: 2026-11-20T10:30\n---\n\n');
  const empty = variantOf(root, 'jeroen-linkedin');
  assert.equal(empty.error, null);
  assert.deepEqual(empty.issues, []);
  await assert.rejects(
    save(root, 'jeroen-linkedin', '---\nstatus: planned\ndate: 2026-11-20T10:30\n---\n\n'),
    (err) => err instanceof PlanBlocked && /text is empty/.test(err.problems.join())
  );
});

test('a post cannot be planned when a comment is by an account that cannot post', async () => {
  const root = repo();
  await assert.rejects(
    save(root, 'jeroen-linkedin', '---\nstatus: planned\ndate: 2026-11-20T10:30\n---\nOpent.\n\n--- nourn-linkedin\n\nMooi.\n'),
    (err) => err instanceof PlanBlocked && /comment 1 cannot be posted as/.test(err.problems.join())
  );
});

test('a variant for another platform leaves the comment authors behind', async () => {
  const root = repo();
  await save(root, 'jeroen-linkedin', '---\ndate: 2026-11-20T10:30\n---\nPost.\n\n--- nourn-linkedin\n\nMooi.\n');
  const { rmSync } = await import('node:fs');
  rmSync(join(root, 'posts', FILE, 'insta.md'));
  const { addVariant } = await import('./campaign.ts');
  const made = await addVariant(root, fileContentStore(root), FILE, 'jeroen-linkedin', 'insta');
  const raw = readFileSync(join(root, 'posts', FILE, `${made}.md`), 'utf8');
  assert.match(raw, /\n---\n\nMooi\./);
  assert.doesNotMatch(raw, /nourn-linkedin/);
});

test('a status change remembers who made it, other saves keep the name, and a new variant starts without it', async () => {
  const root = repo();
  const folder = '2026-11-20-expo';
  const store = fileContentStore(root);
  const file = () => readFileSync(join(root, 'posts', folder, 'jeroen-linkedin.md'), 'utf8');
  const save = async (raw: string, by?: string) => saveVariant(root, store, folder, 'jeroen-linkedin', { raw, revision: (await store.read(`posts/${folder}/jeroen-linkedin.md`))!.revision, by }, new Date('2026-11-01T00:00:00Z'));
  const draft = file();
  const planned = draft.replace('---\nOpent', 'status: planned\n---\nOpent');

  await save(draft.replace('Opent', 'Sluit'), 'anna');
  assert.doesNotMatch(file(), /statusBy/);
  await save(planned, 'anna');
  assert.match(file(), /statusBy: anna/);
  await save(planned.replace('Opent', 'Sluit'), 'bob');
  assert.match(file(), /statusBy: anna/);
  await save(draft, 'bob');
  assert.match(file(), /statusBy: bob/);
  await save(planned, 'bob');
  rmSync(join(root, 'posts', folder, 'insta.md'));
  await addVariant(root, store, folder, 'jeroen-linkedin', 'insta');
  assert.doesNotMatch(readFileSync(join(root, 'posts', folder, 'insta.md'), 'utf8'), /status/);
  await save(draft);
  assert.doesNotMatch(file(), /statusBy/);
});
