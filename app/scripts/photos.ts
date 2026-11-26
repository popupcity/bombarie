import { h } from './dom.ts';
import { spinner } from './pending.ts';

const SHOW_AFTER = 150;
const seen = new Set<string>();

function watch(img: HTMLImageElement) {
  const source = img.getAttribute('src');
  if (!source || seen.has(source)) return;
  if (img.complete) {
    seen.add(source);
    return;
  }
  const unsized = !img.hasAttribute('width') && getComputedStyle(img).position !== 'absolute';
  img.classList.add('opacity-0');
  if (unsized) img.classList.add('min-h-40');
  let overlay: HTMLElement | undefined;
  const timer = setTimeout(() => {
    const host = img.parentElement;
    if (!host) return;
    if (getComputedStyle(host).position === 'static') host.classList.add('relative');
    overlay = h('span', { 'aria-hidden': 'true', class: 'pointer-events-none absolute grid place-items-center rounded-lg bg-track text-ink-soft' });
    Object.assign(overlay.style, { left: `${img.offsetLeft}px`, top: `${img.offsetTop}px`, width: `${img.offsetWidth}px`, height: `${img.offsetHeight}px` });
    overlay.innerHTML = spinner;
    img.before(overlay);
  }, SHOW_AFTER);
  img.addEventListener(
    'load',
    () => {
      clearTimeout(timer);
      seen.add(source);
      overlay?.remove();
      img.classList.remove('opacity-0', 'min-h-40');
    },
    { once: true }
  );
  img.addEventListener(
    'error',
    () => {
      clearTimeout(timer);
      overlay?.replaceChildren();
    },
    { once: true }
  );
}

const within = (node: Element): HTMLImageElement[] => [...(node.matches('img[data-photo]') ? [node as HTMLImageElement] : []), ...node.querySelectorAll<HTMLImageElement>('img[data-photo]')];

for (const img of within(document.body)) watch(img);
new MutationObserver((changes) => {
  for (const change of changes) {
    if (change.type === 'attributes') {
      if ((change.target as Element).matches('img[data-photo]')) watch(change.target as HTMLImageElement);
      continue;
    }
    for (const node of change.addedNodes) if (node instanceof Element) for (const img of within(node)) watch(img);
  }
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
