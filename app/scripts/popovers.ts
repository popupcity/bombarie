let invoker: HTMLElement | null = null;

document.addEventListener('click', (event) => (invoker = (event.target as Element).closest<HTMLElement>('[popovertarget]')), true);

document.addEventListener(
  'toggle',
  (event) => {
    const menu = event.target;
    if (!(menu instanceof HTMLElement) || !menu.hasAttribute('popover')) return;
    if ((event as ToggleEvent).newState === 'closed') for (const trigger of document.querySelectorAll(`[popovertarget="${menu.id}"]`)) trigger.removeAttribute('aria-expanded');
    else if (invoker?.getAttribute('popovertarget') === menu.id) invoker.setAttribute('aria-expanded', 'true');
  },
  true
);
