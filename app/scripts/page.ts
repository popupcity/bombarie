import './datepicker.ts';
import { brand } from '../lib/ui.ts';

const KEY = `${brand}:hidden`;
const VISIBLE_CHIPS = 3;

const read = (): Set<string> => {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
  } catch {
    return new Set();
  }
};

function apply() {
  const hidden = read();
  for (const button of document.querySelectorAll<HTMLElement>('[data-filter]')) {
    const off = hidden.has(button.dataset.filter ?? '');
    button.setAttribute('aria-pressed', String(!off));
    button.title = `${off ? 'Show' : 'Hide'} ${button.dataset.label ?? ''}`;
  }
  for (const group of document.querySelectorAll<HTMLElement>('[data-filter-group]')) {
    const names = (group.dataset.filterGroup ?? '').split(',');
    const shown = names.some((name) => !hidden.has(name));
    group.setAttribute('aria-pressed', String(shown));
    group.title = `${shown ? 'Hide' : 'Show'} ${group.dataset.label ?? ''}`;
  }
  for (const item of document.querySelectorAll<HTMLElement>('li[data-channel]')) {
    item.hidden = hidden.has(item.dataset.channel ?? '');
  }
  for (const cell of document.querySelectorAll<HTMLElement>('[data-cell]')) {
    const chips = [...cell.querySelectorAll<HTMLElement>('[data-chip]')];
    const shown = chips.filter((chip) => !hidden.has(chip.dataset.channel ?? ''));
    const open = cell.dataset.expanded === 'true';
    const more = cell.querySelector<HTMLElement>('[data-more]');
    if (more) {
      more.hidden = shown.length <= VISIBLE_CHIPS;
      more.setAttribute('aria-expanded', String(open));
      const label = more.querySelector<HTMLElement>('[data-more-label]');
      if (label) label.textContent = open ? 'Show less' : `${shown.length - VISIBLE_CHIPS} more`;
    }
    chips.forEach((chip) => (chip.hidden = !(open ? shown : shown.slice(0, VISIBLE_CHIPS)).includes(chip)));
    const count = cell.querySelector<HTMLElement>('[data-count]');
    if (count) count.textContent = shown.length ? String(shown.length) : '';
  }
  for (const group of document.querySelectorAll<HTMLElement>('[data-group]')) {
    group.hidden = !group.querySelector('li[data-channel]:not([hidden])');
  }
  for (const section of document.querySelectorAll<HTMLElement>('[data-month-section]')) {
    const list = section.querySelector('[data-group]');
    section.hidden = list !== null && !section.querySelector('[data-group]:not([hidden])');
  }
}

document.addEventListener('click', (event) => {
  const groupButton = (event.target as Element).closest<HTMLElement>('[data-filter-group]');
  if (groupButton) {
    const names = (groupButton.dataset.filterGroup ?? '').split(',');
    const hidden = read();
    const anyShown = names.some((name) => !hidden.has(name));
    for (const name of names) anyShown ? hidden.add(name) : hidden.delete(name);
    localStorage.setItem(KEY, JSON.stringify([...hidden]));
    apply();
    return;
  }
  const button = (event.target as Element).closest<HTMLElement>('[data-filter]');
  if (!button) return;
  const hidden = read();
  const name = button.dataset.filter ?? '';
  if (!hidden.delete(name)) hidden.add(name);
  localStorage.setItem(KEY, JSON.stringify([...hidden]));
  apply();
});

apply();
const today = document.getElementById('today');
if (today && (!location.hash || location.hash === '#today')) {
  const land = () => scrollTo({ top: Math.max(0, today.getBoundingClientRect().top + scrollY - parseFloat(getComputedStyle(today).scrollMarginTop)), behavior: 'instant' });
  const watch = new ResizeObserver(land);
  const again = setInterval(land, 100);
  const settle = () => {
    watch.disconnect();
    clearInterval(again);
  };
  land();
  watch.observe(document.body);
  for (const type of ['wheel', 'touchstart', 'keydown', 'mousedown']) addEventListener(type, settle, { once: true, passive: true });
  setTimeout(settle, 10_000);
  const loaded = document.readyState === 'complete' ? Promise.resolve() : new Promise((resolve) => addEventListener('load', resolve, { once: true }));
  void Promise.all([loaded, document.fonts.ready]).then(() => setTimeout(settle, 800));
}

document.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLElement>('[data-delete]');
  const dialog = document.getElementById('card-delete') as HTMLDialogElement | null;
  if (!button || !dialog) return;
  const count = Number(button.dataset.siblings ?? '1');
  const title = button.dataset.title ?? '';
  (dialog.querySelector('input[name=variant]') as HTMLInputElement).value = button.dataset.delete ?? '';
  document.getElementById('card-delete-title')!.textContent = count > 1 ? 'Delete this variant?' : `Delete “${title}”?`;
  document.getElementById('card-delete-text')!.textContent = (count > 1 ? 'This removes this channel’s file. The images and the other variants stay.' : 'This removes its file and every file in the folder. It cannot be undone.') + (button.dataset.posted ? ` It stays on ${button.dataset.posted} until you delete it there.` : '');
  for (const open of document.querySelectorAll<HTMLElement>('[popover]:popover-open')) open.hidePopover();
  dialog.showModal();
});

document.addEventListener('keydown', (event) => {
  const step = event.key === 'ArrowDown' || event.key === 'j' ? 1 : event.key === 'ArrowUp' || event.key === 'k' ? -1 : 0;
  if (step === 0 || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target as HTMLElement;
  if (target.closest('input, textarea, select, dialog, [popover], summary')) return;
  const links = [...document.querySelectorAll<HTMLAnchorElement>('li[data-channel]:not([hidden]) a[href^="/posts/"]')].filter((link) => link.closest('[hidden]') === null);
  if (links.length === 0) return;
  event.preventDefault();
  const at = links.indexOf(document.activeElement as HTMLAnchorElement);
  const next = at === -1 ? (step === 1 ? 0 : links.length - 1) : Math.min(links.length - 1, Math.max(0, at + step));
  links[next]?.focus();
});

document.addEventListener('click', (event) => {
  const more = (event.target as Element).closest<HTMLElement>('[data-more]');
  const cell = more?.closest<HTMLElement>('[data-cell]');
  if (!cell) return;
  cell.dataset.expanded = String(cell.dataset.expanded !== 'true');
  apply();
});
