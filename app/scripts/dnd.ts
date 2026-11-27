import { act } from './inplace.ts';

const MIME = 'application/x-bombarie-card';
const INSIDE = ['outline-2', 'outline-ink', '-outline-offset-2'];
let over: HTMLElement | null = null;

const carries = (event: DragEvent): boolean => event.dataTransfer?.types.includes(MIME) ?? false;

function paint(target: HTMLElement, on: boolean): void {
  if (target.hasAttribute('data-group')) {
    target.toggleAttribute('data-drop-active', on);
    return;
  }
  for (const name of INSIDE) target.classList.toggle(name, on);
}

function clear(): void {
  if (over) paint(over, false);
  over = null;
}

async function move(id: string, day: string, time: string): Promise<void> {
  const body = new FormData();
  body.set('action', 'replan');
  body.set('id', id);
  body.set('day', day);
  body.set('date', `${day}T${time}`);
  return act(location.pathname, body);
}

document.addEventListener('dragstart', (event) => {
  const card = (event.target as Element).closest<HTMLElement>('[data-drag-id]');
  if (!card || !event.dataTransfer) return;
  event.dataTransfer.setData(MIME, JSON.stringify({ id: card.dataset.dragId, day: card.dataset.dragDay, time: card.dataset.dragTime }));
  event.dataTransfer.effectAllowed = 'move';
  const visual = card.querySelector<HTMLElement>('[data-drag-card]') ?? card;
  const box = visual.getBoundingClientRect();
  event.dataTransfer.setDragImage(visual, event.clientX - box.left, event.clientY - box.top);
  visual.classList.add('opacity-(--dim)');
  document.documentElement.toggleAttribute('data-dragging', true);
});

document.addEventListener('dragend', () => {
  for (const dragged of document.querySelectorAll('[data-drag-id] .opacity-(--dim), [data-drag-id].opacity-(--dim)')) dragged.classList.remove('opacity-(--dim)');
  clear();
  document.documentElement.removeAttribute('data-dragging');
});

const EDGE = 96;

function autoscroll(event: DragEvent): void {
  const top = EDGE - event.clientY;
  const bottom = event.clientY - (innerHeight - EDGE);
  const distance = top > 0 ? -top : bottom > 0 ? bottom : 0;
  if (distance !== 0) scrollBy({ top: Math.sign(distance) * Math.ceil((Math.min(Math.abs(distance), EDGE) / EDGE) * 28), behavior: 'instant' });
}

document.addEventListener('dragover', (event) => {
  if (!carries(event)) return;
  autoscroll(event);
  const target = (event.target as Element).closest<HTMLElement>('[data-drop-day]');
  if (!target) return clear();
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  if (target === over) return;
  clear();
  over = target;
  paint(target, true);
});

document.addEventListener('drop', (event) => {
  if (!carries(event)) return;
  const target = (event.target as Element).closest<HTMLElement>('[data-drop-day]');
  clear();
  document.documentElement.removeAttribute('data-dragging');
  if (!target) return;
  event.preventDefault();
  const card = JSON.parse(event.dataTransfer?.getData(MIME) ?? '{}') as { id?: string; day?: string; time?: string };
  const day = target.dataset.dropDay ?? '';
  if (!card.id || !card.time || !day || day === card.day) return;
  void move(card.id, day, card.time);
});
