import { icons } from '@popupcity/ui/src/components/icons.ts';
import { h } from './dom.ts';

export interface Tile {
  state(text: string): void;
  remove(): void;
}

export function uploadTile(container: HTMLElement, name: string): Tile {
  const said = h('span', { class: 'shrink-0' }, 'waiting…');
  const mark = h('span', { 'aria-hidden': 'true', class: 'inline-block size-[1em] shrink-0 [&>svg]:size-full' });
  mark.innerHTML = icons.regular.dot;
  const label = h('p', { class: 'flex min-w-0 items-center text-sm text-ink-soft' }, h('span', { class: 'truncate' }, name), mark, said);
  const shape = h('div', { class: 'aspect-square animate-pulse rounded-lg bg-track motion-reduce:animate-none' });
  const tile = h('li', { 'aria-busy': 'true', class: 'flex min-w-0 flex-col gap-2' }, shape, label);
  container.append(tile);
  return {
    state: (text) => {
      said.textContent = text;
    },
    remove: () => tile.remove()
  };
}
