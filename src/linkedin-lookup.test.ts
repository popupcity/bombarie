import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookmarklet, lookupPage, readClip, readPage, vanityFrom } from './linkedin-lookup.ts';

const page = (title: string, body = '') => `<html><head><meta property="og:title" content="${title}"></head><body>${body}</body></html>`;

test('the page name comes out of a company address, other addresses give nothing', () => {
  assert.equal(vanityFrom('https://www.linkedin.com/company/pop-up-city/'), 'pop-up-city');
  assert.equal(vanityFrom('https://nl.linkedin.com/company/pop-up-city/about/?x=1'), 'pop-up-city');
  assert.equal(vanityFrom('https://www.linkedin.com/in/someone'), null);
  assert.equal(vanityFrom('http://www.linkedin.com/company/x'), null);
  assert.equal(vanityFrom('https://evil.example/company/x'), null);
  assert.equal(vanityFrom('urn:li:organization:1'), null);
});

test('the page gives its own name and the id that appears most', () => {
  const html = page('Pop-Up City | LinkedIn', 'urn:li:fsd_company:716321 urn:li:fsd_company:99 urn:li:fsd_company:716321 urn:li:company:716321');
  assert.deepEqual(readPage(html), { name: 'Pop-Up City', urn: 'urn:li:organization:716321' });
  assert.equal(readPage(page('Ben &amp; Jerry&#39;s | LinkedIn', 'urn:li:fsd_company:5'))?.name, "Ben & Jerry's");
  assert.equal(readPage(page('Nobody | LinkedIn')), null);
  assert.equal(readPage('<html></html>'), null);
});

test('a lookup reads the public page, and says what to do when LinkedIn refuses', async () => {
  const ok = (async (url: string) => {
    assert.match(url, /\/company\/pop-up-city\/$/);
    return new Response(page('Pop-Up City | LinkedIn', 'urn:li:fsd_company:716321'));
  }) as unknown as typeof fetch;
  assert.deepEqual(await lookupPage('pop-up-city', ok), { name: 'Pop-Up City', urn: 'urn:li:organization:716321' });
  const blocked = (async () => new Response('Just a moment', { status: 403 })) as unknown as typeof fetch;
  await assert.rejects(lookupPage('x', blocked), /button below/);
});

test('the bookmarklet carries the same reader and works on a page', () => {
  const code = bookmarklet();
  assert.match(code, /^javascript:/);
  const read = new Function(`return ${code.slice(code.indexOf('const read=') + 11, code.indexOf(';const found'))}`)() as typeof readPage;
  assert.equal(read(page('Pop-Up City | LinkedIn', 'urn:li:fsd_company:7'))?.urn, 'urn:li:organization:7');
});

test('what the bookmarklet copies is read back, anything else is not', () => {
  assert.deepEqual(readClip('Pop | Up | urn:li:organization:716321'), { name: 'Pop | Up', urn: 'urn:li:organization:716321' });
  assert.equal(readClip('urn:li:organization:716321'), null);
  assert.equal(readClip('hello'), null);
});
