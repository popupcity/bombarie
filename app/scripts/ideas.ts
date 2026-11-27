import { SWAPPED } from '../lib/ui.ts';
import './inplace.ts';

const KEY = 'ideas-filter';
const MATCH: Record<string, string[]> = { open: ['new', 'approved'], approved: ['approved'], made: ['made'] };

function apply(name = localStorage.getItem(KEY) ?? 'open') {
  const wanted = MATCH[name] ?? MATCH.open!;
  for (const button of document.querySelectorAll<HTMLButtonElement>('#idea-filter [data-show]')) button.setAttribute('aria-pressed', String(button.dataset.show === name));
  let shown = 0;
  for (const card of document.querySelectorAll<HTMLElement>('#idea-grid > li')) {
    card.hidden = !wanted.includes(card.dataset.status ?? '');
    if (!card.hidden) shown += 1;
  }
  const empty = document.getElementById('idea-empty');
  if (empty) empty.hidden = shown > 0;
  localStorage.setItem(KEY, name);
}

document.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLElement>('#idea-filter [data-show]');
  if (button) apply(button.dataset.show ?? 'open');
});
document.addEventListener(SWAPPED, () => apply());
apply();
