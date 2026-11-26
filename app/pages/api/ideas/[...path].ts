import type { APIRoute } from 'astro';
import { addIdeaImage, readIdea } from '../../../../src/ideas.ts';
import { MAX_IMAGE_BYTES, saveImage } from '../../../../src/media.ts';
import { content, json, root } from '../../../lib/data.ts';

export const PUT: APIRoute = async ({ params, request }) => {
  const [folder = '', filename = ''] = (params.path ?? '').split('/').map(decodeURIComponent);
  if (!readIdea(root, folder)) return json({ error: 'idea not found' }, 404);
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_IMAGE_BYTES) return json({ error: 'the image is over 10 MB' }, 413);
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const name = await saveImage(content, folder, filename, bytes, 'ideas');
    await addIdeaImage(root, content, folder, name);
    return json({ name, folder });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
};
