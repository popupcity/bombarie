import { roomOf, spotFor } from '../../src/place.ts';
import type { View } from '../../src/place.ts';

const floating = new Map<HTMLElement, HTMLElement>();

const viewNow = (): View => {
  const seen = window.visualViewport;
  return seen ? { left: seen.offsetLeft, top: seen.offsetTop, width: seen.width, height: seen.height } : { left: 0, top: 0, width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
};

function put(panel: HTMLElement, anchor: HTMLElement): void {
  const view = viewNow();
  Object.assign(panel.style, { margin: '0', maxHeight: `${roomOf(view)}px`, overflowY: 'auto' });
  const spot = spotFor(anchor.getBoundingClientRect(), { width: panel.offsetWidth, height: panel.offsetHeight }, view, {
    align: panel.dataset.float === 'end' ? 'end' : 'start',
    side: panel.dataset.side === 'above' ? 'above' : 'below'
  });
  Object.assign(panel.style, { left: `${spot.left}px`, top: `${spot.top}px` });
}

export function float(panel: HTMLElement, anchor: HTMLElement): void {
  floating.set(panel, anchor);
  put(panel, anchor);
}

let frame = 0;
function follow(event: Event): void {
  const moved = event.target;
  if (frame || (moved instanceof Node && [...floating.keys()].some((panel) => panel.contains(moved)))) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    for (const [panel, anchor] of floating) {
      if (!panel.isConnected || !anchor.isConnected || !panel.matches(':popover-open')) floating.delete(panel);
      else put(panel, anchor);
    }
  });
}

document.addEventListener('scroll', follow, true);
window.addEventListener('resize', follow);
window.visualViewport?.addEventListener('resize', follow);
window.visualViewport?.addEventListener('scroll', follow);
