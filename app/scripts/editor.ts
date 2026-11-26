import { icons } from 'ui/src/components/icons.ts';
import { readFields, withBody, withDate, withImages, withManual, withStatus, withTitle } from '../../src/frontmatter.ts';
import type { Fields } from '../../src/frontmatter.ts';
import { fromEdit, toEdit } from '../../src/mentions.ts';
import type { Entities, Entity } from '../../src/mentions.ts';
import { preview } from '../../src/preview.ts';
import type { Preview } from '../../src/preview.ts';
import { dateLabel, postsNow, readiness } from '../../src/plan.ts';
import { sentence } from '../../src/text.ts';
import { clock, longWhenLabel, parseDate, whenLabel, ymd } from '../../src/time.ts';
import { coverLabel, isDocument, mediaKind, needsCover } from '../../src/types.ts';
import { pdfCover } from './pdfcover.ts';
import { videoCover } from './videocover.ts';
import { PLATFORM_LABEL, type Platform, type PostStatus } from '../../src/types.ts';
import { plannedText, segmentLook } from '../lib/ui.ts';
import { autocomplete } from './autocomplete.ts';
import { splitParts } from '../../src/parts.ts';
import './datepicker.ts';
import { h } from './dom.ts';
import { uploadTile } from './uploads.ts';
import { toast, toastAfterReload, working } from './toast.ts';

const MODE_KEY = 'editor:mode';
const IMAGE_MIME = 'application/x-bombarie-image';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const json = <T>(id: string, fallback: string): T => JSON.parse($(id).textContent ?? fallback) as T;

function overdue(iso: string, manual: boolean): string {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  return !manual && minutes < -60 ? 'Overdue. It will be skipped.' : '';
}

function reminderTip(iso: string, stamp: string): { on: boolean; text: string } {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (minutes < -1440) return { on: false, text: 'The time has passed, so no reminder is sent.' };
  return { on: true, text: minutes > 0 ? `You get a reminder on ${longWhenLabel(stamp)}.` : 'The reminder is due now.' };
}

type Mode = 'edit' | 'source';

