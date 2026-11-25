const KEY = 'ideas-filter';
const MATCH: Record<string, string[]> = { open: ['new', 'approved'], approved: ['approved'], made: ['made'] };

const buttons = [...document.querySelectorAll<HTMLButtonElement>('#idea-filter [data-show]')];
const cards = [...document.querySelectorAll<HTMLElement>('#idea-grid > li')];
const empty = document.getElementById('idea-empty');

function apply(name: string) {
  const wanted = MATCH[name] ?? MATCH.open!;
  for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.show === name));
  let shown = 0;
  for (const card of cards) {
    card.hidden = !wanted.includes(card.dataset.status ?? '');
    if (!card.hidden) shown += 1;
  }
  if (empty) empty.hidden = shown > 0;
  localStorage.setItem(KEY, name);
}

for (const button of buttons) button.addEventListener('click', () => apply(button.dataset.show ?? 'open'));
apply(localStorage.getItem(KEY) ?? 'open');

const composer = document.getElementById('idea') as HTMLTextAreaElement | null;
composer?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    composer.form?.requestSubmit();
  }
});
