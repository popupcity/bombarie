import { LATE_AFTER_MS } from './plan.ts';
import type { Attention, State } from './state.ts';
import { campaignTitle, folderTitle } from './text.ts';
import { clock, ymd } from './time.ts';
import { needsCover } from './types.ts';
import type { ChannelInfo, Platform, Post } from './types.ts';

export type Status = 'posted' | 'planned' | 'draft' | 'reminded' | 'late' | 'failed' | 'unconfirmed' | 'posting' | 'deleted';

export interface CalendarInput {
  posts: Post[];
  states: Map<string, State | null>;
  errors: string[];
  attention: Attention[];
  channels: ChannelInfo[];
  feeds?: FeedCard[];
  now: Date;
}

export interface FeedCard {
  id: string;
  channel: string;
  title: string;
  url: string;
  at: string;
  text: string;
}

export const STATUS_LABEL: Record<Status, string> = {
  posted: 'Posted',
  planned: 'Planned',
  draft: 'Draft',
  reminded: 'Reminded',
  late: 'Late',
  failed: 'Failed',
  unconfirmed: 'Unconfirmed',
  posting: 'Posting',
  deleted: 'Deleted'
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(day: string): [number, number, number] {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return [y, m, d];
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = parts(day);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function weekStart(day: string): string {
  const [y, m, d] = parts(day);
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(day, -weekday);
}

export function statusOf(post: Post, state: State | null, now: Date): Status {
  if (state) return state.status;
  if (post.status === 'draft') return 'draft';
  if (post.manual) return 'planned';
  return now.getTime() - post.date.getTime() > LATE_AFTER_MS ? 'late' : 'planned';
}

function campaignTitles(posts: Post[]): Map<string, string> {
  const found = new Map<string, (string | undefined)[]>();
  for (const post of [...posts].sort((a, b) => a.id.localeCompare(b.id))) {
    const folder = post.id.split('/')[0] ?? post.id;
    found.set(folder, [...(found.get(folder) ?? []), post.title]);
  }
  return new Map([...found].map(([folder, list]) => [folder, campaignTitle(folder, list)]));
}

function shortDate(day: string): string {
  const [, m, d] = parts(day);
  return `${d} ${MONTHS[m - 1]}`;
}

export interface CardModel {
  id: string;
  day: string;
  time: string;
  status: Status;
  channel: string;
  label: string;
  platform: Platform;
  avatar?: string;
  type: string | null;
  manual: boolean;
  problem?: string;
  campaign: string;
  text: string;
  images: string[];
  url?: string;
  live?: string;
}

export interface NoticeModel {
  status: Status;
  label: string;
  where: string[];
  text: string;
  id?: string;
}

export type ChannelModel = ChannelInfo & { problem?: string | undefined };

export interface CalendarData {
  today: string;
  cards: CardModel[];
  notices: NoticeModel[];
  channels: ChannelModel[];
}

export interface MonthDay {
  day: string;
  date: number;
  inMonth: boolean;
  today: boolean;
  past: boolean;
  cards: CardModel[];
}

export interface ListGroup {
  day: string;
  label: string;
  past: boolean;
  cards: CardModel[];
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

function monthOf(day: string): string {
  return day.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function cardModels(input: CalendarInput): CardModel[] {
  const infoOf = (name: string): ChannelInfo => input.channels.find((a) => a.name === name) ?? { name, platform: 'linkedin', label: name };
  const titles = campaignTitles(input.posts);
  const stuck = new Map(input.attention.map((a) => [a.id, a.message]));
  const since = input.now.getTime() - FEED_DAYS * 86_400_000;
  const seen = (input.feeds ?? []).filter((item) => Date.parse(item.at) >= since).map((item) => {
    const info = infoOf(item.channel);
    const at = new Date(item.at);
    return {
      id: item.id,
      day: ymd(at),
      time: clock(at),
      status: 'posted' as Status,
      channel: item.channel,
      label: info.label,
      platform: info.platform,
      ...(info.avatar ? { avatar: info.avatar } : {}),
      type: null,
      manual: false,
      campaign: item.title,
      text: item.text,
      images: [],
      url: item.url,
      at: at.getTime()
    };
  });
  return [...input.posts
    .map((post) => {
      const state = input.states.get(post.id) ?? null;
      const info = infoOf(post.channel);
      const status = statusOf(post, state, input.now);
      const problem = stuck.get(post.id) ?? (status === 'late' ? 'more than an hour late, so it was skipped' : undefined);
      return {
        id: post.id,
        day: ymd(post.date),
        time: clock(post.date),
        status,
        ...(problem !== undefined && { problem }),
        channel: post.channel,
        label: info.label,
        platform: info.platform,
        ...(info.avatar ? { avatar: info.avatar } : {}),
        type: post.type,
        manual: post.manual,
        campaign: titles.get(post.id.split('/')[0] ?? post.id) ?? '',
        text: post.text,
        images: post.images.filter((name) => !needsCover(name)),
        ...(state?.status === 'posted' && state.url !== undefined && { live: state.url }),
        at: post.date.getTime()
      };
    }), ...seen]
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    .map(({ at: _at, ...card }) => card);
}

const POST_ERROR = /^(\d{4}-\d{2}-\d{2}-[^/]+\/[^/:]+\.md): /;
const NO_CHANNEL = 'no channel matches this file name';

function noticesOf(input: CalendarInput, cards: CardModel[]): NoticeModel[] {
  return [
    ...cards
      .filter((c) => c.status === 'late')
      .map((c) => ({
        status: 'late' as Status,
        label: STATUS_LABEL.late,
        where: [c.label, c.campaign, `${shortDate(c.day)} ${c.time}`],
        text: 'more than an hour late, so it was skipped',
        id: c.id
      })),
    ...input.attention.map((a) => {
      const status: Status = a.status;
      const card = cards.find((candidate) => candidate.id === a.id);
      return { status, label: STATUS_LABEL[status], where: card ? [card.label, card.campaign] : [a.id], text: a.message, id: a.id };
    }),
    ...input.errors.map((e) => {
      const id = POST_ERROR.exec(e)?.[1];
      const where = id === undefined ? [] : [folderTitle(id.split('/')[0] ?? id), id.split('/')[1] ?? id];
      const text = id === undefined ? e : e.slice(id.length + 2);
      return { status: 'failed' as Status, label: 'Error', where, text, ...(id !== undefined && !e.endsWith(NO_CHANNEL) && { id }) };
    })
  ];
}

export function buildCalendarData(input: CalendarInput): CalendarData {
  const cards = cardModels(input);
  const today = ymd(input.now);
  return {
    today,
    cards,
    notices: noticesOf(input, cards),
    channels: input.channels
  };
}

function groupByDay(cards: CardModel[]): Map<string, CardModel[]> {
  const byDay = new Map<string, CardModel[]>();
  for (const card of cards) byDay.set(card.day, [...(byDay.get(card.day) ?? []), card]);
  return byDay;
}

export function monthWeeks(cards: CardModel[], month: string, today: string): MonthDay[][] {
  const byDay = groupByDay(cards);
  const first = `${month}-01`;
  const last = addDays(`${addMonths(month, 1)}-01`, -1);
  const rows: MonthDay[][] = [];
  for (let start = weekStart(first); start <= last; start = addDays(start, 7)) {
    rows.push(
      Array.from({ length: 7 }, (_, i) => {
        const day = addDays(start, i);
        return { day, date: parts(day)[2], inMonth: monthOf(day) === month, today: day === today, past: day < today, cards: byDay.get(day) ?? [] };
      })
    );
  }
  return rows;
}

export function listGroups(cards: CardModel[], today: string): ListGroup[] {
  return [...groupByDay(cards)].map(([day, list]) => {
    const [y, m, d] = parts(day);
    const weekday = WEEKDAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7]!;
    return { day, label: `${weekday} ${d} ${MONTHS[m - 1]}`, past: day < today, cards: list };
  });
}

const PAST_WEEKS = 4;
const FEED_DAYS = 365;
const FUTURE_WEEKS = 12;

export function monthRange(cards: CardModel[], today: string): string[] {
  const days = cards.map((card) => card.day).sort();
  const early = addDays(today, -PAST_WEEKS * 7);
  const late = addDays(today, FUTURE_WEEKS * 7);
  const first = days[0];
  const last = days[days.length - 1];
  const from = first && first < early ? first : early;
  const to = last && last > late ? last : late;
  const months: string[] = [];
  for (let month = monthOf(from); month <= monthOf(to); month = addMonths(month, 1)) months.push(month);
  return months;
}

export function nextPostDay(cards: CardModel[], day: string): string | undefined {
  return cards
    .map((card) => card.day)
    .sort()
    .find((candidate) => candidate >= day);
}

export function thumbUrl(card: CardModel, size = 112): string | null {
  const image = card.images[0];
  const folder = card.id.split('/')[0];
  return image && folder ? `/img/${encodeURIComponent(folder)}/${encodeURIComponent(image)}?size=${size}` : null;
}
