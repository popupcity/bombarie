const toggle = document.querySelector<HTMLButtonElement>('[data-nav-toggle]');
const panel = document.getElementById('sidebar');

function show(open: boolean): void {
  toggle?.setAttribute('aria-expanded', String(open));
  panel?.toggleAttribute('data-open', open);
  document.documentElement.classList.toggle('max-md:overflow-hidden', open);
}

toggle?.addEventListener('click', () => show(toggle.getAttribute('aria-expanded') !== 'true'));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !document.querySelector(':popover-open, dialog[open]')) show(false);
});
