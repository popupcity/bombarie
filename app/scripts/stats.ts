import { show } from './inplace.ts';
import { float } from './place.ts';

function openDay(mark: Element): HTMLElement | null {
  const panel = document.getElementById(mark.getAttribute('data-opens')!);
  if (!panel) return null;
  panel.showPopover();
  float(panel, mark as HTMLElement);
  return panel;
}

document.addEventListener('click', (event) => {
  const mark = (event.target as Element).closest('[data-opens]');
  if (mark) openDay(mark);
});

document.addEventListener('keydown', (event) => {
  const mark = (event.target as Element).closest('[data-opens][role="button"]');
  if (!mark || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  openDay(mark)?.querySelector('a')?.focus();
});

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element).closest<HTMLAnchorElement>('main a[href]');
  if (!link || link.target || new URL(link.href).pathname !== '/stats') return;
  event.preventDefault();
  const group = link.closest('nav')?.getAttribute('aria-label');
  const menu = link.closest('[popover]')?.id;
  const opened = link.dataset.place;
  const more = link.getAttributeNames().find((name) => name.startsWith('data-more-'));
  const place = [...(link.closest('nav')?.querySelectorAll('a') ?? [])].indexOf(link);
  void show(link.href).then(() => {
    const again = opened
      ? document.querySelector<HTMLElement>(`main [data-place="${CSS.escape(opened)}"]`)
      : menu
      ? document.querySelector<HTMLElement>(`main [popovertarget="${menu}"]`)
      : group
        ? document.querySelector(`main nav[aria-label="${group}"]`)?.querySelectorAll('a')[place]
        : more
          ? document.querySelector<HTMLElement>(`main [${more}]`)
          : null;
    again?.focus({ preventScroll: true });
  });
});
