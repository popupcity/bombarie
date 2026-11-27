import { cardFace, focus, looks } from '@popupcity/ui/src/components/looks.ts';
import type { Status } from '../../src/calendar.ts';

export const brand = 'bombarie';
export const brandName = 'Bombarie';

export const CARET = 'transition-[rotate] in-aria-expanded:rotate-180';

export const OVERLAY =
  'origin-top -translate-y-1 scale-98 opacity-0 ease-leave open:ease-pop transition-[opacity,scale,translate,overlay,display] transition-discrete open:translate-y-0 open:scale-100 open:opacity-100 starting:open:-translate-y-1 starting:open:scale-98 starting:open:opacity-0';
export const DIALOG = `${OVERLAY} backdrop:opacity-0 backdrop:ease-leave open:backdrop:ease-pop backdrop:transition-[opacity,overlay,display] backdrop:transition-discrete open:backdrop:opacity-100 starting:open:backdrop:opacity-0`;

export const FLOAT = `${OVERLAY} mx-0 my-1 rounded-xl bg-surface text-sm text-ink shadow-float ring-1 ring-line ring-inset`;
export const MENU = `${FLOAT} p-2`;
export const PANEL = `${FLOAT} p-4`;
const ROW = 'flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ink';

export const MENU_ITEM = `${ROW} transition hover:bg-(--tone-hover)`;

export const NAV_ITEM = `${ROW} transition not-aria-[current=page]:hover:bg-(--tone-hover)`;


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

export const segmentLook = (platform: string, kind: string): { class: string | undefined; tone: string | undefined } =>
  platform === 'linkedin' && (kind === 'mention' || kind === 'link') ? { class: 'font-semibold text-linkedin', tone: undefined } : { class: SEGMENT_CLASS[kind], tone: SEGMENT_TONE[kind] };

const SEGMENT_CLASS: Record<string, string> = {
  text: '',
  mention: 'text-(--tone-text)',
  handle: 'text-(--tone-text)',
  plain: 'underline decoration-dotted underline-offset-4',
  unknown: 'text-(--tone-text) ring-1 ring-(--tone-text) ring-inset rounded-sm px-1'
};

const SEGMENT_TONE: Record<string, string> = { mention: 'info', handle: 'info', unknown: 'bad' };

export function cardActions(card: { status: Status; url?: string }) {
  if (card.url !== undefined) return { toggles: null, movable: false, removable: false, any: false };
  const toggles = card.status === 'draft' ? { action: 'plan', label: 'Plan' } : card.status === 'planned' || card.status === 'reminded' ? { action: 'draft', label: 'Back to draft' } : null;
  const movable = ['draft', 'planned', 'late', 'reminded'].includes(card.status);
  const removable = !['posting', 'unconfirmed'].includes(card.status);
  return { toggles, movable, removable, any: toggles !== null || movable || removable };
}

export const quiet = { 'data-bwignore': true, 'data-1p-ignore': true, 'data-lpignore': 'true', autocomplete: 'off' };

export const SCHEME_COOKIE = 'bombarie_scheme';

export const RAIL_COOKIE = 'bombarie_rail';

export const SERIES = ['fill-series-1', 'fill-series-2', 'fill-series-3', 'fill-series-4'];

export const schemeOf = (value: string | undefined): 'light' | 'dark' | undefined => (value === 'light' || value === 'dark' ? value : undefined);

export const HTML_CLASS = 'scheme-light-dark data-[scheme=light]:scheme-light data-[scheme=dark]:scheme-dark scroll-smooth bg-page';

export const plannedText = (manual: boolean, ago = 0): string => {
  if (!manual) return 'Posts by itself at the date.';
  if (ago <= 0) return 'You get a reminder at the date.';
  return ago <= 24 * 60 * 60_000 ? 'That time has passed: the reminder comes right away.' : 'That time has passed, so no reminder comes.';
};

