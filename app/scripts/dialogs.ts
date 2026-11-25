document.addEventListener('click', (event) => {
  const opener = (event.target as Element).closest<HTMLElement>('[data-open]');
  if (!opener) return;
  for (const open of document.querySelectorAll<HTMLElement>('[popover]:popover-open')) open.hidePopover();
  const dialog = document.getElementById(opener.dataset.open ?? '') as HTMLDialogElement | null;
  const fill = dialog?.querySelector<HTMLInputElement>('input[data-fill]');
  if (fill) fill.value = opener.dataset.value ?? '';
  dialog?.showModal();
});

document.addEventListener('click', (event) => {
  const dialog = event.target;
  if (!(dialog instanceof HTMLDialogElement) || !dialog.open) return;
  const box = dialog.getBoundingClientRect();
  const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
  if (!inside) dialog.close();
});
