import { OVERLAY } from '../lib/ui.ts';
import { icons } from 'ui/src/components/icons.ts';
import { addDays, addMonths, monthLabel, monthWeeks } from '../../src/calendar.ts';
import { clock, parseClock, whenLabel, ymd } from '../../src/time.ts';
import { h } from './dom.ts';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const NAV = 'grid size-8 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-page hover:text-ink';
let counter = 0;

const icon = (name: 'caret-right', flip = false): HTMLElement => {
  const node = h('span', { 'aria-hidden': 'true', class: `inline-block size-4 [&>svg]:size-full ${flip ? 'rotate-180' : ''}` });
  node.innerHTML = icons.regular[name];
  return node;
};

function open(button: HTMLElement, input: HTMLInputElement) {
  const existing = button.nextElementSibling;
  if (existing instanceof HTMLElement && existing.dataset.picker !== undefined) existing.remove();

  const id = `picker-${(counter += 1)}`;
  const today = ymd(new Date());
  let date = input.value.slice(0, 10) || today;
  let time = input.value.slice(11, 16) || '09:00';
  let view = date.slice(0, 7);
  const initial = input.value;
  let picked = false;

  const panel = h('div', {
    id,
    popover: '',
    'data-picker': '',
    role: 'dialog',
    'aria-label': 'Pick a date and time',
    class: `${OVERLAY} m-0 flex w-80 flex-col gap-4 rounded-xl bg-surface p-4 text-sm text-ink shadow-float ring-1 ring-line ring-inset [inset:auto]`
  });
  button.after(panel);

  const commit = () => {
    picked = true;
    input.value = `${date}T${time}`;
    (button.querySelector<HTMLElement>('[data-date-label]') ?? button).textContent = whenLabel(input.value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const focusDay = (day: string) => {
    panel.querySelector<HTMLElement>(`[data-day="${day}"]`)?.focus();
  };

  const move = (day: string) => {
    if (day.slice(0, 7) !== view) {
      view = day.slice(0, 7);
      render();
    }
    focusDay(day);
  };

  function place() {
    const anchor = button.getBoundingClientRect();
    const gap = 8;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    if (panel.offsetHeight > vh - gap * 2) {
      panel.style.maxHeight = `${vh - gap * 2}px`;
      panel.style.overflowY = 'auto';
    }
    const box = { width: panel.offsetWidth, height: panel.offsetHeight };
    const room = { below: vh - anchor.bottom - gap * 2, above: anchor.top - gap * 2 };
    const side = box.height <= room.below ? 'below' : box.height <= room.above ? 'above' : room.below >= room.above ? 'below' : 'above';
    const wanted = side === 'below' ? anchor.bottom + gap : anchor.top - box.height - gap;
    panel.style.left = `${Math.min(Math.max(gap, anchor.left), vw - box.width - gap)}px`;
    panel.style.top = `${Math.min(Math.max(gap, wanted), vh - box.height - gap)}px`;
  }

  function render() {
    const weeks = monthWeeks([], view, today);
    while (weeks.length < 6) {
      const start = addDays(weeks[weeks.length - 1]?.[6]?.day ?? today, 1);
      weeks.push(
        Array.from({ length: 7 }, (_, index) => {
          const day = addDays(start, index);
          return { day, date: Number(day.slice(8)), inMonth: false, today: day === today, past: day < today, cards: [] };
        })
      );
    }
    const grid = h(
      'div',
      { role: 'grid', 'aria-label': monthLabel(view), class: 'grid gap-1' },
      h('div', { role: 'row', class: 'grid grid-cols-7 text-center text-xs text-ink-soft' }, ...WEEKDAYS.map((name) => h('span', { role: 'columnheader', class: 'py-1' }, name))),
      ...weeks.map((week) =>
        h(
          'div',
          { role: 'row', class: 'grid grid-cols-7' },
          ...week.map((day) =>
            h(
              'span',
              { role: 'gridcell', 'aria-selected': String(day.day === date), class: 'flex justify-center' },
              h(
                'button',
                {
                  type: 'button',
                  'data-day': day.day,
                  'data-plain': '',
                  tabindex: day.day === date ? '0' : '-1',
                  'aria-label': day.day,
                  class: `mx-auto grid size-10 cursor-pointer place-items-center rounded-lg tabular-nums focus-visible:outline-2 focus-visible:outline-ink ${
                    day.day === date ? 'bg-ink text-page' : `hover:bg-track ${day.today ? 'ring-1 ring-ink ring-inset' : day.inMonth ? '' : 'text-ink-soft'}`
                  }`,
                  onclick: () => {
                    date = day.day;
                    view = date.slice(0, 7);
                    commit();
                    if (input.dataset.submit === 'always') return panel.hidePopover();
                    render();
                    focusDay(date);
                  },
                  onkeydown: (event) => {
                    const key = (event as KeyboardEvent).key;
                    const next =
                      key === 'ArrowLeft' ? addDays(day.day, -1)
                      : key === 'ArrowRight' ? addDays(day.day, 1)
                      : key === 'ArrowUp' ? addDays(day.day, -7)
                      : key === 'ArrowDown' ? addDays(day.day, 7)
                      : key === 'PageUp' ? addDays(day.day, -30)
                      : key === 'PageDown' ? addDays(day.day, 30)
                      : null;
                    if (next === null) return;
                    event.preventDefault();
                    move(next);
                  }
                },
                String(day.date)
              )
            )
          )
        )
      )
    );

    const timeField = h('input', {
      type: 'text',
      inputmode: 'numeric',
      autocomplete: 'off',
      value: time,
      'aria-label': 'Time, 24 hours',
      placeholder: '09:30',
      class: 'h-10 w-20 rounded-lg bg-page px-2 text-center tabular-nums ring-1 ring-line ring-inset focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ink'
    });
    const apply = () => {
      const parsed = parseClock(timeField.value);
      if (parsed === null) {
        timeField.value = time;
        return;
      }
      time = parsed;
      timeField.value = parsed;
      commit();
    };
    timeField.addEventListener('change', apply);
    timeField.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      apply();
      panel.hidePopover();
      button.focus();
    });

    panel.replaceChildren(
      h(
        'div',
        { class: 'flex items-center justify-between' },
        h('button', { type: 'button', 'aria-label': 'Previous month', class: NAV, onclick: () => ((view = addMonths(view, -1)), render()) }, icon('caret-right', true)),
        h('span', { 'aria-live': 'polite' }, monthLabel(view)),
        h('button', { type: 'button', 'aria-label': 'Next month', class: NAV, onclick: () => ((view = addMonths(view, 1)), render()) }, icon('caret-right'))
      ),
      grid,
      h(
        'div',
        { class: '-mx-4 flex items-center justify-between gap-4 border-t border-line px-4 pt-4' },
        h(
          'button',
          {
            type: 'button',
            class: 'h-10 cursor-pointer rounded-lg px-6 text-ink ring-1 ring-ink ring-inset hover:opacity-(--hover-opacity) focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ink', 'data-tone': 'ink',
            onclick: () => {
              const now = new Date();
              date = ymd(now);
              time = clock(now);
              commit();
              panel.hidePopover();
              button.focus();
            }
          },
          'Now'
        ),
        h('span', { class: 'ml-auto text-ink-soft' }, 'Time'),
        timeField
      )
    );
  }

  render();
  panel.showPopover();
  place();
  panel.addEventListener('toggle', (event) => {
    if ((event as ToggleEvent).newState === 'closed') {
      if (input.dataset.submit !== undefined && (input.value !== initial || (input.dataset.submit === 'always' && picked))) input.form?.requestSubmit();
      setTimeout(() => {
        if (panel.matches(':popover-open')) return;
        panel.remove();
      }, 200);
    }
  });
  focusDay(date);
}

document.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLElement>('[data-date-open]');
  if (!button) return;
  const input = button.parentElement?.querySelector<HTMLInputElement>('[data-date-input]');
  if (input) open(button, input);
});
