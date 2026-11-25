import { sentence } from '../../src/text.ts';
import { toast } from './toast.ts';
import { uploadTile } from './uploads.ts';

async function add(files: File[]) {
  if (files.length === 0) return;
  const grid = document.getElementById('idea-grid');
  const tiles = grid ? files.map((file) => uploadTile(grid, file.name || 'image', { card: true, prepend: true })) : [];
  const failed: string[] = [];
  for (const [index, file] of files.entries()) {
    const tile = tiles[index];
    tile?.state('uploading…');
    try {
      const name = file.name && file.name !== 'image.png' ? file.name : `image-${Date.now()}-${index}.png`;
      const response = await fetch(`/api/ideas/new/${encodeURIComponent(name)}`, { method: 'PUT', body: file });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        failed.push(sentence(`${file.name}: ${data.error ?? response.statusText}`));
        tile?.remove();
      } else tile?.state('done');
    } catch {
      failed.push(`${file.name}: no connection to the server.`);
      tile?.remove();
    }
  }
  if (failed.length > 0) toast(failed.join('; '), 'bad');
  if (failed.length < files.length) location.reload();
}

const zone = document.getElementById('idea-dropzone');
const input = document.getElementById('idea-upload') as HTMLInputElement | null;
let depth = 0;

const images = (list: FileList | null | undefined): File[] => [...(list ?? [])].filter((file) => file.type.startsWith('image/'));

const files = (event: DragEvent): boolean => event.dataTransfer?.types.includes('Files') ?? false;

document.addEventListener('dragenter', (event) => {
  if (!files(event)) return;
  depth += 1;
  zone?.setAttribute('data-active', '');
});
document.addEventListener('dragleave', (event) => {
  if (!files(event)) return;
  depth = Math.max(0, depth - 1);
  if (depth === 0) zone?.removeAttribute('data-active');
});
document.addEventListener('dragover', (event) => {
  if (files(event)) event.preventDefault();
});
document.addEventListener('drop', (event) => {
  event.preventDefault();
  depth = 0;
  zone?.removeAttribute('data-active');
  void add(images(event.dataTransfer?.files));
});
input?.addEventListener('change', () => {
  void add(images(input.files));
  input.value = '';
});
document.addEventListener('paste', (event) => {
  const pasted = images(event.clipboardData?.files);
  if (pasted.length === 0) return;
  event.preventDefault();
  void add(pasted);
});
