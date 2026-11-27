import type { Row } from './csv.ts';
import type { Point } from './insights.ts';
import type { PlaceKind } from './stats.ts';

export const placeKindOf = (value: string | null | undefined): PlaceKind => (value === 'city' ? 'city' : 'country');

const regions = new Intl.DisplayNames(['en-GB'], { type: 'region' });
export const placeName = (kind: PlaceKind, place: string): string => (kind === 'country' && /^[A-Z]{2}$/.test(place) ? (regions.of(place) ?? place) : place);

const keyOf = (kind: PlaceKind, place: string): string => (kind === 'city' ? place.split(',')[0]!.trim() : place);

interface Measured {
  date: string;
  places: Map<string, number>;
}

function measurements(rows: Row[], kind: PlaceKind): Measured[] {
  const days = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.kind !== kind) continue;
    const places = days.get(row.date!) ?? new Map<string, number>();
    const key = keyOf(kind, row.place!);
    places.set(key, (places.get(key) ?? 0) + Number(row.count));
    days.set(row.date!, places);
  }
  return [...days].map(([date, places]) => ({ date, places })).sort((a, b) => a.date.localeCompare(b.date));
}

export interface Share {
  place: string;
  count: number;
  share: number;
  change: number | null;
  points: Point[];
}

export function sharesOf(accounts: Row[][], kind: PlaceKind, from: string): Share[] {
  const lines = accounts.map((rows) => measurements(rows, kind)).filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const started = lines.map((line) => line[0]!.date).sort().at(-1)!;
  const start = from > started ? from : started;
  const dates = [start, ...[...new Set(lines.flatMap((line) => line.map((found) => found.date)))].filter((date) => date > start).sort()];
  const standing = (line: Measured[], date: string): Measured => line.findLast((found) => found.date <= date)!;
  const states = dates.map((date) => {
    const places = new Map<string, number>();
    for (const line of lines) for (const [place, count] of standing(line, date).places) places.set(place, (places.get(place) ?? 0) + count);
    return { date, places, total: [...places.values()].reduce((sum, count) => sum + count, 0) };
  });
  const moved = lines.some((line) => standing(line, dates[0]!) !== standing(line, dates.at(-1)!));
  const shareIn = (state: (typeof states)[number], place: string): number => (state.total === 0 ? 0 : (100 * (state.places.get(place) ?? 0)) / state.total);
  const last = states.at(-1)!;
  return [...last.places]
    .map(([place, count]) => {
      const points = states.map((state) => ({ date: state.date, value: shareIn(state, place) }));
      return { place, count, share: points.at(-1)!.value, change: moved ? points.at(-1)!.value - points[0]!.value : null, points };
    })
    .sort((a, b) => b.count - a.count || a.place.localeCompare(b.place));
}
