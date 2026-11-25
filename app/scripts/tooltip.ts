import { h } from './dom.ts';

const DELAY = 350;
const GAP = 8;

const tip = h('div', {
  popover: 'manual',
  role: 'tooltip',
  class: 'pointer-events-none m-0 max-w-64 rounded-lg bg-ink px-3 py-2 text-xs text-page shadow-float [inset:auto]'
});
document.body.append(tip);

let current: HTMLElement | null = null;
let timer = 0;

function hide(): void {
  window.clearTimeout(timer);
  current = null;
  if (tip.matches(':popover-open')) tip.hidePopover();
}

function show(target: HTMLElement): void {
  const text = target.dataset.tip;
  if (!text) return;
  tip.textContent = text;
  if (!tip.matches(':popover-open')) tip.showPopover();
  const anchor = target.getBoundingClientRect();
  const box = { width: tip.offsetWidth, height: tip.offsetHeight };
  const left = Math.min(Math.max(GAP, anchor.left + anchor.width / 2 - box.width / 2), window.innerWidth - box.width - GAP);
  const below = anchor.bottom + GAP + box.height <= window.innerHeight;
  tip.style.left = `${left}px`;
  tip.style.top = `${below ? anchor.bottom + GAP : anchor.top - box.height - GAP}px`;
}

function claim(event: Event): HTMLElement | null {
  const target = (event.target as Element | null)?.closest<HTMLElement>('[title], [data-tip]') ?? null;
  if (!target) return null;
  const title = target.getAttribute('title');
  if (title) {
    target.dataset.tip = title;
    if (!target.hasAttribute('aria-label') && !target.textContent?.trim()) target.setAttribute('aria-label', title);
    target.removeAttribute('title');
  }
  return target;
}

document.addEventListener('pointerover', (event) => {
  const target = claim(event);
  if (target === current) return;
  hide();
  if (!target) return;
  current = target;
  timer = window.setTimeout(() => show(target), DELAY);
});

document.addEventListener('pointerout', (event) => {
  if (current && !current.contains((event as PointerEvent).relatedTarget as Node | null)) hide();
});

document.addEventListener('focusin', (event) => {
  const target = claim(event);
  if (!target || !target.matches(':focus-visible')) return;
  hide();
  current = target;
  show(target);
});

document.addEventListener('focusout', hide);
document.addEventListener('pointerdown', hide);
document.addEventListener('scroll', hide, true);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hide();
});
