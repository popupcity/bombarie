import { icons } from 'ui/src/components/icons.ts';
import { h } from './dom.ts';
import { suggest, triggerAt } from '../../src/mentions.ts';
import type { Entities, Entity, Trigger } from '../../src/mentions.ts';

const COPY = [
  'boxSizing',
  'width',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing'
] as const;

const MARKS = { linkedin: 'bg-linkedin', instagram: 'bg-instagram' } as const;

function caretAt(area: HTMLTextAreaElement, position: number): { x: number; y: number; height: number } {
  const style = getComputedStyle(area);
  const mirror = document.createElement('div');
  for (const property of COPY) mirror.style[property] = style[property];
  Object.assign(mirror.style, {
    position: 'absolute',
    visibility: 'hidden',
    top: '0',
    left: '-9999px',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word'
  });
  mirror.textContent = area.value.slice(0, position);
  const marker = document.createElement('span');
  marker.textContent = area.value.slice(position) || '.';
  mirror.append(marker);
  document.body.append(mirror);
  const found = { x: marker.offsetLeft, y: marker.offsetTop, height: parseFloat(style.lineHeight) || 24 };
  mirror.remove();
  return found;
}

function mark(platform: keyof typeof MARKS, present: boolean): HTMLElement {
  const glyph = h('span', {
    class: `inline-flex size-4 items-center justify-center rounded-sm text-white ${MARKS[platform]}${present ? '' : ' opacity-(--dim)'}`,
    title: present ? `has a ${platform} id` : `no ${platform} id`
  });
  glyph.innerHTML = icons.fill[`${platform}-logo`];
  glyph.firstElementChild?.setAttribute('class', 'size-[65%]');
  return glyph;
}

export function autocomplete(area: HTMLTextAreaElement, kind: Trigger, entities: Entities, platform: string) {
  const list = h('div', {
    id: `${area.id}-suggestions`,
    role: 'listbox',
    hidden: true,
    class: 'absolute z-20 w-72 overflow-hidden rounded-xl bg-surface p-2 text-sm shadow-float ring-1 ring-line ring-inset transition-[opacity,scale,translate,display] transition-discrete starting:-translate-y-1 starting:scale-98 starting:opacity-0 [&[hidden]]:-translate-y-1 [&[hidden]]:scale-98 [&[hidden]]:opacity-0'
  });
  area.parentElement?.append(list);
  area.setAttribute('aria-autocomplete', 'list');
  area.setAttribute('aria-controls', list.id);

  let found: Entity[] = [];
  let active = 0;
  let start = 0;

  const open = () => !list.hidden && found.length > 0;
  const close = () => {
    list.hidden = true;
    found = [];
    area.removeAttribute('aria-activedescendant');
  };

  function render() {
    list.replaceChildren(
      ...found.map((entity, index) =>
        h(
          'div',
          {
            id: `${list.id}-${index}`,
            role: 'option',
            'aria-selected': String(index === active),
            class: 'flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 aria-selected:bg-page',
            onmousedown: (event) => {
              event.preventDefault();
              accept(index);
            }
          },
          h('span', {}, entity.name),
          h('span', { class: 'flex gap-1' }, ...(platform === 'linkedin' ? [mark('linkedin', entity.linkedin !== undefined)] : platform === 'instagram' || platform === 'threads' ? [mark('instagram', entity.instagram !== undefined)] : []))
        )
      )
    );
    area.setAttribute('aria-activedescendant', `${list.id}-${active}`);
  }

  function refresh() {
    const trigger = triggerAt(area.value, area.selectionStart, kind);
    const matches = trigger ? suggest(trigger.query, entities) : [];
    if (!trigger || matches.length === 0) return close();
    found = matches;
    start = trigger.start;
    active = Math.min(active, found.length - 1);
    render();
    const spot = caretAt(area, start);
    list.style.left = `${Math.min(area.offsetLeft + spot.x - area.scrollLeft, area.offsetLeft + area.clientWidth - 288)}px`;
    list.style.top = `${area.offsetTop + spot.y - area.scrollTop + spot.height + 4}px`;
    list.hidden = false;
  }

  function accept(index: number) {
    const entity = found[index];
    if (!entity) return;
    const end = area.selectionStart;
    const tail = kind === 'wiki' && area.value.slice(end, end + 2) === ']]' ? end + 2 : end;
    area.setRangeText(kind === 'wiki' ? `[[${entity.name}]]` : `@${entity.name}`, start, tail, 'end');
    area.dispatchEvent(new Event('input', { bubbles: true }));
    close();
  }

  area.addEventListener('input', (event) => {
    if (!(event as InputEvent).isComposing) refresh();
  });
  area.addEventListener('click', refresh);
  area.addEventListener('blur', close);
  area.addEventListener('keyup', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) refresh();
  });
  area.addEventListener('keydown', (event) => {
    if (!open() || event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      active = (active + (event.key === 'ArrowDown' ? 1 : found.length - 1)) % found.length;
      render();
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      accept(active);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
}
