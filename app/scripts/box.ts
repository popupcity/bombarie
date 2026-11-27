document.addEventListener('click', (event) => {
  const hit = event.target as HTMLElement;
  const box = hit.closest<HTMLElement>('[data-box]');
  if (box && (hit === box || hit.hasAttribute('data-box-media'))) box.querySelector<HTMLTextAreaElement>('textarea:not([hidden])')?.focus();
});
