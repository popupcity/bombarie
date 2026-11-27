import { brand, RAIL_COOKIE } from '../lib/ui.ts';

const toggle = document.querySelector<HTMLButtonElement>('[data-rail-toggle]');
const html = document.documentElement;

function someHidden(): boolean {
  try {
    const hidden = new Set<string>(JSON.parse(localStorage.getItem(`${brand}:hidden`) ?? '[]'));
    return [...document.querySelectorAll<HTMLElement>('[data-filter]')].some((filter) => hidden.has(filter.dataset.filter ?? ''));
  } catch {
    return false;
  }
}

function paint(): void {
  if (!toggle) return;
  const railed = html.hasAttribute('data-rail');
  const hidden = railed && someHidden();
  const said = railed ? `Open the sidebar${hidden ? ', some channels are hidden' : ''}` : 'Close the sidebar';
  toggle.setAttribute('aria-expanded', String(!railed));
  toggle.setAttribute('aria-label', said);
  toggle.title = said;
  delete toggle.dataset.tip;
  toggle.querySelector<HTMLElement>('[data-rail-hidden]')!.hidden = !hidden;
  for (const item of document.querySelectorAll<HTMLElement>('[data-rail-name]')) {
    delete item.dataset.tip;
    if (railed) item.title = item.dataset.railName ?? '';
    else item.removeAttribute('title');
  }
}

toggle?.addEventListener('click', () => {
  const railed = html.toggleAttribute('data-rail');
  document.cookie = `${RAIL_COOKIE}=${railed ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`;
  paint();
});
paint();
