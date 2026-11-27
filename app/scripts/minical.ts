import { icons } from 'ui/src/components/icons.ts';
import { addMonths, monthLabel, monthWeeks } from '../../src/calendar.ts';
import { CARET, dotClass, dotTones, QUIET, SWAPPED } from '../lib/ui.ts';
import { h } from './dom.ts';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const NAV = `${QUIET} size-8`;

let listening: AbortController | undefined;

function start() {
  listening?.abort();
  listening = new AbortController();
  const root = document.getElementById('minical');
  const grid = document.getElementById('minical-grid');
  const panel = document.getElementById('minical-day');
  if (!root || !grid || !panel) return;
  const today = root.dataset.today ?? '';
  const groups = [...document.querySelectorAll<HTMLElement>('section[data-group]')];
  const days = groups.map((group) => group.id);
  const panels = new Map([...document.querySelectorAll<HTMLElement>('#minical-panels [data-panel]')].map((element) => [element.dataset.panel ?? '', element]));
  const tones = (day: string): string[] => dotTones([...(panels.get(day)?.querySelectorAll<HTMLElement>('[data-tone]') ?? [])].map((row) => row.dataset.tone ?? ''));
  let view = today.slice(0, 7);
  let active = '';
  let visible = new Set<string>();
  let pinned = '';
  let settleUntil = 0;
  let pinnedTarget = '';

  const caret = (flip: boolean): HTMLElement => {
    const node = h('span', { 'aria-hidden': 'true', class: `inline-block size-4 [&>svg]:size-full ${flip ? 'rotate-180' : ''}` });
    node.innerHTML = icons.regular['caret-right'];
    return node;
  };

  const down = (): HTMLElement => {
    const node = h('span', { 'aria-hidden': 'true', class: 'inline-block size-4 [&>svg]:size-full' });
    node.innerHTML = icons.regular['caret-down'];
    node.classList.add(...CARET.split(' '));
    return node;
  };

  const target = (day: string): string | undefined => days.find((candidate) => candidate >= day) ?? days.at(-1);

  const go = (day: string) => {
    pinned = day;
    pinnedTarget = target(day) ?? '';
    settleUntil = Date.now() + 1500;
    const element = pinnedTarget ? document.getElementById(pinnedTarget) : null;
    if (element) element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    render();
  };

  const focus = (): string => pinned || active || today;

  function renderGrid() {
    const weeks = monthWeeks([], view, today);
    const chosen = focus();
    grid!.replaceChildren(
      h(
        'div',
        { class: 'flex items-center justify-between' },
        h('button', { type: 'button', 'aria-label': 'Previous month', class: NAV, onclick: () => ((view = addMonths(view, -1)), render()) }, caret(true)),
        h('span', { 'aria-live': 'polite', class: 'text-base' }, monthLabel(view)),
        h('button', { type: 'button', 'aria-label': 'Next month', class: NAV, onclick: () => ((view = addMonths(view, 1)), render()) }, caret(false))
      ),
      h('div', { class: 'grid grid-cols-7 gap-2 text-center text-xs text-ink-soft' }, ...WEEKDAYS.map((name) => h('span', { class: 'py-1' }, name))),
      h(
        'div',
        { class: 'grid grid-cols-7 gap-2' },
        ...weeks.flat().map((day) => {
          const selected = day.day === chosen;
          const dots = tones(day.day);
          return h(
            'button',
            {
              type: 'button',
              'data-day': day.day,
              'data-plain': '',
              'data-drop-day': day.day,
              'aria-label': day.day,
              'aria-current': day.today ? 'date' : undefined,
              class: `relative grid h-8 cursor-pointer place-items-center rounded-lg pb-1 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-ink ${
                selected ? 'bg-ink text-page' : `transition hover:bg-(--tone-hover) ${day.today ? 'ring-1 ring-ink ring-inset' : ''} ${day.inMonth ? (dots.length > 0 ? 'text-ink' : 'text-ink-soft') : 'text-ink-faint'}`
              }`,
              onclick: () => go(day.day)
            },
            String(day.date),
            dots.length > 0
              ? h('span', { 'aria-hidden': 'true', class: 'absolute bottom-1 flex gap-1' }, ...dots.map((tone) => h('span', { 'data-tone': tone, class: dotClass(tone) })))
              : ''
          );
        })
      )
    );
  }

  function renderDay() {
    const day = focus();
    const empty = !panels.has(day);
    const plan = day >= today;
    panel!.hidden = !empty || !plan;
    if (!empty || !plan) return;
    const when = new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    panel!.replaceChildren(
      h('h3', { class: 'text-base' }, day === today ? `Today, ${when}` : when),
      h('p', { class: 'text-sm text-ink-soft' }, 'Nothing planned.'),
      h('button', { type: 'button', popovertarget: 'new-menu', 'data-day': day, class: 'transition inline-flex h-10 w-fit cursor-pointer items-center gap-2 rounded-lg px-6 text-sm text-ink ring-1 ring-ink ring-inset hover:opacity-(--hover-opacity) focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ink' }, 'Plan a post', down())
    );
  }

  function render() {
    renderGrid();
    renderDay();
  }

  let waiting = false;
  function spy() {
    waiting = false;
    const shown = groups
      .filter((group) => {
        const box = group.getBoundingClientRect();
        return box.bottom > 100 && box.top < window.innerHeight;
      })
      .map((group) => group.id);
    let above: HTMLElement | undefined = groups[0];
    for (const group of groups) {
      if (group.getBoundingClientRect().top <= 160) above = group;
      else break;
    }
    const first = shown[0] ?? (above ? above.id : '');
    if (pinned && Date.now() > settleUntil && first !== pinnedTarget) pinned = '';
    const key = `${first}|${shown.join(',')}|${pinned}`;
    if (key === `${active}|${[...visible].join(',')}|${pinned}` && view === (pinned || first).slice(0, 7)) return;
    active = first;
    visible = new Set(shown);
    const shownDay = pinned || first;
    if (shownDay) view = shownDay.slice(0, 7);
    render();
  }

  window.addEventListener(
    'scroll',
    () => {
      if (waiting) return;
      waiting = true;
      requestAnimationFrame(spy);
    },
    { passive: true, signal: listening.signal }
  );
  spy();
  render();
}

start();
document.addEventListener(SWAPPED, start);
