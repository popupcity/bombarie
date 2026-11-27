import { SWAPPED } from '../lib/ui.ts';
import { startProgress, stopProgress } from './pending.ts';
import { toast } from './toast.ts';

let queue = Promise.resolve();

export const act = (url: string, body: FormData): Promise<void> => (queue = queue.then(() => send(url, body)));

export const show = (url: string): Promise<void> => (queue = queue.then(() => send(url)));

async function send(url: string, body?: FormData): Promise<void> {
  startProgress();
  try {
    const response = await fetch(url, body ? { method: 'POST', body } : {});
    if (!response.ok) {
      if (!body) location.assign(url);
      else toast('That did not work. Reload the page and try again.', 'bad');
      return;
    }
    const next = new DOMParser().parseFromString(await response.text(), 'text/html');
    const fresh = next.querySelector('main');
    if (!fresh?.querySelector('[data-view]')) {
      if (body) location.reload();
      else location.assign(url);
      return;
    }
    const messages = [...fresh.querySelectorAll<HTMLElement>('[data-toast]')];
    for (const message of messages) message.remove();
    if (!body) history.replaceState(null, '', url);
    document.querySelector('main')!.replaceChildren(...[...fresh.childNodes].map((node) => document.adoptNode(node)));
    document.dispatchEvent(new Event(SWAPPED));
    for (const message of messages) toast(message.dataset.toast ?? '', (message.dataset.tone as Parameters<typeof toast>[1] | undefined) ?? 'ok');
  } catch {
    if (!body) location.assign(url);
    else toast('No connection to the server.', 'bad');
  } finally {
    stopProgress();
  }
}

const inPlace = (): boolean => document.querySelector('[data-view]') !== null;

document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement;
  if (event.defaultPrevented || form.method !== 'post' || !inPlace() || !form.closest('main')) return;
  event.preventDefault();
  void act(form.getAttribute('action') ?? location.pathname, new FormData(form, (event as SubmitEvent).submitter));
});
