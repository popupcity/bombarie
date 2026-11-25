import type { Status } from '../../src/calendar.ts';

export const brand = 'bombarie';
export const brandName = 'Bombarie';

export const OVERLAY =
  'origin-top -translate-y-1 scale-98 opacity-0 transition-[opacity,scale,translate,overlay,display] duration-(--duration-pop) ease-pop transition-discrete open:translate-y-0 open:scale-100 open:opacity-100 starting:open:-translate-y-1 starting:open:scale-98 starting:open:opacity-0';
export const DIALOG = `${OVERLAY} backdrop:opacity-0 backdrop:transition-[opacity,overlay,display] backdrop:duration-(--duration-pop) backdrop:ease-pop backdrop:transition-discrete open:backdrop:opacity-100 starting:open:backdrop:opacity-0`;

export const MENU = `${OVERLAY} m-0 rounded-xl bg-surface p-2 text-sm text-ink shadow-float ring-1 ring-line ring-inset`;
export const MENU_ITEM =
  'flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-page focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ink';


export const jsonForScript = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

export const postHref = (id: string): string => {
  const [folder = '', file = ''] = id.split('/');
  return `/posts/${encodeURIComponent(folder)}/${encodeURIComponent(file.replace(/\.md$/, ''))}`;
};

export const STATUS_TONE: Record<Status, string> = {
  posted: 'ok',
  planned: 'info',
  posting: 'info',
  draft: 'warn',
  reminded: 'manual',
  late: 'bad',
  failed: 'bad',
  unconfirmed: 'bad',
  deleted: 'paper'
};

export const TINTED = 'bg-(--tone-soft) text-(--tone-text)';

export const SEGMENT_CLASS: Record<string, string> = {
  text: '',
  mention: 'text-(--tone-text)',
  handle: 'text-(--tone-text)',
  plain: 'underline decoration-dotted underline-offset-4',
  unknown: 'text-(--tone-text) ring-1 ring-(--tone-text) ring-inset rounded-sm px-1'
};

export const SEGMENT_TONE: Record<string, string> = { mention: 'info', handle: 'info', unknown: 'bad' };

export function cardActions(card: { status: Status; url?: string }) {
  if (card.url !== undefined) return { toggles: null, movable: false, removable: false, any: false };
  const toggles = card.status === 'draft' ? { action: 'plan', label: 'Plan' } : card.status === 'planned' ? { action: 'draft', label: 'Back to draft' } : null;
  const movable = card.status === 'draft' || card.status === 'planned' || card.status === 'late';
  const removable = !['posting', 'unconfirmed'].includes(card.status);
  return { toggles, movable, removable, any: toggles !== null || movable || removable };
}

export const quiet = { 'data-bwignore': true, 'data-1p-ignore': true, 'data-lpignore': 'true', autocomplete: 'off' };

export const CHIP = 'inline-flex h-(--control-md) items-center gap-3 rounded-lg text-sm text-ink-soft ring-1 ring-line ring-inset hover:ring-line-strong aria-[current=page]:bg-surface aria-[current=page]:text-ink aria-[current=page]:ring-ink aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:ring-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ink';
