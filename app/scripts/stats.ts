import { show } from './inplace.ts';

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element).closest<HTMLAnchorElement>('main a[href]');
  if (!link || link.target || new URL(link.href).pathname !== '/stats') return;
  event.preventDefault();
  const group = link.closest('nav')?.getAttribute('aria-label');
  const menu = link.closest('[popover]')?.id;
  const more = link.hasAttribute('data-more-places') ? 'data-more-places' : 'data-more-posts';
  const place = [...(link.closest('nav')?.querySelectorAll('a') ?? [])].indexOf(link);
  void show(link.href).then(() => {
    const again = menu
      ? document.querySelector<HTMLElement>(`main [popovertarget="${menu}"]`)
      : group
        ? document.querySelector(`main nav[aria-label="${group}"]`)?.querySelectorAll('a')[place]
        : document.querySelector<HTMLElement>(`main [${more}]`);
    again?.focus({ preventScroll: true });
  });
});
