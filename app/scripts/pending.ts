export const spinner =
  '<svg class="size-4 shrink-0 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" opacity=".25"/><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
const SHOW_AFTER = 200;
const GIVE_UP = 20_000;

const restorers = new Set<() => void>();

export function busy(button: HTMLElement, label?: string): () => void {
  if (button.getAttribute('aria-busy') === 'true') return () => {};
  const html = button.innerHTML;
  const wasDisabled = button instanceof HTMLButtonElement ? button.disabled : false;
  const text = label ?? button.textContent?.trim() ?? '';
  button.style.minWidth = `${button.offsetWidth}px`;
  button.setAttribute('aria-busy', 'true');
  button.innerHTML = `${spinner}<span>${text}</span>`;
  if (button instanceof HTMLButtonElement) button.disabled = true;
  const restore = () => {
    restorers.delete(restore);
    button.removeAttribute('aria-busy');
    button.style.minWidth = '';
    button.innerHTML = html;
    if (button instanceof HTMLButtonElement) button.disabled = wasDisabled;
  };
  restorers.add(restore);
  return restore;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let bar: HTMLElement | null = null;

export function stopProgress() {
  clearTimeout(timer);
  timer = undefined;
  bar?.remove();
  bar = null;
}

export function startProgress() {
  if (timer !== undefined || bar) return;
  timer = setTimeout(() => {
    timer = undefined;
    bar = document.createElement('div');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'Loading');
    bar.className = 'pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 origin-left bg-ink';
    document.body.append(bar);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) bar.style.transform = 'scaleX(0.6)';
    else bar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(0.9)' }], { duration: 8000, easing: 'cubic-bezier(0.1, 0.7, 0.3, 1)', fill: 'forwards' });
    setTimeout(stopProgress, GIVE_UP);
  }, SHOW_AFTER);
}

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
  if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
  setTimeout(() => {
    if (!event.defaultPrevented) startProgress();
  }, 0);
});

document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement;
  if (form.method === 'dialog') return;
  const submitter = (event as SubmitEvent).submitter as HTMLElement | null;
  setTimeout(() => {
    if (event.defaultPrevented) return;
    startProgress();
    if (submitter instanceof HTMLButtonElement && submitter.matches('[data-ui="button"], [data-pending]')) busy(submitter, submitter.dataset.pending);
  }, 0);
});

window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  stopProgress();
  for (const restore of [...restorers]) restore();
});
window.addEventListener('pagehide', () => {
  clearTimeout(timer);
  timer = undefined;
});
