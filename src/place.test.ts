import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spotFor } from './place.ts';

const view = { left: 0, top: 0, width: 375, height: 700 };
const anchor = (left: number, top: number) => ({ left, right: left + 40, top, bottom: top + 40 });
const below = { align: 'start' as const, side: 'below' as const };

test('a panel stands 4 px under what opened it, on its start or its end', () => {
  assert.deepEqual(spotFor(anchor(20, 100), { width: 200, height: 300 }, view, below), { left: 20, top: 144 });
  assert.deepEqual(spotFor(anchor(300, 100), { width: 200, height: 300 }, view, { ...below, align: 'end' }), { left: 140, top: 144 });
});

test('it goes to the other side when only that has room, and never leaves the view, however its anchor stands', () => {
  assert.equal(spotFor(anchor(20, 600), { width: 200, height: 300 }, view, below).top, 296);
  assert.equal(spotFor(anchor(20, 100), { width: 200, height: 300 }, view, { ...below, side: 'above' }).top, 144);
  for (const place of [anchor(200, 300), anchor(-500, -500), anchor(900, 900)]) {
    const spot = spotFor(place, { width: 343, height: 520 }, view, below);
    assert.ok(spot.left >= 8 && spot.left + 343 <= 367, `left ${spot.left}`);
    assert.ok(spot.top >= 8 && spot.top + 520 <= 692, `top ${spot.top}`);
  }
});

test('the view can be a part of the page, as with a keyboard open', () => {
  assert.deepEqual(spotFor(anchor(20, 500), { width: 200, height: 250 }, { left: 0, top: 200, width: 375, height: 360 }, below), { left: 20, top: 246 });
});
