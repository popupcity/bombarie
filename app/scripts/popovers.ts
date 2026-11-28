import { float } from './place.ts';

let invoker: HTMLElement | null = null;

document.addEventListener('click', (event) => (invoker = (event.target as Element).closest<HTMLElement>('[popovertarget]')), true);

document.addEventListener(
  'toggle',
  (event) => {
    const menu = event.target;
    if (!(menu instanceof HTMLElement) || !menu.hasAttribute('popover')) return;
    if ((event as ToggleEvent).newState === 'closed') for (const trigger of document.querySelectorAll(`[popovertarget="${menu.id}"]`)) trigger.removeAttribute('aria-expanded');
    else {
      const trigger = invoker?.getAttribute('popovertarget') === menu.id && invoker.isConnected ? invoker : document.querySelector<HTMLElement>(`[popovertarget="${menu.id}"]`);
      trigger?.setAttribute('aria-expanded', 'true');
      if (trigger && menu.dataset.float) float(menu, trigger);
    }
  },
  true
);
