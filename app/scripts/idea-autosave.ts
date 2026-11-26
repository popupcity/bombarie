import { toast } from './toast.ts';

const form = document.getElementById('idea-form') as HTMLFormElement | null;

if (form) {
  let timer: number | undefined;
  let sending = false;
  let again = false;

  const send = async () => {
    if (sending) {
      again = true;
      return;
    }
    sending = true;
    const body = new FormData(form);
    body.set('intent', 'save');
    body.set('quiet', '1');
    try {
      const response = await fetch(location.pathname, { method: 'POST', body, redirect: 'manual' });
      if (response.status !== 204) toast(response.status === 422 ? `Not saved: ${await response.text()}` : 'Not saved. Reload the page and try again.', 'bad');
    } catch {
      toast('Not saved: no connection to the server.', 'bad');
    } finally {
      sending = false;
      if (again) {
        again = false;
        void send();
      }
    }
  };

  form.addEventListener('input', (event) => {
    if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) || event.target.type === 'file') return;
    clearTimeout(timer);
    timer = window.setTimeout(() => void send(), 1000);
  });
  form.addEventListener('submit', () => clearTimeout(timer));
}
