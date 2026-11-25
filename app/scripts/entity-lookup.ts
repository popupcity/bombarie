import { readClip } from '../../src/linkedin-lookup.ts';
import { sentence } from '../../src/text.ts';
import { toast } from './toast.ts';
import { busy } from './pending.ts';

const button = document.getElementById('linkedin-lookup') as HTMLButtonElement | null;
const field = document.getElementById('linkedin') as HTMLInputElement | null;
const name = document.getElementById('name') as HTMLInputElement | null;
const URN = /^urn:li:(person|organization):\S+$/;

function fill(found: { name: string; urn: string }): void {
  if (!field) return;
  field.value = found.urn;
  if (name && name.value.trim() === '') name.value = found.name;
  toast(sentence(`Found ${found.name}`), 'ok');
}

function sync(): void {
  if (!field || !button) return;
  const complete = URN.test(field.value.trim());
  button.hidden = complete;
  if (complete) document.getElementById('linkedin-bookmarklet')?.setAttribute('hidden', '');
}

field?.addEventListener('input', () => {
  const clip = readClip(field.value);
  if (clip) fill(clip);
  sync();
});
sync();

button?.addEventListener('click', async () => {
  if (!field) return;
  const done = busy(button, 'Looking up…');
  try {
    const response = await fetch('/api/entities/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: field.value }) });
    const data = (await response.json()) as { name?: string; urn?: string; error?: string };
    if (!response.ok || !data.urn) {
      toast(sentence(data.error ?? 'The lookup failed'), 'bad');
      document.getElementById('linkedin-bookmarklet')?.removeAttribute('hidden');
      return;
    }
    fill({ name: data.name ?? '', urn: data.urn });
    sync();
  } finally {
    done();
  }
});
