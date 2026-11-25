import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseClock, parseDate, ymd } from './time.ts';

test('date is Europe/Amsterdam, winter and summer', () => {
  assert.equal(parseDate('2026-11-20T09:00').toISOString(), '2026-11-20T08:00:00.000Z');
  assert.equal(parseDate('2026-07-01T09:00').toISOString(), '2026-07-01T07:00:00.000Z');
  assert.equal(parseDate('2026-11-20T09:00+01:00').toISOString(), '2026-11-20T08:00:00.000Z');
  for (const bad of ['2026-13-01T09:00', '2026-02-30T09:00', '2026-11-20T24:00', '2026-11-20T09:60']) {
    assert.throws(() => parseDate(bad), /invalid date/, bad);
  }
  assert.throws(() => parseDate('morgen'));
});

test('days are taken in Amsterdam time, not UTC', () => {
  assert.equal(ymd(new Date('2026-11-20T23:30:00Z')), '2026-11-21');
  assert.equal(ymd(new Date('2026-07-01T22:30:00Z')), '2026-07-02');
});

test('parseClock accepts the ways people type a time', () => {
  for (const [input, expected] of [['9', '09:00'], ['09', '09:00'], ['930', '09:30'], ['9:30', '09:30'], ['9.30', '09:30'], ['2130', '21:30'], [' 21 ', '21:00'], ['0:05', '00:05']] as const) {
    assert.equal(parseClock(input), expected, input);
  }
  for (const input of ['', '24', '2460', '9:5', 'abc', '12:345', '-1']) assert.equal(parseClock(input), null, input);
});
