import { byteRange } from '../../src/media.ts';

export function serveBytes(request: Request, bytes: Buffer, type: string, cache: string): Response {
  const headers = { 'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff', ...(type === 'video/mp4' && { 'Accept-Ranges': 'bytes' }) };
  const range = type === 'video/mp4' ? byteRange(request.headers.get('range'), bytes.length) : null;
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.length}` } });
  if (range) return new Response(new Uint8Array(bytes.subarray(range.first, range.last + 1)), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${range.first}-${range.last}/${bytes.length}` } });
  return new Response(new Uint8Array(bytes), { headers });
}
