document.addEventListener(
  'click',
  (event) => {
    const trigger = (event.target as Element).closest<HTMLElement>('[popovertarget="new-menu"]');
    const menu = document.getElementById('new-menu');
    if (!trigger || !menu) return;
    for (const part of menu.querySelectorAll<HTMLElement>('[data-idea-part]')) part.hidden = !trigger.hasAttribute('data-with-idea');
    const day = trigger.dataset.day;
    for (const link of menu.querySelectorAll<HTMLAnchorElement>('a[data-base]')) {
      link.href = `/new/${day ? `${day}/` : ''}${encodeURIComponent(link.dataset.base ?? '')}`;
    }
  },
  true
);
