import { FLOAT, OVERLAY, SWAPPED } from '../lib/ui.ts';
import { h } from './dom.ts';

const DELAY = 350;
const GAP = 8;

const FIXED = 'pointer-events-none m-0 [inset:auto]';
const PLAIN = `${OVERLAY} ${FIXED} max-w-64 whitespace-pre-line rounded-lg bg-ink px-3 py-2 text-xs text-page shadow-float`;
const CARD = `${FLOAT} ${FIXED} max-w-[calc(100vw-16px)] p-0`;

const tip = h('div', { popover: 'manual', role: 'tooltip' });
document.body.append(tip);

let current: HTMLElement | null = null;
let timer = 0;

function hide(): void {
  window.clearTimeout(timer);
  current = null;
  if (tip.matches(':popover-open')) tip.hidePopover();
}

function above(anchor: DOMRect, box: { width: number; height: number }): { left: number; top: number } {
  const below = anchor.bottom + GAP + box.height <= window.innerHeight;
  return { left: within(anchor.left + anchor.width / 2 - box.width / 2, box.width, window.innerWidth), top: below ? anchor.bottom + GAP : anchor.top - box.height - GAP };
}

function beside(anchor: DOMRect, box: { width: number; height: number }): { left: number; top: number } {
  const right = anchor.right + GAP;
  const left = anchor.left - GAP - box.width;
  const side = right + box.width <= window.innerWidth - GAP ? right : left >= GAP ? left : null;
  if (side !== null) return { left: side, top: within(anchor.top, box.height, window.innerHeight) };
  const over = anchor.top - box.height - GAP;
  return { left: above(anchor, box).left, top: over >= GAP ? over : anchor.bottom + GAP };
}

const within = (at: number, size: number, room: number): number => Math.min(Math.max(GAP, at), room - size - GAP);

function show(target: HTMLElement): void {
  const card = target.getAttribute('data-card');
  const filled = card ? (document.getElementById(card) as HTMLTemplateElement | null) : null;
  const text = target.getAttribute('data-tip');
  if (!filled && !text) return;
  tip.className = filled ? CARD : PLAIN;
  tip.replaceChildren(filled ? filled.content.cloneNode(true) : text!);
  if (!tip.matches(':popover-open')) tip.showPopover();
  const anchor = target.getBoundingClientRect();
  const spot = (filled ? beside : above)(anchor, { width: tip.offsetWidth, height: tip.offsetHeight });
  tip.style.left = `${spot.left}px`;
  tip.style.top = `${spot.top}px`;
}

function claim(event: Event): HTMLElement | null {
  const target = (event.target as Element | null)?.closest<HTMLElement>('[title], [data-tip], [data-card]') ?? null;
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
window.addEventListener('resize', hide);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hide();
});

document.addEventListener(SWAPPED, hide);
