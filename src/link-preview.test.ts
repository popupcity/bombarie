import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchPreview, isPrivateAddress, readMeta } from './link-preview.ts';

const page = '<html><head><title>Fallback</title><meta property="og:title" content="A &amp; B"><meta property="og:site_name" content="Example"><meta property="og:image" content="/pic.png"></head></html>';

test('meta tags give the title, site and image, with entities decoded', () => {
  assert.deepEqual(readMeta(page), { title: 'A & B', site: 'Example', image: '/pic.png' });
  assert.deepEqual(readMeta('<title> Just  a title </title>'), { title: 'Just a title' });
});

test('private and local addresses are recognised', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.20.0.1', '169.254.1.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('a preview carries the title, the site and the image of a public page', async () => {
  const fetchImpl = (async (url: URL) => {
    if (String(url).endsWith('/pic.png')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    return new Response(page, { headers: { 'content-type': 'text/html' } });
  }) as unknown as typeof fetch;
  const preview = await fetchPreview('https://example.com/post', { fetch: fetchImpl, lookup: async () => ['93.184.216.34'] });
  assert.equal(preview?.title, 'A & B');
  assert.equal(preview?.site, 'Example');
  assert.equal(preview?.image?.ext, 'png');
  assert.deepEqual([...(preview?.image?.bytes ?? [])], [1, 2, 3]);
});

test('an address that resolves to a private network is never requested', async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return new Response('x');
  }) as unknown as typeof fetch;
  assert.equal(await fetchPreview('https://internal.test/', { fetch: fetchImpl, lookup: async () => ['10.0.0.5'] }), null);
  assert.equal(called, false);
});

test('a redirect to a private address is refused', async () => {
  const fetchImpl = (async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } })) as unknown as typeof fetch;
  assert.equal(await fetchPreview('https://example.com/', { fetch: fetchImpl, lookup: async () => ['93.184.216.34'] }), null);
});
