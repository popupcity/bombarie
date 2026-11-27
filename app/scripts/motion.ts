export async function moving(change: () => void): Promise<void> {
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return change();
  await document.startViewTransition(change).updateCallbackDone;
}

export function movable(element: HTMLElement, name: string): void {
  element.style.setProperty('view-transition-name', name);
  element.style.setProperty('view-transition-class', 'item');
}
