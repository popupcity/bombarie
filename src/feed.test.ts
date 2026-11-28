import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { feedUrlProblem, fetchFeed, mergeItems, parseFeed, readFeed, refreshFeed, refreshFeeds } from './feed.ts';

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Site</title>
<item><title><![CDATA[Eerste & beste]]></title><link>https://x.substack.com/p/eerste</link><guid isPermaLink="false">g1</guid><pubDate>Tue, 17 Nov 2026 08:00:00 GMT</pubDate><description><![CDATA[<p>Hallo <b>wereld</b></p>]]></description></item>
<item><title>Tweede &amp; laatste</title><link>https://x.substack.com/p/tweede</link><guid>g2</guid><pubDate>Wed, 18 Nov 2026 08:00:00 GMT</pubDate><description>&lt;p&gt;Kort&lt;/p&gt;</description></item>
<item><title>Zonder datum</title><link>https://x.substack.com/p/x</link></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom post</title><link rel="alternate" href="https://b.example/a"/><id>tag:b,1</id><published>2026-11-10T10:00:00Z</published><updated>2026-11-20T10:00:00Z</updated><summary>Samenvatting</summary></entry></feed>`;

test('an RSS feed is read, with CDATA, entities and html stripped, and items without a date skipped', () => {
  const items = parseFeed(RSS);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { guid: 'g1', title: 'Eerste & beste', url: 'https://x.substack.com/p/eerste', at: '2026-11-17T08:00:00.000Z', text: 'Hallo wereld' });
  assert.equal(items[1]?.title, 'Tweede & laatste');
  assert.equal(items[1]?.text, 'Kort');
});

test('an Atom feed is read too', () => {
  assert.deepEqual(parseFeed(ATOM), [{ guid: 'tag:b,1', title: 'Atom post', url: 'https://b.example/a', at: '2026-11-10T10:00:00.000Z', text: 'Samenvatting' }]);
});

test('only public https feed addresses are accepted', () => {
  assert.equal(feedUrlProblem('https://x.substack.com/feed'), null);
  for (const bad of ['http://x.com/feed', 'https://localhost/feed', 'https://127.0.0.1/feed', 'https://[::1]/feed', 'https://intranet/feed', 'https://x.com:8443/feed', 'nope']) assert.notEqual(feedUrlProblem(bad), null, bad);
});

test('redirects are followed but checked, and a feed without posts is an error', async () => {
  const hops: string[] = [];
  const route = (map: Record<string, Response>) => (async (url: string) => {
    hops.push(url);
    return map[url] ?? new Response('', { status: 404 });
  }) as unknown as typeof fetch;
  const ok = route({ 'https://a.com/feed': new Response(null, { status: 301, headers: { location: 'https://b.com/rss' } }), 'https://b.com/rss': new Response(RSS) });
  assert.equal((await fetchFeed('https://a.com/feed', ok)).length, 2);
  const bad = route({ 'https://a.com/feed': new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/x' } }) });
  await assert.rejects(fetchFeed('https://a.com/feed', bad), /public website name/);
  await assert.rejects(fetchFeed('https://a.com/feed', route({ 'https://a.com/feed': new Response('<html></html>') })), /no posts found/);
});

test('items are kept when they drop out of the feed, and a failed read keeps what was stored', async () => {
  const root = mkdtempSync(join(tmpdir(), 'feed-'));
  const now = new Date('2026-11-19T12:00:00Z');
  const serve = (body: string, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch;
  await refreshFeed(root, 'sub', 'https://x.com/feed', serve(RSS), now);
  assert.equal(readFeed(root, 'sub')?.items.length, 2);
  const only = `<rss><channel><item><title>Nieuw</title><link>https://x.com/n</link><guid>g3</guid><pubDate>Thu, 19 Nov 2026 08:00:00 GMT</pubDate></item></channel></rss>`;
  await refreshFeed(root, 'sub', 'https://x.com/feed', serve(only), now);
  assert.deepEqual(readFeed(root, 'sub')?.items.map((item) => item.guid), ['g3', 'g2', 'g1']);
  const failed = await refreshFeed(root, 'sub', 'https://x.com/feed', serve('', 500), now);
  assert.match(failed.error ?? '', /500/);
  assert.equal(failed.items.length, 3);
  assert.equal(mergeItems([], []).length, 0);
});

test('feeds are read at most once an hour', async () => {
  const root = mkdtempSync(join(tmpdir(), 'feed-'));
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(RSS);
  }) as unknown as typeof fetch;
  const channels = { sub: { platform: 'substack', feed: 'https://x.com/feed' }, other: { platform: 'linkedin' } } as never;
  await refreshFeeds(root, channels, fetchImpl, new Date('2026-11-19T12:00:00Z'));
  await refreshFeeds(root, channels, fetchImpl, new Date('2026-11-19T12:30:00Z'));
  assert.equal(calls, 1);
  await refreshFeeds(root, channels, fetchImpl, new Date('2026-11-19T13:01:00Z'));
  assert.equal(calls, 2);
});

test('a new feed address starts from scratch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'feed-'));
  const now = new Date('2026-11-19T12:00:00Z');
  const serve = (body: string) => (async () => new Response(body)) as unknown as typeof fetch;
  const other = `<rss><channel><item><title>English</title><link>https://x.com/en</link><guid>e1</guid><pubDate>Thu, 19 Nov 2026 08:00:00 GMT</pubDate></item></channel></rss>`;
  await refreshFeed(root, 'sub', 'https://x.com/nl/feed', serve(RSS), now);
  assert.equal(readFeed(root, 'sub')?.items.length, 2);
  await refreshFeed(root, 'sub', 'https://x.com/en/feed', serve(other), now);
  assert.deepEqual(readFeed(root, 'sub')?.items.map((item) => item.guid), ['e1']);
  const channels = { sub: { platform: 'feed', feed: 'https://x.com/nl/feed' } } as never;
  await refreshFeeds(root, channels, serve(RSS), new Date('2026-11-19T12:10:00Z'));
  assert.equal(readFeed(root, 'sub')?.items.length, 2);
});

test('a link from a feed is kept only when it is a web address', () => {
  const item = (link: string) => `<item><title>T</title><guid>g</guid><pubDate>Fri, 27 Nov 2026 10:00:00 GMT</pubDate><link>${link}</link></item>`;
  assert.deepEqual(parseFeed(`<rss>${item('https://a.test/p')}${item('javascript:alert(1)')}${item('data:text/html,x')}</rss>`).map((found) => found.url), ['https://a.test/p', '', '']);
});
