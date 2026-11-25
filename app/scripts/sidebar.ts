import { brand } from '../lib/ui.ts';

const KEY = `${brand}:hidden`;

const read = (): Set<string> => {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
  } catch {
    return new Set();
  }
};

const filters = [...document.querySelectorAll<HTMLElement>('[data-filter]')];
const filterable = document.querySelector('[data-view]') !== null;

if (!filterable) {
  const hidden = read();
  for (const button of filters) {
    button.setAttribute('aria-pressed', String(!hidden.has(button.dataset.filter ?? '')));
    button.title = `Show ${button.dataset.label ?? ''}`;
  }
  for (const group of document.querySelectorAll<HTMLElement>('[data-filter-group]')) {
    const names = (group.dataset.filterGroup ?? '').split(',');
    group.setAttribute('aria-pressed', String(names.some((name) => !hidden.has(name))));
    group.title = `Show ${group.dataset.label ?? ''}`;
  }
  document.addEventListener('click', (event) => {
    const group = (event.target as Element).closest<HTMLElement>('[data-filter-group]');
    if (group) {
      const keep = new Set((group.dataset.filterGroup ?? '').split(','));
      localStorage.setItem(KEY, JSON.stringify(filters.map((item) => item.dataset.filter ?? '').filter((name) => !keep.has(name))));
      location.assign('/');
      return;
    }
    const button = (event.target as Element).closest<HTMLElement>('[data-filter]');
    if (!button) return;
    const only = button.dataset.filter ?? '';
    localStorage.setItem(KEY, JSON.stringify(filters.map((item) => item.dataset.filter ?? '').filter((name) => name !== only)));
    location.assign('/');
  });
}
