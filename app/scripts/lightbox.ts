import { DIALOG } from '../lib/ui.ts';
import { icons } from 'ui/src/components/icons.ts';
import { h } from './dom.ts';

const button = 'absolute grid size-10 cursor-pointer place-items-center rounded-lg bg-surface text-ink hover:bg-page focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-white [&>svg]:size-5';

const stage = h('div', { class: 'grid size-full grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]' });
const arrow = (label: string, side: string, rotate: string, step: number) => {
  const node = h('button', { type: 'button', 'aria-label': label, title: label, class: `${button} top-1/2 -translate-y-1/2 ${side} ${rotate}`, onclick: () => go(step) });
  node.innerHTML = icons.regular['caret-right'];
  return node;
};
const close = h('button', { type: 'button', 'aria-label': 'Close', title: 'Close', class: `${button} top-8 right-8`, onclick: () => dialog.close() });
close.innerHTML = icons.regular.x;
const save = h('a', { 'aria-label': 'Download', title: 'Download', class: `${button} top-8 right-22` });
save.innerHTML = icons.regular['download-simple'];
const previous = arrow('Previous', 'left-8', 'rotate-180', -1);
const next = arrow('Next', 'right-8', '', 1);
const dialog = h('dialog', { 'aria-label': 'Preview', autofocus: true, tabindex: '-1', class: `${DIALOG} outline-none m-0 size-full max-h-none max-w-none bg-transparent p-4 text-ink backdrop:bg-scrim-strong backdrop:backdrop-blur-2xl md:p-24` }, stage, previous, next, save, close);
document.body.append(dialog);

let items: HTMLElement[] = [];
let index = 0;

let refit: () => void = () => {};

window.addEventListener('resize', () => refit());

function film(url: string): HTMLElement {
  const video = h('video', { src: url, controls: true, autoplay: true, playsinline: true, class: 'self-center justify-self-center rounded-lg bg-ink' }) as HTMLVideoElement;
  const fit = () => {
    const box = stage.getBoundingClientRect();
    if (!video.videoWidth || box.width === 0) return;
    const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
    video.style.width = `${Math.floor(video.videoWidth * scale)}px`;
    video.style.height = `${Math.floor(video.videoHeight * scale)}px`;
  };
  video.addEventListener('loadedmetadata', fit);
  refit = fit;
  return video;
}

function render(): void {
  const item = items[index];
  if (!item) return;
  const url = item.dataset.full ?? '';
  save.setAttribute('href', url);
  save.setAttribute('download', '');
  stage.replaceChildren(
    item.dataset.fullKind === 'pdf'
      ? h('iframe', { src: url, title: 'PDF', class: 'size-full max-w-4xl justify-self-center rounded-lg bg-surface' })
      : item.dataset.fullKind === 'video'
        ? film(url)
        : h('img', { src: url, alt: '', class: 'size-full object-contain' })
  );
  previous.hidden = next.hidden = items.length < 2;
}

function go(step: number): void {
  if (items.length < 2) return;
  index = (index + step + items.length) % items.length;
  render();
}

document.addEventListener(
  'click',
  (event) => {
    const target = (event.target as Element).closest<HTMLElement>('[data-full]');
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const set = target.dataset.fullSet;
    items = set ? [...document.querySelectorAll<HTMLElement>('[data-full]')].filter((node) => node.dataset.fullSet === set) : [target];
    index = Math.max(0, items.indexOf(target));
    render();
    dialog.showModal();
  },
  true
);

dialog.addEventListener('click', (event) => {
  if (event.target === dialog || event.target === stage) dialog.close();
});
dialog.addEventListener('close', () => stage.replaceChildren());
dialog.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight') go(1);
  if (event.key === 'ArrowLeft') go(-1);
});
