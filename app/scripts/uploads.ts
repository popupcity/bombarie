import { h } from './dom.ts';

export interface Tile {
  state(text: string): void;
  remove(): void;
}

export function uploadTile(container: HTMLElement, name: string): Tile {
  const label = h('p', { class: 'truncate text-sm text-ink-soft' }, `${name} · waiting…`);
  const shape = h('div', { class: 'aspect-square animate-pulse rounded-lg bg-track motion-reduce:animate-none' });
  const tile = h('li', { 'aria-busy': 'true', class: 'flex min-w-0 flex-col gap-2' }, shape, label);
  container.append(tile);
  return {
    state: (text) => {
      label.textContent = `${name} · ${text}`;
    },
    remove: () => tile.remove()
  };
}
