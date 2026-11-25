export function vanityFrom(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
  const match = /^\/(?:company|school|showcase)\/([^/?#]+)/i.exec(url.pathname);
  return match ? decodeURIComponent(match[1]!) : null;
}

export function readPage(html: string): { name: string; urn: string } | null {
  const counts = new Map<string, number>();
  for (const match of html.matchAll(/urn:li:(?:fsd_company|company|organization):(\d+)/g)) counts.set(match[1]!, (counts.get(match[1]!) ?? 0) + 1);
  const id = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const title = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] ?? /<title>([^<]+)<\/title>/i.exec(html)?.[1] ?? '';
  const name = title
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\s*[|\-–]\s*LinkedIn\s*$/i, '')
    .replace(/\s*\|\s*[\d,.]+\s+followers.*$/i, '')
    .trim();
  return id && name ? { name, urn: `urn:li:organization:${id}` } : null;
}

export async function lookupPage(vanity: string, fetchImpl: typeof fetch = fetch): Promise<{ name: string; urn: string }> {
  let res: Response;
  try {
    res = await fetchImpl(`https://www.linkedin.com/company/${encodeURIComponent(vanity)}/`, {
      headers: { 'User-Agent': 'Bombarie/1.0 (single page lookup)', 'Accept-Language': 'en', Accept: 'text/html' },
      signal: AbortSignal.timeout(8000)
    });
  } catch {
    throw new Error('LinkedIn could not be reached');
  }
  const found = res.ok ? readPage((await res.text()).slice(0, 2_000_000)) : null;
  if (!found) throw new Error('LinkedIn does not show this page to a server; use the button below');
  return found;
}

export const bookmarklet = (): string =>
  `javascript:(()=>{const read=${readPage.toString()};const found=read(document.documentElement.outerHTML);if(!found){alert('No company page found here');return}navigator.clipboard.writeText(found.name+' | '+found.urn).then(()=>alert('Copied '+found.name+'. Paste it in the LinkedIn field of Bombarie.'))})()`;

export function readClip(text: string): { name: string; urn: string } | null {
  const match = /^(.+)\s\|\s(urn:li:organization:\d+)$/.exec(text.trim());
  return match ? { name: match[1]!.trim(), urn: match[2]! } : null;
}
