import { h } from './dom.ts';

export interface Tile {
  state(text: string): void;
  remove(): void;
}

export function uploadTile(container: HTMLElement, name: string, options: { card?: boolean; prepend?: boolean } = {}): Tile {
  const label = h('p', { class: 'truncate text-sm text-ink-soft' }, `${name} · waiting…`);
  const shape = h('div', { class: `${options.card ? 'h-48' : 'aspect-[4/5]'} animate-pulse rounded-lg bg-track motion-reduce:animate-none` });
  const tile = h(
    'li',
    { 'aria-busy': 'true', class: options.card ? 'flex min-w-0 flex-col gap-4 rounded-xl bg-surface p-6 ring-1 ring-line ring-inset' : 'flex min-w-0 flex-col gap-2' },
    shape,
    label
  );
  if (options.prepend) container.prepend(tile);
  else container.append(tile);
  return {
    state: (text) => {
      label.textContent = `${name} · ${text}`;
    },
    remove: () => tile.remove()
  };
}
