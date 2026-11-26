import { SWAPPED } from '../lib/ui.ts';
import { startProgress, stopProgress } from './pending.ts';
import { toast } from './toast.ts';

let queue = Promise.resolve();

export const act = (url: string, body: FormData): Promise<void> => (queue = queue.then(() => send(url, body)));

async function send(url: string, body: FormData): Promise<void> {
  startProgress();
  try {
    const response = await fetch(url, { method: 'POST', body });
    if (!response.ok) {
      toast('That did not work. Reload the page and try again.', 'bad');
      return;
    }
    const next = new DOMParser().parseFromString(await response.text(), 'text/html');
    const fresh = next.querySelector('main');
    if (!fresh?.querySelector('[data-view]')) {
      location.reload();
      return;
    }
    const messages = [...fresh.querySelectorAll<HTMLElement>('[data-toast]')];
    for (const message of messages) message.remove();
    document.querySelector('main')!.replaceChildren(...[...fresh.childNodes].map((node) => document.adoptNode(node)));
    document.dispatchEvent(new Event(SWAPPED));
    for (const message of messages) toast(message.dataset.toast ?? '', (message.dataset.tone as Parameters<typeof toast>[1] | undefined) ?? 'ok');
  } catch {
    toast('No connection to the server.', 'bad');
  } finally {
    stopProgress();
  }
}

export const inPlace = (): boolean => document.querySelector('[data-view="list"]') !== null;

document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement;
  if (event.defaultPrevented || form.method !== 'post' || !inPlace() || !form.closest('main')) return;
  event.preventDefault();
  void act(form.getAttribute('action') ?? location.pathname, new FormData(form, (event as SubmitEvent).submitter));
});
