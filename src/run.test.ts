import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { attention, fileStore } from './state.ts';
import { linkedin } from './linkedin.ts';
import { run, runNow } from './run.ts';
import type { RunDeps } from './run.ts';
import type { StateStore } from './state.ts';
import { ProviderError } from './types.ts';
import type { Channel, Credentials, Post, Provider } from './types.ts';

const now = new Date('2026-11-20T09:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

function post(id: string, over: Partial<Post> = {}): Post {
  return {
    id,
    channel: 'acct',
    type: null,
    status: 'planned',
    manual: false,
    date: minutesAgo(5),
    images: [],
    mentions: {},
    text: 'x',
    ...over
  };
}

function fake(
  behaviour: (post: Post, n: number) => Promise<{ id: string; url?: string }> | { id: string; url?: string },
  issues: string[] = []
) {
  let calls = 0;
  const provider: Provider = {
    platform: 'linkedin',
    validate: () => issues,
    send: async (p, _a, _c, context) => {
      calls += 1;
      const result = await behaviour(p, calls);
      await context.checkpoint(result.id);
      return result;
    }
  };
  return { provider, calls: () => calls };
}

function deps(provider: Provider, over: Partial<RunDeps> = {}): RunDeps & { store: StateStore } {
  const store = fileStore(mkdtempSync(join(tmpdir(), 'social-run-')));
  const channel: Channel = { platform: 'linkedin', kind: 'person', urn: 'urn:li:person:1' };
  return {
    store,
    channels: { acct: channel },
    providers: { linkedin: provider },
    credentials: async () => ({ accessToken: 't' }) as Credentials,
    context: () => ({
      fetch,
      publicImage: async (p) => p,
      publicVideo: async (path) => `https://x.test/public/${path}`,
      readMedia: async () => new Uint8Array()
    }),
    now,
    ...over
  };
}

const statuses = (outcomes: { id: string; status: string }[]) => outcomes.map((o) => [o.id, o.status]);

test('a due post is posted once and then left alone', async () => {
  const { provider, calls } = fake(() => ({ id: 'rid', url: 'https://x/1' }));
  const d = deps(provider);
  const posts = [post('f/a.md')];

  assert.deepEqual(statuses(await run(posts, d)), [['f/a.md', 'posted']]);
  assert.deepEqual(await d.store.get('f/a.md'), {
    status: 'posted',
    at: now.toISOString(),
    remoteId: 'rid',
    url: 'https://x/1'
  });
  assert.deepEqual(await run(posts, d), []);
  assert.equal(calls(), 1);
});

test('drafts, manual, future and late posts are not run', async () => {
  const { provider, calls } = fake(() => ({ id: 'rid' }));
  const outcomes = await run(
    [
      post('f/draft.md', { status: 'draft' }),
      post('f/manual.md', { manual: true }),
      post('f/future.md', { date: new Date(now.getTime() + 60_000) }),
      post('f/late.md', { date: minutesAgo(120) })
    ],
    deps(provider)
  );
  assert.deepEqual(outcomes, []);
  assert.equal(calls(), 0);
});

test('a post that does not validate is reported and left without state', async () => {
  const { provider, calls } = fake(() => ({ id: 'rid' }), ['text is over 3000 characters']);
  const d = deps(provider);
  const outcomes = await run([post('f/a.md')], d);
  assert.deepEqual(outcomes, [{ id: 'f/a.md', status: 'invalid', message: 'text is over 3000 characters' }]);
  assert.equal(await d.store.get('f/a.md'), null);
  assert.equal(calls(), 0);
});

test('missing credentials or provider skip without state', async () => {
  const { provider } = fake(() => ({ id: 'rid' }));
  const noCreds = deps(provider, { credentials: async () => null });
  assert.deepEqual(statuses(await run([post('f/a.md')], noCreds)), [['f/a.md', 'skipped']]);
  assert.equal(await noCreds.store.get('f/a.md'), null);

  const noProvider = deps(provider, { providers: {} });
  const [outcome] = await run([post('f/a.md')], noProvider);
  assert.equal(outcome?.status, 'skipped');
  assert.match(outcome?.message ?? '', /no provider/);
});

test('dry run validates but claims nothing and needs no credentials', async () => {
  const { provider, calls } = fake(() => ({ id: 'rid' }));
  const d = deps(provider, { dryRun: true, credentials: async () => null });
  assert.deepEqual(statuses(await run([post('f/a.md')], d)), [['f/a.md', 'would-post']]);
  assert.equal(await d.store.get('f/a.md'), null);
  assert.equal(calls(), 0);
});

test('a transient error releases the post so the next run retries it', async () => {
  const { provider, calls } = fake((_p, n) => {
    if (n === 1) throw new ProviderError('503 before posting', 'transient');
    return { id: 'rid' };
  });
  const d = deps(provider);
  const posts = [post('f/a.md')];

  assert.deepEqual(statuses(await run(posts, d)), [['f/a.md', 'retry']]);
  assert.equal(await d.store.get('f/a.md'), null);
  assert.deepEqual(statuses(await run(posts, d)), [['f/a.md', 'posted']]);
  assert.equal(calls(), 2);
});

test('auth and rate errors are retried too', async () => {
  for (const code of ['auth', 'rate'] as const) {
    const { provider } = fake(() => {
      throw new ProviderError(code, code);
    });
    const d = deps(provider);
    assert.deepEqual(statuses(await run([post('f/a.md')], d)), [['f/a.md', 'retry']]);
    assert.equal(await d.store.get('f/a.md'), null);
  }
});

test('an invalid error is recorded as failed, reported, and never retried', async () => {
  const { provider, calls } = fake(() => {
    throw new ProviderError('400 bad image', 'invalid');
  });
  const d = deps(provider);
  const posts = [post('f/a.md')];

  assert.deepEqual(statuses(await run(posts, d)), [['f/a.md', 'failed']]);
  assert.equal((await d.store.get('f/a.md'))?.status, 'failed');
  assert.deepEqual(await run(posts, d), []);
  assert.equal(calls(), 1);
  assert.deepEqual(
    (await attention(d.store, ['f/a.md'], now)).map((a) => a.status),
    ['failed']
  );
});

test('unconfirmed and unexpected errors block retries', async () => {
  const unconfirmed = fake(() => {
    throw new ProviderError('timeout after sending', 'unconfirmed');
  });
  const a = deps(unconfirmed.provider);
  assert.deepEqual(statuses(await run([post('f/a.md')], a)), [['f/a.md', 'unconfirmed']]);

  const unexpected = fake(() => {
    throw new TypeError('bug');
  });
  const b = deps(unexpected.provider);
  assert.deepEqual(statuses(await run([post('f/a.md')], b)), [['f/a.md', 'unconfirmed']]);
  assert.deepEqual(await run([post('f/a.md')], b), []);
});

test('one failing post does not stop the next', async () => {
  const { provider } = fake((p) => {
    if (p.id === 'f/a.md') throw new ProviderError('nope', 'invalid');
    return { id: 'rid' };
  });
  const outcomes = await run([post('f/a.md'), post('f/b.md')], deps(provider));
  assert.deepEqual(statuses(outcomes), [
    ['f/a.md', 'failed'],
    ['f/b.md', 'posted']
  ]);
});

test('if saving the posted state fails, the post stays posting with its remote id', async () => {
  const { provider } = fake(() => ({ id: 'rid' }));
  const d = deps(provider);
  const inner = d.store;
  d.store = {
    ...inner,
    replace: async (id, state) => {
      if (state.status === 'posted') throw new Error('disk full');
      await inner.replace(id, state);
    }
  };
  const [outcome] = await run([post('f/a.md')], d);
  assert.equal(outcome?.status, 'unconfirmed');
  assert.match(outcome?.message ?? '', /posted as rid but saving the state failed: disk full/);
  assert.deepEqual(await inner.get('f/a.md'), { status: 'posting', at: now.toISOString(), remoteId: 'rid' });
});

test('an unreadable store is reported as an error and the run continues', async () => {
  const { provider } = fake(() => ({ id: 'rid' }));
  const d = deps(provider);
  const inner = d.store;
  d.store = {
    ...inner,
    create: async (id, state) => {
      if (id === 'f/a.md') throw new Error('store down');
      return inner.create(id, state);
    }
  };
  const outcomes = await run([post('f/a.md'), post('f/b.md')], d);
  assert.deepEqual(statuses(outcomes), [
    ['f/a.md', 'error'],
    ['f/b.md', 'posted']
  ]);
});

test('the real LinkedIn provider runs end to end against a fake server', async () => {
  const requests: string[] = [];
  const d = deps(linkedin, {
    channels: { acct: { platform: 'linkedin', kind: 'organization', urn: 'urn:li:organization:716321' } },
    context: () => ({
      fetch: (async (url: string) => {
        requests.push(url);
        return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:99' } });
      }) as unknown as typeof fetch,
      publicImage: async (p) => p,
      publicVideo: async (p) => p,
      readMedia: async () => new Uint8Array()
    })
  });
  const outcomes = await run([post('f/a.md', { text: 'Hallo' })], d);
  assert.deepEqual(requests, ['https://api.linkedin.com/rest/posts']);
  assert.equal(outcomes[0]?.status, 'posted');
  assert.deepEqual(await d.store.get('f/a.md'), {
    status: 'posted',
    at: now.toISOString(),
    remoteId: 'urn:li:share:99',
    url: 'https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A99/'
  });
});

test('runNow posts a draft or future post once, without touching drafts of others', async () => {
  const { provider, calls } = fake(() => ({ id: 'rid', url: 'https://x/2' }));
  const d = deps(provider);
  const draft = post('f/a.md', { status: 'draft', date: new Date(now.getTime() + 86_400_000) });
  assert.deepEqual(await runNow(draft, d), { id: 'f/a.md', status: 'posted', message: 'https://x/2' });
  assert.deepEqual(await runNow(draft, d), { id: 'f/a.md', status: 'skipped', message: 'already claimed' });
  assert.equal(calls(), 1);
});

test('runNow refuses a reminder-only post and reports invalid ones', async () => {
  const { provider, calls } = fake(() => ({ id: 'rid' }), ['text is over 3000 characters']);
  const d = deps(provider);
  assert.equal((await runNow(post('f/m.md', { manual: true }), d)).status, 'skipped');
  assert.equal((await runNow(post('f/i.md'), d)).status, 'invalid');
  assert.equal(calls(), 0);
});

test('runNow tells when the post is claimed, before the platform call finishes, and not when it never starts', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { provider } = fake(async () => {
    await gate;
    return { id: 'rid', url: 'https://x/9' };
  });
  const d = deps(provider);
  const events: string[] = [];
  const running = runNow(post('f/a.md'), d, { onClaimed: () => events.push('claimed') });
  for (let tries = 0; tries < 200 && events.length === 0; tries += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(events, ['claimed']);
  assert.equal((await d.store.get('f/a.md'))?.status, 'posting');
  release();
  assert.equal((await running).status, 'posted');

  const never: string[] = [];
  await runNow(post('f/i.md'), deps(fake(() => ({ id: 'x' }), ['no good']).provider), { onClaimed: () => never.push('claimed') });
  await runNow(post('f/m.md', { manual: true }), d, { onClaimed: () => never.push('claimed') });
  assert.deepEqual(never, []);
});
