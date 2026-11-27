export async function moving(change: () => void): Promise<void> {
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return change();
  await document.startViewTransition(change).updateCallbackDone;
}

export function movable(element: HTMLElement, name: string): void {
  element.style.setProperty('view-transition-name', name);
  element.style.setProperty('view-transition-class', 'item');
}

const still = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export async function resize(element: HTMLElement, from: number, to: number): Promise<void> {
  if (still() || from === to) return;
  const time = token('--duration-pop');
  element.classList.add('overflow-hidden');
  const animation = element.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: parseFloat(time) * (time.endsWith('ms') ? 1 : 1000), easing: token(to > from ? '--ease-pop' : '--ease-leave'), fill: 'forwards' });
  await animation.finished.catch(() => undefined);
  animation.cancel();
  element.classList.remove('overflow-hidden');
}
