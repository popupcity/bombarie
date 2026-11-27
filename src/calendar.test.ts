import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDays,
  addMonths,
  buildCalendarData,
  listGroups,
  monthLabel,
  monthWeeks,
  statusOf,
  weekStart
} from './calendar.ts';
import type { CalendarInput } from './calendar.ts';
import type { State } from './state.ts';
import type { Post } from './types.ts';

const now = new Date('2026-11-12T20:00:00Z');

function post(id: string, date: string, over: Partial<Post> = {}): Post {
  return {
    id,
    channel: 'jeroen-linkedin',
    type: null,
    status: 'planned',
    manual: false,
    date: new Date(date),
    images: [],
    mentions: {},
    text: 'Hallo wereld',
    ...over
  };
}

function input(posts: Post[], over: Partial<CalendarInput> = {}): CalendarInput {
  return {
    posts,
    states: new Map(),
    errors: [],
    attention: [],
    channels: [
      { name: 'jeroen-linkedin', platform: 'linkedin', label: 'jeroen-linkedin' },
      { name: 'popupcity-instagram', platform: 'instagram', label: 'popupcity-instagram' }
    ],
    now,
    ...over
  };
}

test('weeks start on Monday', () => {
  assert.equal(weekStart('2026-11-20'), '2026-11-16');
  assert.equal(weekStart('2026-11-22'), '2026-11-16');
  assert.equal(weekStart('2026-11-16'), '2026-11-16');
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
});

test('statusOf follows state first, then manual, draft and lateness', () => {
  const p = post('f/a.md', '2026-11-12T19:00:00Z');
  const posted: State = { status: 'posted', at: 'x', remoteId: '1' };
  assert.equal(statusOf(p, posted, now), 'posted');
  assert.equal(statusOf(p, { status: 'reminded', at: 'x' }, now), 'reminded');
  assert.equal(statusOf(post('f/a.md', '2026-11-20T09:00:00Z', { manual: true }), null, now), 'planned');
  assert.equal(statusOf(post('f/a.md', '2026-11-20T09:00:00Z', { status: 'draft' }), null, now), 'draft');
  assert.equal(statusOf(post('f/a.md', '2026-11-20T09:00:00Z', { status: 'draft', manual: true }), null, now), 'draft');
  assert.equal(statusOf(post('f/a.md', '2026-11-20T09:00:00Z'), null, now), 'planned');
  assert.equal(statusOf(post('f/a.md', '2026-11-12T10:00:00Z'), null, now), 'late');
  assert.equal(statusOf(post('f/a.md', '2026-11-12T19:30:00Z'), null, now), 'planned');
});

test('attention collects late posts, state problems and read errors', () => {
  const { notices } = buildCalendarData(
    input([post('f/late.md', '2026-11-12T10:00:00Z')], {
      errors: ['f/broken.md: date is required'],
      attention: [{ id: 'f/x.md', status: 'unconfirmed', message: 'timeout; check the platform' }]
    })
  );
  assert.deepEqual(
    notices.map((n) => [n.where, n.text]),
    [
      [['jeroen-linkedin', 'F', '12 Nov 11:00'], 'more than an hour late, so it was skipped'],
      [['f/x.md'], 'timeout; check the platform'],
      [[], 'f/broken.md: date is required']
    ]
  );
  assert.deepEqual(
    notices.map((n) => n.id),
    ['f/late.md', 'f/x.md', undefined]
  );
  assert.deepEqual(
    notices.map((n) => n.label),
    ['Late', 'Unconfirmed', 'Error']
  );
  assert.equal(buildCalendarData(input([])).notices.length, 0);
});

test('a read error links to its post only when the file name carries a campaign folder and a channel matches', () => {
  const { notices } = buildCalendarData(
    input([], {
      errors: [
        '2026-11-20-expo/jeroen-linkedin.md: date is required',
        '2026-11-20-expo/stray.md: no channel matches this file name',
        'entities/Pop-Up City.md: unknown key "x"'
      ]
    })
  );
  assert.deepEqual(
    notices.map((n) => n.id),
    ['2026-11-20-expo/jeroen-linkedin.md', undefined, undefined]
  );
});

const ids = (cards: { id: string }[]) => cards.map((c) => c.id);

test('monthWeeks lays a month out Monday first and marks the days outside it', () => {
  const { cards, today } = buildCalendarData(input([post('f/a.md', '2026-11-20T09:00:00Z'), post('f/b.md', '2026-10-30T09:00:00Z')]));
  const weeks = monthWeeks(cards, '2026-11', today);
  assert.equal(weeks.length, 6);
  assert.deepEqual(
    weeks[0]?.map((d) => d.date),
    [26, 27, 28, 29, 30, 31, 1]
  );
  assert.deepEqual(
    weeks[0]?.map((d) => d.inMonth),
    [false, false, false, false, false, false, true]
  );
  assert.equal(weeks[0]?.[4]?.cards[0]?.id, 'f/b.md');
  assert.equal(weeks[3]?.[4]?.cards[0]?.id, 'f/a.md');
  assert.equal(weeks[2]?.[3]?.today, true);
  assert.equal(weeks[2]?.[2]?.past, true);
  assert.equal(weeks[2]?.[4]?.past, false);
  assert.equal(monthWeeks(cards, '2026-02', today).length, 5);
  assert.equal(monthWeeks(cards, '2027-02', today).length, 4);
});

test('listGroups groups by day in order and marks the past', () => {
  const { cards, today } = buildCalendarData(
    input([post('f/c.md', '2026-11-20T10:00:00Z'), post('f/a.md', '2026-11-03T09:00:00Z'), post('f/b.md', '2026-11-20T08:00:00Z')])
  );
  const groups = listGroups(cards, today);
  assert.deepEqual(
    groups.map((g) => [g.day, g.label, g.past, ids(g.cards)]),
    [
      ['2026-11-03', 'Tue 3 Nov', true, ['f/a.md']],
      ['2026-11-20', 'Fri 20 Nov', false, ['f/b.md', 'f/c.md']]
    ]
  );
});

test('month helpers cross year ends', () => {
  assert.equal(addMonths('2026-11', 1), '2026-12');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(monthLabel('2026-11'), 'November 2026');
});

test('feed items older than a year stay out of the views', () => {
  const now = new Date('2026-11-19T12:00:00Z');
  const feeds = [
    { id: 'feed/a/1', channel: 'a', title: 'New', url: 'https://x/1', at: '2026-11-01T08:00:00Z', text: '' },
    { id: 'feed/a/2', channel: 'a', title: 'Old', url: 'https://x/2', at: '2013-08-20T00:00:00Z', text: '' }
  ];
  const data = buildCalendarData({ posts: [], states: new Map(), errors: [], attention: [], channels: [{ name: 'a', platform: 'feed', label: 'A' }], feeds, now });
  assert.deepEqual(data.cards.map((card) => card.campaign), ['New']);
});