export const VISIBLE_CHIPS = 3;
export const SWAPPED = 'bombarie:swapped';

export const githubAvatar = (login: string): string => `https://github.com/${encodeURIComponent(login)}.png?size=64`;

export const STATIC_CHIP = 'inline-flex h-(--control-md) items-center gap-3 rounded-lg bg-surface pr-4 text-sm ring-1 ring-line ring-inset';

export const FADE_BELOW = 'after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-8 after:bg-linear-to-b after:from-page after:to-transparent';

export const FADE_ABOVE = 'before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-8 before:bg-linear-to-t before:from-page before:to-transparent';

const DOT_ORDER = ['bad', 'info', 'warn', 'manual', 'ok', 'feed'];

export const dotTones = (tones: string[]): string[] =>
  tones
    .filter((tone) => DOT_ORDER.includes(tone))
    .sort((a, b) => DOT_ORDER.indexOf(a) - DOT_ORDER.indexOf(b))
    .slice(0, 3);

export const dotClass = (tone: string): string => `size-1 rounded-full ${tone === 'feed' ? 'bg-ink-faint' : 'bg-(--tone)'}`;

export const OUTLINE = `transition h-10 cursor-pointer rounded-lg px-6 ${looks.outline} ${focus}`;

export const CARD_HEADING = `text-lg ${cardFace}`;

export const SEGMENTS = 'inline-flex h-10 rounded-lg text-sm ring-1 ring-line ring-inset';
export const SEGMENT = 'transition inline-flex h-full cursor-pointer items-center gap-2 rounded-lg px-4 text-ink-soft not-aria-pressed:not-aria-[current=page]:hover:bg-(--tone-hover) aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:ring-1 aria-pressed:ring-line-strong aria-pressed:ring-inset aria-[current=page]:bg-surface aria-[current=page]:text-ink aria-[current=page]:ring-1 aria-[current=page]:ring-line-strong aria-[current=page]:ring-inset';

export interface By {
  name: string;
  said: string;
}
export const byWhom = (name: string | undefined, said: string): By | undefined => (name ? { name, said: `${said} by ${name}` } : undefined);
export const BY_PHOTO = 'size-8 rounded-lg';

export const FIELD = 'rounded-lg bg-surface p-4 md:p-6 leading-7 ring-1 ring-line ring-inset focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ink';
export const BOX = 'flex cursor-text flex-col gap-8 rounded-lg bg-surface p-4 md:p-6 ring-1 ring-line ring-inset has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-offset-0 has-[textarea:focus-visible]:outline-ink';
export const BOX_TEXT = 'block w-full resize-none field-sizing-content bg-transparent leading-7 outline-none';
export const BOX_MEDIA = 'group/media relative grid cursor-text grid-cols-3 items-start gap-3 sm:grid-cols-5 not-has-[li]:flex not-has-[li]:flex-wrap';
export const ADD_TILE = 'transition flex aspect-square cursor-pointer text-sm [font-family:var(--font-control)] [font-weight:var(--weight-control)] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong p-2 text-center group-not-has-[li]/media:aspect-auto group-not-has-[li]/media:h-10 group-not-has-[li]/media:w-fit group-not-has-[li]/media:flex-row group-not-has-[li]/media:px-4 group-not-has-[li]/media:py-0 text-ink-soft hover:border-ink-soft hover:text-ink';

export const WEEK_ROW = 'grid grid-cols-7 gap-1';

export const QUIET = 'transition grid shrink-0 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-(--tone-hover) hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ink';

export const CHIP = 'transition inline-flex h-(--control-md) items-center gap-3 rounded-lg text-sm text-ink-soft ring-1 ring-line ring-inset not-aria-pressed:not-aria-[current]:hover:bg-(--tone-hover) aria-[current]:bg-surface aria-[current]:text-ink aria-[current]:ring-line-strong aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:ring-line-strong focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ink';