function init(root: HTMLElement) {
  const { folder = '', variant = '', platform = 'linkedin', connection = '', type = '' } = root.dataset;
  const manualOnly = root.dataset.manualOnly !== undefined;
  const byHand = (fields: Fields): boolean => fields.ok && (fields.manual || manualOnly || (connection !== '' && fields.status !== 'planned'));
  const api = `/api/posts/${encodeURIComponent(folder)}/${encodeURIComponent(variant)}`;
  const draftKey = `draft:${folder}/${variant}`;
  const entities: Entities = new Map(Object.entries(json<Record<string, Entity>>('entities', '{}')));
  let revision = root.dataset.revision ?? '';
  let due = root.dataset.due ?? '';
  let raw = json<string>('raw', '""');
  let savedRaw = raw;
  let mode: Mode = 'edit';
  let theirs = '';
  let offered: string | null = null;
  let leaving = false;

  const [body, source, date, manual, title] = ['body', 'source', 'date', 'manual', 'title'].map((id) => $(id)) as [
    HTMLTextAreaElement,
    HTMLTextAreaElement,
    HTMLInputElement,
    HTMLInputElement,
    HTMLInputElement
  ];
  const [save, restore, plan, overwrite] = ['save', 'restore', 'plan', 'overwrite'].map((id) => $<HTMLButtonElement>(id)) as [
    HTMLButtonElement,
    HTMLButtonElement,
    HTMLButtonElement,
    HTMLButtonElement
  ];
  const statusButton = document.getElementById('state') as HTMLButtonElement | null;
  const statusOption = (name: string) => document.querySelector<HTMLButtonElement>(`[data-status="${name}"]`);

  const dirty = () => raw !== savedRaw;
  const tell = (text: string, tone: 'ok' | 'bad' | 'warn') => toast(text, tone);
  const whenText = (fields: Fields) => {
    $('date-open').textContent = fields.ok && fields.date ? dateLabel(fields.date, fields.status === 'planned' || plan.dataset.recorded !== undefined, new Date()) : 'Pick a date';
    const stamp = document.getElementById('preview-when');
    if (stamp) stamp.textContent = fields.ok && fields.date ? whenLabel(fields.date) : 'No date yet';
  };
  const plannedInfo = () => {
    const saved = readFields(savedRaw);
    return saved.ok && saved.status === 'planned' && due ? overdue(due, saved.manual) : '';
  };
  const renderReminder = () => {
    const bell = document.getElementById('reminder');
    if (!bell) return;
    const saved = readFields(savedRaw);
    const show = saved.ok && saved.status === 'planned' && saved.manual && due !== '' && root.dataset.reminders !== undefined;
    bell.hidden = !show;
    if (!show || !saved.ok) return;
    const tip = reminderTip(due, saved.date);
    bell.title = tip.text;
    bell.setAttribute('aria-label', tip.text);
    bell.classList.toggle('text-ink-faint', !tip.on);
    bell.querySelector<HTMLElement>('[data-on]')!.hidden = !tip.on;
    bell.querySelector<HTMLElement>('[data-off]')!.hidden = tip.on;
  };

  const spans = (segments: Preview['segments']): HTMLElement[] =>
    segments.map((segment) => {
      const look = segmentLook(platform, segment.kind);
      return h('span', { class: look.class, 'data-tone': look.tone, title: segment.kind === 'plain' ? 'posted as plain text' : undefined }, segment.text);
    });

  function renderPreview(result: Preview) {
    document.getElementById('preview-text')?.replaceChildren(...spans(result.segments));
    document.getElementById('preview-replies')?.replaceChildren(
      ...(result.replies ?? []).map((segments, index) =>
        h('li', { class: 'flex flex-col gap-1' }, h('span', { class: 'text-xs text-ink-soft' }, `${platform === 'threads' ? 'Reply' : 'Comment'} ${index + 1}`), h('p', { class: 'text-sm break-words whitespace-pre-wrap' }, ...spans(segments)))
      )
    );
    const count = document.getElementById('preview-count');
    if (count) count.textContent = `${result.length}${result.limit ? `/${result.limit}` : ''} characters`;
    $('preview-notes').replaceChildren(...result.notes.map((note) => h('li', {}, sentence(note))));
  }

  const pdfPage = (name: string, extra = '', zoom = false) => {
    const fallback = () => h('div', { class: `grid aspect-[4/5] w-full place-items-center bg-track p-2 text-center text-xs break-all text-ink-soft ${extra}` }, name);
    const cover = h('img', { src: `/img/${encodeURIComponent(folder)}/${encodeURIComponent(`${name}.cover.jpg`)}?w=640`, alt: '', class: `block h-auto w-full object-contain ${extra}` });
    cover.addEventListener('error', () => cover.replaceWith(fallback()), { once: true });
    const url = `/img/${encodeURIComponent(folder)}/${encodeURIComponent(name)}`;
    return h('div', { class: 'relative', ...(zoom && { 'data-full': url, 'data-full-kind': mediaKind(name), 'data-full-set': 'editor' }) }, cover, h('span', { class: 'absolute bottom-2 left-2 rounded-sm bg-veil px-2 py-1 text-xs text-white' }, coverLabel(name)));
  };

  function caption(name: string): HTMLElement {
    const stem = name.replace(/\.[^.]+$/, '');
    const pencil = h('span', { class: 'shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 [&>svg]:size-4' });
    pencil.innerHTML = icons.regular['pencil-simple'];
    const label = h('button', { type: 'button', title: 'Rename', class: 'group flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm text-left text-sm text-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ink' }, h('span', { class: 'truncate' }, name), pencil);
    label.addEventListener('click', () => {
      const input = h('input', {
        value: stem,
        'aria-label': `Rename ${name}`,
        autocomplete: 'off',
        class: 'h-8 w-full min-w-0 rounded-lg bg-surface px-2 text-xs text-ink ring-1 ring-line ring-inset focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ink'
      });
      let finished = false;
      const back = () => {
        if (!finished) input.replaceWith(label);
        finished = true;
      };
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') back();
        if (event.key === 'Enter') {
          event.preventDefault();
          if (input.value.trim() === '' || input.value === stem) back();
          else {
            finished = true;
            void renameImage(name, input);
          }
        }
      });
      input.addEventListener('blur', back);
      label.replaceWith(input);
      input.focus();
      input.select();
    });
    return label;
  }

  function move(from: number, to: number): void {
    const fields = readFields(raw);
    if (!fields.ok) return;
    const next = [...fields.images];
    next.splice(to, 0, ...next.splice(from, 1));
    setImages(next);
  }

  let dragFrom = -1;
  const dropBar = h('div', { hidden: true, class: 'pointer-events-none absolute z-10 w-0.5 rounded-sm bg-ink' });
  $('images').append(dropBar);
  const slotAt = (event: DragEvent): { slot: number; rect: DOMRect } | null => {
    const tiles = [...$('image-list').children] as HTMLElement[];
    let best = -1;
    let nearest = Infinity;
    tiles.forEach((tile, i) => {
      const r = tile.getBoundingClientRect();
      const dx = Math.max(r.left - event.clientX, 0, event.clientX - r.right);
      const dy = Math.max(r.top - event.clientY, 0, event.clientY - r.bottom);
      if (dx * dx + dy * dy < nearest) {
        nearest = dx * dx + dy * dy;
        best = i;
      }
    });
    if (best < 0) return null;
    const rect = (tiles[best]!.querySelector('[data-full]') ?? tiles[best]!).getBoundingClientRect();
    return { slot: best + (event.clientX > rect.left + rect.width / 2 ? 1 : 0), rect };
  };
  $('image-list').addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes(IMAGE_MIME)) return;
    event.preventDefault();
    const at = slotAt(event);
    if (!at) return;
    const parent = $('images').getBoundingClientRect();
    const after = event.clientX > at.rect.left + at.rect.width / 2;
    dropBar.style.left = `${(after ? at.rect.right + 8 : at.rect.left - 8) - parent.left - 1}px`;
    dropBar.style.top = `${at.rect.top - parent.top}px`;
    dropBar.style.height = `${at.rect.height}px`;
    dropBar.hidden = false;
  });
  $('image-list').addEventListener('dragleave', (event) => {
    if (!$('image-list').contains(event.relatedTarget as Node | null)) dropBar.hidden = true;
  });
  $('image-list').addEventListener('drop', (event) => {
    if (!event.dataTransfer?.types.includes(IMAGE_MIME)) return;
    event.preventDefault();
    event.stopPropagation();
    dropBar.hidden = true;
    const at = slotAt(event);
    if (!at || dragFrom < 0) return;
    const to = at.slot > dragFrom ? at.slot - 1 : at.slot;
    if (to !== dragFrom) move(dragFrom, to);
  });

  async function renameImage(name: string, input: HTMLInputElement) {
    const stem = name.replace(/\.[^.]+$/, '');
    if (dirty()) {
      input.value = stem;
      toast('Save your changes first, then rename the file.', 'warn');
      return;
    }
    const response = await fetch(`/img/${encodeURIComponent(folder)}/${encodeURIComponent(name)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: input.value }) });
    const data = (await response.json()) as { name?: string; error?: string };
    if (!response.ok) {
      input.value = stem;
      const fields = readFields(raw);
      const taken = fields.ok && unused(fields.images).some((other) => data.error?.startsWith(`${other} `));
      toast(`${sentence(data.error ?? 'The file could not be renamed')}${taken ? ' See Unused in this post.' : ''}`, 'bad');
      return;
    }
    toastAfterReload(sentence(`Renamed to ${data.name}`), 'ok');
    leaving = true;
    location.reload();
  }

  const unusedSection = document.querySelector<HTMLElement>('[data-unused]');
  const sizes = JSON.parse(unusedSection?.dataset.sizes ?? '{}') as Record<string, { width?: number; height?: number }>;
  const library = new Set<string>(JSON.parse(unusedSection?.dataset.files ?? '[]') as string[]);
  const unused = (names: string[]): string[] => [...library].filter((name) => !names.includes(name));

  function renderUnused(names: string[] | null) {
    if (!unusedSection) return;
    const left = names ? unused(names) : [];
    unusedSection.hidden = left.length === 0;
    const template = $<HTMLTemplateElement>('unused-tile');
    $('unused-list').replaceChildren(
      ...left.map((name) => {
        const tile = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
        const thumbnail = tile.querySelector<HTMLImageElement>('[data-unused-thumb]')!;
        if (sizes[name]?.width) Object.assign(thumbnail, sizes[name]);
        thumbnail.src = `/img/${encodeURIComponent(folder)}/${encodeURIComponent(needsCover(name) ? `${name}.cover.jpg` : name)}?w=512`;
        const label = tile.querySelector<HTMLElement>('[data-unused-label]')!;
        label.hidden = !needsCover(name);
        if (needsCover(name)) label.textContent = coverLabel(`${name}.cover.jpg`);
        const add = tile.querySelector<HTMLElement>('[data-use-image]')!;
        const remove = tile.querySelector<HTMLElement>('[data-open]')!;
        add.dataset.useImage = name;
        remove.dataset.value = name;
        for (const [button, verb] of [[add, 'Add'], [remove, 'Delete']] as const) {
          button.title = `${verb} ${name}`;
          button.setAttribute('aria-label', `${verb} ${name}`);
        }
        return tile;
      })
    );
  }

  function renderImages(fields: Fields) {
    const names = fields.ok ? fields.images : [];
    renderUnused(fields.ok ? names : null);
    const full = (name: string) => `/img/${encodeURIComponent(folder)}/${encodeURIComponent(name)}`;
    const thumb = (name: string) =>
      needsCover(name)
        ? pdfPage(name, 'cursor-zoom-in rounded-lg ring-1 ring-line', true)
        : h('img', { 'data-photo': true, ...sizes[name], src: `${full(name)}?w=512`, alt: '', 'data-full': full(name), 'data-full-set': 'editor', class: 'block h-auto w-full cursor-zoom-in rounded-lg object-cover ring-1 ring-line transition-opacity' });
    const template = $<HTMLTemplateElement>('image-tile');
    $('image-list').replaceChildren(
      ...names.map((name, index) => {
        const tile = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
        const thumbNode = tile.querySelector('[data-tile-thumb]')!;
        thumbNode.replaceWith(thumb(name));
        tile.querySelector('[data-tile-name]')!.replaceWith(caption(name));
        const previous = tile.querySelector<HTMLButtonElement>('[data-tile-prev]');
        const following = tile.querySelector<HTMLButtonElement>('[data-tile-next]');
        if (previous) previous.disabled = index === 0;
        if (following) following.disabled = index === names.length - 1;
        previous?.addEventListener('click', () => move(index, index - 1));
        following?.addEventListener('click', () => move(index, index + 1));
        tile.querySelector('[data-tile-remove]')?.addEventListener('click', () => {
          const current = readFields(raw);
          if (current.ok) setImages(current.images.filter((_, position) => position !== index));
        });
        const handle = tile.querySelector<HTMLElement>('[data-full]')!;
        handle.draggable = true;
        handle.addEventListener('dragstart', (event) => {
          event.dataTransfer?.setData(IMAGE_MIME, String(index));
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
          dragFrom = index;
          tile.classList.add('opacity-(--dim)');
        });
        handle.addEventListener('dragend', () => {
          tile.classList.remove('opacity-(--dim)');
          dropBar.hidden = true;
        });
        return tile;
      })
    );
    const picture = (name: string) => `/img/${encodeURIComponent(folder)}/${encodeURIComponent(name)}?w=640`;
    $('preview-images').replaceChildren(
      ...names.map((name) =>
        needsCover(name)
          ? h('li', {}, pdfPage(name))
          : type === 'story'
          ? h('li', { class: 'relative' }, h('img', { src: picture(name), alt: '', 'aria-hidden': 'true', class: 'absolute inset-0 size-full scale-125 object-cover blur-2xl brightness-75' }), h('img', { 'data-photo': true, src: picture(name), alt: '', class: 'transition-opacity relative block size-full object-contain' }))
          : h('li', {}, h('img', { 'data-photo': true, src: picture(name), alt: '', class: platform === 'instagram' ? 'block h-auto max-h-[125cqw] min-h-[52cqw] w-full object-cover' : 'block size-full object-cover' }))
      )
    );
    $('preview-images').hidden = names.length === 0;
    syncSlides();
  }

  let slide = 0;
  function syncSlides() {
    const list = document.getElementById('preview-images');
    if (!list) return;
    const items = [...list.children] as HTMLElement[];
    slide = Math.min(slide, Math.max(items.length - 1, 0));
    items.forEach((item, index) => (item.hidden = index !== slide));
    const many = items.length > 1;
    const count = document.getElementById('slide-count');
    const dots = document.getElementById('slide-dots');
    if (count) {
      count.hidden = !many;
      count.textContent = `${slide + 1}/${items.length}`;
    }
    if (dots) {
      dots.hidden = !many;
      dots.replaceChildren(...items.map((_, index) => h('span', { class: `size-2 rounded-full ${index === slide ? 'bg-ink' : 'bg-line-strong'}` })));
    }
    for (const button of document.querySelectorAll<HTMLElement>('[data-slide]')) {
      button.hidden = !many || (button.dataset.slide === '-1' ? slide === 0 : slide === items.length - 1);
    }
  }
  document.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-slide]');
    if (!button) return;
    slide += Number(button.dataset.slide);
    syncSlides();
  });

  const setImages = (names: string[]) => {
    edit(withImages(raw, names));
    renderImages(readFields(raw));
  };

  async function addImages(files: File[]) {
    const added: string[] = [];
    const failed: string[] = [];
    const strip = $('image-list');
    const tiles = files.map((file) => uploadTile(strip, file.name));
    for (const [index, file] of files.entries()) {
      const tile = tiles[index];
      tile?.state('uploading…');
      try {
        const response = await fetch(`/img/${encodeURIComponent(folder)}/${encodeURIComponent(file.name)}`, { method: 'PUT', body: file });
        const data = (await response.json()) as { name?: string; error?: string };
        if (response.ok && data.name) {
          added.push(data.name);
          library.add(data.name);
          if (needsCover(data.name)) {
            const cover = await (isDocument(data.name) ? pdfCover(file) : videoCover(file));
            if (cover) await fetch(`/img/${encodeURIComponent(folder)}/${encodeURIComponent(`${data.name}.cover.jpg`)}`, { method: 'PUT', body: cover }).catch(() => null);
          }
        }
        else failed.push(sentence(`${file.name}: ${data.error ?? response.statusText}`));
      } catch {
        failed.push(`${file.name}: no connection to the server.`);
      }
      tile?.remove();
    }
    const fields = readFields(raw);
    if (added.length > 0 && fields.ok) setImages([...fields.images, ...added.filter((name) => !fields.images.includes(name))]);
    else if (added.length > 0) failed.push('Fix the properties first, then add the images again.');
    if (failed.length > 0) toast(failed.join('; '), 'bad');
    if (added.length === 0) update();
  }

  document.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-use-image]');
    if (!button?.dataset.useImage) return;
    const fields = readFields(raw);
    if (!fields.ok) return toast('Fix the properties first, then add the image again.', 'bad');
    if (!fields.images.includes(button.dataset.useImage)) setImages([...fields.images, button.dataset.useImage]);
  });

  function problems(lines: string[]) {
    $('problems').replaceChildren(...lines.map((text) => h('p', {}, sentence(text))));
    $('problems').hidden = lines.length === 0;
  }

  function showFields(fields: Fields) {
    if (!fields.ok) return;
    date.value = fields.date;
    title.value = fields.title || title.dataset.fallback || '';
    manual.checked = fields.manual;
    const stateLabel = document.getElementById('state-label');
    if (stateLabel && statusButton && plan.dataset.recorded === undefined) {
      stateLabel.textContent = fields.status === 'planned' ? 'Planned' : 'Draft';
      statusButton.dataset.tone = fields.status === 'planned' ? 'info' : 'warn';
    }
    for (const [name, active] of [['draft', fields.status !== 'planned'], ['planned', fields.status === 'planned']] as const) {
      const option = statusOption(name);
      option?.setAttribute('aria-pressed', String(active && plan.dataset.recorded === undefined));
      option?.querySelector('span[aria-hidden]')?.classList.toggle('invisible', !(active && plan.dataset.recorded === undefined));
    }
    plan.hidden = fields.status === 'planned' || plan.dataset.recorded !== undefined;
    whenText(fields);
  }

  function refreshReadiness(fields: Fields, result: Preview) {
    const open = plan.dataset.recorded === undefined;
    const isManual = byHand(fields);
    const plannedHint = statusOption('planned')?.querySelector('[data-option-text]');
    if (plannedHint) plannedHint.textContent = plannedText(isManual);
    const reached = fields.ok && fields.date !== '' && parseDate(fields.date).getTime() <= Date.now();
    const hand = isManual && reached && open;
    const due = !hand && fields.ok && open && postsNow({ manual: isManual, connected: !connection, date: fields.date, now: new Date() });
    const immediate = due && fields.ok && fields.status !== 'planned';
    const reason = !open
      ? null
      : fields.ok
      ? readiness({ manual: isManual, date: fields.date, images: fields.images.length, needsImage: platform === 'instagram', immediate, preview: result, connection: isManual ? null : connection || null, now: new Date() })
      : 'Fix the properties first.';
    const blocked = fields.ok && fields.status === 'planned' && reason !== null;
    $('actions').toggleAttribute('data-planned', fields.ok && fields.status === 'planned');
    plan.dataset.mode = due ? 'now' : hand ? 'manual' : 'plan';
    if (hand) {
      plan.replaceChildren('Post', Object.assign(document.createElement('span'), { className: 'inline-block size-[1em] [&>svg]:size-full', innerHTML: icons.regular['arrow-square-out'] }));
    } else plan.textContent = due ? 'Post now' : 'Plan';
    plan.hidden = !open || (fields.ok && fields.status === 'planned' && !due && !hand);
    plan.disabled = due && !immediate ? false : reason !== null;
    const plannedOption = statusOption('planned');
    if (plannedOption) {
      const already = fields.ok && fields.status === 'planned';
      plannedOption.disabled = !already && plan.disabled;
      plannedOption.title = plannedOption.disabled ? (reason ?? '') : '';
    }
    const postedOption = statusOption('posted');
    if (postedOption && fields.ok) postedOption.hidden = !byHand(fields);
    save.hidden = !dirty();
    save.disabled = !dirty() || blocked;
    const hint = $('hint');
    hint.textContent = reason ?? '';
    hint.hidden = reason === null || !fields.ok;
    hint.dataset.tone = plannedInfo() ? 'bad' : 'warn';
  }

  function renderMode(fields: Fields) {
    const label = document.getElementById('mode-label');
    const open = document.getElementById('mode-open');
    if (!label || !open || !fields.ok) return;
    label.textContent = fields.manual ? 'Manual' : 'Auto';
    open.dataset.tone = fields.manual ? 'manual' : 'ink';
    for (const option of document.querySelectorAll<HTMLElement>('[data-mode]')) {
      const active = (option.dataset.mode === 'manual') === fields.manual;
      option.setAttribute('aria-pressed', String(active));
      option.querySelector<HTMLElement>('[data-icon], span[aria-hidden]')?.classList.toggle('invisible', !active);
    }
  }

  function update() {
    const fields = readFields(raw);
    renderMode(fields);
    const result = preview(fields.body, platform as Platform, entities);
    renderPreview(result);
    $('preview').hidden = result.length === 0 && !(fields.ok && fields.images.length > 0);
    refreshReadiness(fields, result);
    whenText(fields);
    $('source-note').textContent = fields.ok ? '' : sentence(fields.error);
    if (mode === 'source') {
      renderImages(fields);
      if (fields.ok) title.value = fields.title || title.dataset.fallback || '';
    }
    if (dirty()) localStorage.setItem(draftKey, JSON.stringify({ revision, raw }));
    else localStorage.removeItem(draftKey);
    scheduleAutosave();
    refreshRepliesButton();
    renderReminder();
    const showCopy = byHand(fields) && type !== 'story';
    const copyText = document.getElementById('copy-text');
    if (copyText) copyText.hidden = !showCopy;
    body.classList.toggle('pr-14', showCopy);
    const dialogImage = document.getElementById('manual-copy-image');
    if (dialogImage && fields.ok) dialogImage.hidden = fields.images.every(needsCover);
    body.hidden = type === 'story' && fields.ok && !fields.manual;
    $('heading').textContent = title.value.trim() || title.dataset.fallback || '';
  }

  function show(next: Mode) {
    const fields = readFields(raw);
    if (next === 'edit' && !fields.ok) {
      $('source-note').textContent = `Fix the properties first: ${fields.error}`;
      next = 'source';
    }
    if (next === 'edit' && fields.ok) {
      fillBody(fields.body);
      showFields(fields);
      renderImages(fields);
      renderPreview(preview(fields.body, platform as Platform, entities));
    } else source.value = raw;
    mode = next;
    for (const [id, visible] of [['edit-view', mode === 'edit'], ['fields', mode === 'edit'], ['source-view', mode === 'source']] as const) $(id).hidden = !visible;
    for (const m of ['edit', 'source'] as const) $(`mode-${m}`).setAttribute('aria-pressed', String(mode === m));
    localStorage.setItem(MODE_KEY, mode);
    if (mode === 'source') update();
  }

  const edit = (next: string) => {
    raw = next;
    update();
  };

  let sending = false;
  let renameTimer: number | undefined;
  let autosaveTimer: number | undefined;
  let autosaveStopped = false;

  function autosaveable(): boolean {
    const now = readFields(raw);
    const stored = readFields(savedRaw);
    return dirty() && !sending && !autosaveStopped && now.ok && stored.ok && now.status !== 'planned' && stored.status !== 'planned' && root.dataset.posted === undefined && root.dataset.posting === undefined && plan.dataset.recorded === undefined && $('conflict').hidden === true;
  }

  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    if (autosaveable()) autosaveTimer = window.setTimeout(() => void autosave(), 1000);
  }

  async function autosave() {
    if (!autosaveable()) return;
    await submit(undefined, save, true);
    scheduleAutosave();
  }

  async function submit(rollback?: string, trigger: HTMLButtonElement = save, quiet = false, rename = false) {
    if (quiet && sending) return;
    while (sending) await new Promise((done) => setTimeout(done, 50));
    if (!dirty() && !rename) return;
    clearTimeout(renameTimer);
    const typed = readFields(raw);
    const saved = readFields(savedRaw);
    if (typed.ok && typed.status === 'planned' && !(saved.ok && saved.status === 'planned') && !manualOnly && connection) raw = withManual(raw, true);
    const text = raw;
    const buttons = [save, plan];
    sending = true;
    if (!quiet) for (const button of buttons) button.disabled = true;
    const done = quiet ? () => {} : working(trigger === plan && plan.dataset.mode !== 'now' ? 'Planning…' : trigger === statusButton ? 'Updating…' : 'Saving…');
    let ok = false;
    try {
      const response = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: text, revision, sync: !quiet }) });
      const data = (await response.json()) as { folder?: string; rearmed?: boolean; revision?: string | null; error?: string | null; problems?: string[]; due?: string | null };
      if (response.status === 409) {
        theirs = data.revision ?? '';
        $('conflict').hidden = false;
        overwrite.hidden = rollback !== undefined || theirs === '';
        tell('This file changed elsewhere since you opened it. Your text is kept here.', 'warn');
      } else if (response.status === 422) {
        problems(data.problems ?? []);
        tell(sentence(`Not planned: ${(data.problems ?? []).join('; ')}`), 'bad');
      } else if (!response.ok || !data.revision) {
        tell(sentence(`Not saved: ${data.error ?? response.statusText}`), 'bad');
      } else {
        ok = true;
        $('conflict').hidden = true;
        revision = data.revision;
        due = data.due ?? '';
        savedRaw = text;
        localStorage.removeItem(draftKey);
        autosaveStopped = false;
        if (data.folder && (data.folder !== folder || data.rearmed)) {
          sending = false;
          toastAfterReload('Saved.', 'ok');
          location.replace(`/posts/${encodeURIComponent(data.folder)}/${encodeURIComponent(variant)}`);
          return;
        }
        problems(data.error ? [data.error] : []);
        if (!quiet) toast('Saved.');
      }
    } catch {
      tell('Not saved: no connection to the server.', 'bad');
    }
    sending = false;
    if (!ok && quiet) autosaveStopped = true;
    done();
    if (quiet) {
      const current = readFields(raw);
      refreshReadiness(current, preview(current.body, platform as Platform, entities));
      return;
    }
    for (const button of buttons) button.disabled = false;
    if (!ok && rollback !== undefined) raw = rollback;
    const fields = readFields(raw);
    if (ok || rollback !== undefined) showFields(fields);
    refreshReadiness(fields, preview(fields.body, platform as Platform, entities));
  }

  const change = (status: PostStatus, trigger: HTMLButtonElement) => {
    const before = raw;
    raw = withStatus(raw, status);
    return submit(before, trigger);
  };
  const reset = (next: string) => {
    raw = next;
    show(readFields(raw).ok ? mode : 'source');
    update();
  };

  const replyBox = document.getElementById('replies');
  const replyAreas = (): HTMLTextAreaElement[] => (replyBox ? [...replyBox.querySelectorAll('textarea')] : []);
  const commitBody = () => {
    const parts = [body, ...replyAreas()].map((area) => fromEdit(area.value, entities));
    edit(withBody(raw, replyBox ? parts.join('\n\n---\n\n') : (parts[0] ?? '')));
  };
  const noun = platform === 'threads' ? 'Reply' : 'Comment';
  const numberReplies = () => {
    for (const [index, label] of [...(replyBox?.querySelectorAll<HTMLElement>('[data-reply-label]') ?? [])].entries()) label.textContent = `${noun} ${index + 1}`;
  };
  let repliesSent = Number(root.dataset.repliesSent ?? 0);
  const replyIds = JSON.parse(root.dataset.replyIds ?? '[]') as string[];
  const replyDialog = document.getElementById('reply-delete') as HTMLDialogElement | null;
  let replyIndex = -1;
  const repliesButton = document.getElementById('post-replies') as HTMLButtonElement | null;
  function lockSentReplies() {
    for (const [index, wrapper] of [...(replyBox?.children ?? [])].entries()) {
      if (index >= repliesSent) continue;
      wrapper.querySelector('textarea')?.setAttribute('readonly', '');
    }
  }
  function refreshRepliesButton() {
    if (repliesButton) repliesButton.hidden = !replyAreas().slice(repliesSent).some((area) => area.value.trim() !== '');
  }
  function openReplyDialog(position: number) {
    replyIndex = position;
    const both = document.getElementById('reply-delete-both');
    if (both) both.hidden = !(root.dataset.replyRemote !== undefined && (replyIds[position] ?? '') !== '');
    replyDialog?.showModal();
  }
  async function deleteSentReply(scope: 'both' | 'local') {
    const position = replyIndex;
    replyDialog?.close();
    const stop = working('Deleting…');
    try {
      const response = await fetch(`/api/replies/${encodeURIComponent(folder)}/${encodeURIComponent(variant)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index: position, scope }) });
      const data = (await response.json()) as { ok: boolean; text: string };
      if (!data.ok) return toast(data.text, 'bad');
      replyBox?.children[position]?.remove();
      replyIds.splice(position, 1);
      repliesSent -= 1;
      numberReplies();
      commitBody();
      stop();
      await submit();
      toast(data.text);
    } catch {
      toast('Not deleted: no connection to the server.', 'bad');
    } finally {
      stop();
    }
  }
  document.getElementById('reply-delete-local')?.addEventListener('click', () => void deleteSentReply('local'));
  document.getElementById('reply-delete-both')?.addEventListener('click', () => void deleteSentReply('both'));
  let replyCounter = 0;
  function addReplyField(text: string): HTMLTextAreaElement {
    replyCounter += 1;
    const area = h('textarea', { id: `reply-${replyCounter}`, rows: '4', placeholder: 'Write the reply. Type @ to mention.', 'aria-label': 'Reply', class: `${body.className.replace(/\bpr-14\b/, '').replace(/\bmin-h-56\b/, 'min-h-32')} pr-14` }) as HTMLTextAreaElement;
    area.value = text;
    const remove = ($<HTMLTemplateElement>('reply-remove').content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;
    remove.addEventListener('click', () => {
      const position = [...(replyBox?.children ?? [])].indexOf(wrapper);
      if (position < repliesSent) return openReplyDialog(position);
      wrapper.remove();
      numberReplies();
      commitBody();
    });
    const label = h('p', { 'data-reply-label': '', class: 'text-sm text-ink-soft' });
    const wrapper = h('div', { class: 'flex flex-col gap-2' }, label, h('div', { class: 'relative' }, area, remove));
    replyBox?.append(wrapper);
    numberReplies();
    autocomplete(area, 'at', entities, platform);
    area.addEventListener('input', commitBody);
    return area;
  }
  function fillBody(text: string) {
    if (!replyBox) {
      body.value = toEdit(text, entities);
      return;
    }
    const [first = '', ...later] = splitParts(text);
    body.value = toEdit(first, entities);
    replyBox.replaceChildren();
    for (const part of later) addReplyField(toEdit(part, entities));
    lockSentReplies();
  }
  body.addEventListener('input', commitBody);
  document.getElementById('add-reply')?.addEventListener('click', () => {
    addReplyField('').focus();
    commitBody();
  });
  repliesButton?.addEventListener('click', () => {
    void (async () => {
      const stop = working('Posting the comment…');
      await submit();
      if (!dirty()) {
        await postAction('post-replies');
        location.reload();
        return;
      }
      stop();
    })();
  });
  source.addEventListener('input', () => edit(source.value));
  title.addEventListener('input', () => readFields(raw).ok && edit(withTitle(raw, title.value)));
  title.addEventListener('change', () => {
    clearTimeout(renameTimer);
    renameTimer = window.setTimeout(() => {
      const now = readFields(raw);
      if (sending || !now.ok || now.status === 'planned' || plan.dataset.recorded !== undefined || !$('conflict').hidden) return;
      clearTimeout(autosaveTimer);
      void submit(undefined, save, false, true);
    }, 300);
  });
  date.addEventListener('input', () => edit(withDate(raw, date.value)));
  manual.addEventListener('input', () => edit(withManual(raw, manual.checked)));
  for (const option of document.querySelectorAll<HTMLElement>('[data-mode]')) {
    option.addEventListener('click', () => {
      manual.checked = option.dataset.mode === 'manual';
      manual.dispatchEvent(new Event('input'));
      document.getElementById('mode-menu')?.hidePopover();
    });
  }
  autocomplete(body, 'at', entities, platform);
  autocomplete(source, 'wiki', entities, platform);

  const input = $<HTMLInputElement>('image-input');
  input.addEventListener('change', () => {
    void addImages([...(input.files ?? [])]);
    input.value = '';
  });
  const zone = document.getElementById('image-dropzone');
  let depth = 0;
  const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
  root.addEventListener('dragenter', (event) => {
    if (mode !== 'edit' || !carriesFiles(event)) return;
    depth += 1;
    zone?.setAttribute('data-active', '');
  });
  root.addEventListener('dragleave', (event) => {
    if (!carriesFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) zone?.removeAttribute('data-active');
  });
  root.addEventListener('dragover', (event) => {
    if (mode === 'edit' && carriesFiles(event)) event.preventDefault();
  });
  const droppable = (file: File): boolean => file.type.startsWith('image/') || $<HTMLInputElement>('image-input').accept.split(',').includes(file.type);
  root.addEventListener('drop', (event) => {
    depth = 0;
    zone?.removeAttribute('data-active');
    if (mode !== 'edit') return;
    event.preventDefault();
    const files = [...(event.dataTransfer?.files ?? [])].filter(droppable);
    if (files.length > 0) void addImages(files);
  });
  document.addEventListener('paste', (event) => {
    if (mode !== 'edit') return;
    const pasted = [...(event.clipboardData?.files ?? [])].filter(droppable);
    if (pasted.length === 0) return;
    event.preventDefault();
    void addImages(pasted);
  });

  const pictures = (): string[] => {
    const fields = readFields(raw);
    return fields.ok ? fields.images.filter((name) => !needsCover(name)) : [];
  };
  const pictureFile = async (name: string): Promise<File> => {
    const blob = await (await fetch(`/img/${encodeURIComponent(folder)}/${encodeURIComponent(name)}`)).blob();
    return new File([blob], name, { type: blob.type });
  };
  const asPng = async (blob: Blob): Promise<Blob> => {
    if (blob.type === 'image/png') return blob;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    return new Promise((resolve) => canvas.toBlob((png) => resolve(png!), 'image/png'));
  };
  const textToPost = (): string => {
    const fields = readFields(raw);
    return fields.ok ? preview(fields.body, platform as Platform, entities).segments.map((segment) => segment.text).join('') : '';
  };
  const copyFirstImage = async (): Promise<void> => {
    const [first] = pictures();
    if (!first) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pictureFile(first).then(asPng) })]);
      toast('Image copied.');
    } catch {
      toast('This browser cannot copy an image.', 'warn');
    }
  };
  document.getElementById('copy-text')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(textToPost());
    toast('Text copied.');
  });
  document.getElementById('manual-copy-image')?.addEventListener('click', () => void copyFirstImage());

  document.querySelector<HTMLFormElement>('#manual-dialog form[method="post"]')?.addEventListener('submit', (event) => {
    if (!dirty()) return;
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    void submit().then(() => {
      if (!dirty()) form.requestSubmit();
    });
  });

  async function postManually(): Promise<void> {
    const text = type === 'story' ? '' : textToPost();
    const shown = () => ($('manual-dialog') as HTMLDialogElement).showModal();
    if (matchMedia('(pointer: coarse)').matches && pictures().length > 0 && navigator.canShare) {
      try {
        const files = await Promise.all(pictures().slice(0, 10).map(pictureFile));
        if (navigator.canShare({ files })) {
          await navigator.share({ files, ...(text && { text }) });
          shown();
          return;
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    const url = root.dataset.compose;
    if (text) void navigator.clipboard.writeText(text).then(() => toast('Text copied.'));
    else if (pictures().length > 0) void copyFirstImage();
    if (url) window.open(url, '_blank', 'noopener');
    shown();
  }

  plan.addEventListener('click', () => {
    if (plan.dataset.mode === 'manual') return void postManually();
    if (plan.dataset.mode !== 'now') return change('planned', plan);
    void (async () => {
      const stamp = new Date();
      edit(withDate(raw, `${ymd(stamp)}T${clock(stamp)}`));
      await submit(undefined, plan);
      if (!dirty()) ($('post-now') as HTMLDialogElement).showModal();
    })();
  });
  const postAction = async (intent: string): Promise<void> => {
    const body = new FormData();
    body.set('intent', intent);
    body.set('variant', variant);
    await fetch(location.pathname, { method: 'POST', body, redirect: 'manual' });
  };
  const posted = root.dataset.posted !== undefined;
  statusOption('draft')?.addEventListener('click', () => {
    if (!statusButton) return;
    void (async () => {
      if (posted) await postAction('unmark-posted');
      const now = readFields(raw);
      if (now.ok && now.status !== 'draft') await change('draft', statusButton);
      if (posted) {
        leaving = true;
        location.reload();
      }
    })();
  });
  statusOption('planned')?.addEventListener('click', () => {
    void (async () => {
      if (posted) {
        await postAction('unmark-posted');
        leaving = true;
        location.reload();
        return;
      }
      if (statusButton && plan.dataset.mode === 'manual') await change('planned', statusButton);
      else if (!plan.hidden && !plan.disabled) plan.click();
    })();
  });
  statusOption('posted')?.addEventListener('click', () => {
    if (dirty()) return toast('Save your changes first, then mark it as posted.', 'warn');
    void (async () => {
      await postAction('mark-posted');
      leaving = true;
      location.reload();
    })();
  });
  save.addEventListener('click', () => void submit());
  restore.addEventListener('click', () => {
    if (offered === null) return;
    restore.hidden = true;
    reset(offered);
    offered = null;
  });
  overwrite.addEventListener('click', () => {
    revision = theirs;
    $('conflict').hidden = true;
    void submit();
  });
  $('reload').addEventListener('click', () => {
    savedRaw = raw;
    localStorage.removeItem(draftKey);
    location.reload();
  });
  $('mode-edit').addEventListener('click', () => show('edit'));
  $('mode-source').addEventListener('click', () => show('source'));
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault();
      void submit();
    }
  });
  for (const form of document.querySelectorAll('form[data-leave]')) form.addEventListener('submit', () => (leaving = true));
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) localStorage.removeItem(draftKey);
  });
  window.addEventListener('beforeunload', (event) => {
    if (dirty() && !leaving) event.preventDefault();
  });

  const stored = JSON.parse(localStorage.getItem(draftKey) ?? 'null') as { revision: string; raw: string } | null;
  if (stored && stored.revision === revision && stored.raw !== raw) offered = stored.raw;
  localStorage.removeItem(draftKey);
  show(readFields(raw).ok ? ((localStorage.getItem(MODE_KEY) as Mode | null) ?? 'edit') : 'source');
  const opened = readFields(raw);
  if (opened.ok && opened.status === 'draft' && plan.dataset.recorded === undefined && opened.body.trim() === '') $('body').focus();
  function watchPosting() {
    for (const button of [save, plan]) button.disabled = true;
    const url = `/api/state/${encodeURIComponent(folder)}/${encodeURIComponent(variant)}`;
    const started = Date.now();
    const stop = working(`Posting to ${PLATFORM_LABEL[platform as Platform] ?? platform}…`);
    const finish = (text: string, tone: 'ok' | 'bad' | 'warn') => {
      stop();
      toastAfterReload(text, tone);
      location.reload();
    };
    const poll = async () => {
      if (Date.now() - started > 10 * 60_000) return finish('Posting took too long. Check the platform before trying again.', 'warn');
      try {
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        const data = (await response.json()) as { status: string; progress?: string | null; text?: string };
        if (data.status === 'posting') {
          return void setTimeout(poll, 2000);
        }
        if (data.status === 'posted') return finish(data.text ?? 'Posted.', 'ok');
        if (data.status === 'none') return finish('Could not find out how posting went. Check the platform before trying again.', 'warn');
        return finish(data.text ?? 'Not posted.', data.status === 'unconfirmed' ? 'warn' : 'bad');
      } catch {
        return void setTimeout(poll, 4000);
      }
    };
    void poll();
  }
  if (root.dataset.posting !== undefined) watchPosting();

  update();
  syncSlides();
  if (offered !== null) {
    restore.hidden = false;
  }
}

const root = document.querySelector<HTMLElement>('[data-editor]');
if (root) init(root);
