const ANCHOR = '--new-menu';

document.addEventListener(
  'click',
  (event) => {
    const trigger = (event.target as Element).closest<HTMLElement>('[popovertarget="new-menu"]');
    const menu = document.getElementById('new-menu');
    if (!trigger || !menu) return;
    for (const other of document.querySelectorAll<HTMLElement>('[data-new-anchor]')) {
      other.style.anchorName = '';
      other.removeAttribute('data-new-anchor');
    }
    trigger.style.anchorName = ANCHOR;
    trigger.setAttribute('data-new-anchor', '');
    const day = trigger.dataset.day;
    for (const link of menu.querySelectorAll<HTMLAnchorElement>('a[data-base]')) {
      link.href = `/new/${day ? `${day}/` : ''}${encodeURIComponent(link.dataset.base ?? '')}`;
    }
  },
  true
);
