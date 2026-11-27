import { icons } from 'ui/src/components/icons.ts';
import { h } from './dom.ts';
import { QUIET } from '../lib/ui.ts';

type Tone = 'ok' | 'bad' | 'warn' | 'info';

const LIFETIME: Record<Tone, number> = { ok: 4000, warn: 8000, bad: 10000, info: 4000 };
const GLYPH: Record<Tone, string> = { ok: icons.regular.check, warn: icons.regular.warning, bad: icons.regular.warning, info: icons.regular.clock };

const host = (): HTMLElement =>
  document.getElementById('toasts') ??
  document.body.appendChild(h('div', { id: 'toasts', 'aria-live': 'polite', class: 'pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-3 px-4' }));

function dismiss(item: HTMLElement): void {
  item.classList.add('ease-leave', '-translate-y-1', 'scale-98', 'opacity-0');
  void Promise.allSettled(item.getAnimations().map((animation) => animation.finished)).then(() => item.remove());
}

export function working(text: string): () => void {
  const glyph = h('span', { 'aria-hidden': 'true', class: 'inline-block size-4 shrink-0 [&>svg]:size-full' });
  glyph.innerHTML = GLYPH.info;
  const item = h(
    'div',
    { 'data-tone': 'info', role: 'status', class: 'pointer-events-auto flex w-full max-w-lg items-center gap-3 rounded-xl bg-[color-mix(in_srgb,var(--tone)_22%,var(--surface))] px-4 py-3 text-sm text-(--tone-text) shadow-lg transition' },
    glyph,
    h('span', { class: 'min-w-0 flex-1' }, text)
  );
  host().append(item);
  return () => dismiss(item);
}

export function toast(text: string, tone: Tone = 'ok'): void {
  const glyph = h('span', { 'aria-hidden': 'true', class: 'inline-block size-4 shrink-0 [&>svg]:size-full' });
  glyph.innerHTML = GLYPH[tone];
  const close = h('button', { type: 'button', 'aria-label': 'Close', class: `${QUIET} size-8 [&>svg]:size-4`, onclick: () => dismiss(item) });
  close.innerHTML = icons.regular.x;
  const item = h(
    'div',
    {
      'data-tone': tone,
      role: tone === 'bad' ? 'alert' : 'status',
      class: 'pointer-events-auto flex w-full max-w-lg items-center gap-3 rounded-xl bg-[color-mix(in_srgb,var(--tone)_22%,var(--surface))] py-2 pr-2 pl-4 text-sm text-(--tone-text) shadow-float ring-1 ring-(--tone-text)/40 ring-inset transition starting:-translate-y-1 starting:scale-98 starting:opacity-0'
    },
    glyph,
    h('span', { class: 'min-w-0 flex-1' }, text),
    close
  );
  host().append(item);
  setTimeout(() => dismiss(item), LIFETIME[tone]);
}

const KEPT = 'social:toast';

export function toastAfterReload(text: string, tone: Tone): void {
  sessionStorage.setItem(KEPT, JSON.stringify({ text, tone }));
}

try {
  const kept = JSON.parse(sessionStorage.getItem(KEPT) ?? 'null') as { text: string; tone: Tone } | null;
  sessionStorage.removeItem(KEPT);
  if (kept) toast(kept.text, kept.tone);
} catch {
  sessionStorage.removeItem(KEPT);
}

for (const pending of document.querySelectorAll<HTMLElement>('[data-toast]')) {
  toast(pending.dataset.toast ?? '', (pending.dataset.tone as Tone | undefined) ?? 'ok');
  pending.remove();
}
