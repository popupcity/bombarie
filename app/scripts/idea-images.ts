import { sentence } from '../../src/text.ts';
import { toast } from './toast.ts';
import { uploadTile } from './uploads.ts';

const root = document.querySelector<HTMLElement>('[data-idea]');
const input = document.getElementById('idea-image-input') as HTMLInputElement | null;

async function upload(files: File[]) {
  if (!root || files.length === 0) return;
  const folder = root.dataset.idea ?? '';
  const failed: string[] = [];
  const list = document.getElementById('idea-uploading');
  const tiles = list ? files.map((file) => uploadTile(list, file.name)) : [];
  for (const [index, file] of files.entries()) {
    const tile = tiles[index];
    tile?.state('uploading…');
    try {
      const response = await fetch(`/api/ideas/${encodeURIComponent(folder)}/${encodeURIComponent(file.name)}`, { method: 'PUT', body: file });
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

input?.addEventListener('change', () => {
  void upload([...(input.files ?? [])]);
  input.value = '';
});
const zone = document.getElementById('image-dropzone');
let depth = 0;
const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
document.addEventListener('dragenter', (event) => {
  if (!carriesFiles(event)) return;
  depth += 1;
  zone?.setAttribute('data-active', '');
});
document.addEventListener('dragleave', (event) => {
  if (!carriesFiles(event)) return;
  depth = Math.max(0, depth - 1);
  if (depth === 0) zone?.removeAttribute('data-active');
});
document.addEventListener('dragover', (event) => {
  if (carriesFiles(event)) event.preventDefault();
});
document.addEventListener('drop', (event) => {
  event.preventDefault();
  depth = 0;
  zone?.removeAttribute('data-active');
  void upload([...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith('image/')));
});
document.addEventListener('paste', (event) => {
  const pasted = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'));
  if (pasted.length === 0) return;
  event.preventDefault();
  void upload(pasted);
});
