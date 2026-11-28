import { addDays } from './calendar.ts';
import type { Row } from './csv.ts';
import { clock, ymd } from './time.ts';

const HOUR_MS = 3_600_000;
const FIRST_HOUR = 7;
const LAST_HOUR = 23;
const SOON_MS = 15 * 60_000;
const LOOK_AHEAD_DAYS = 60;
const SUGGESTIONS = 3;

export interface OnlineDay {
  end_time?: string;
  value?: Record<string, number>;
}

export function hoursOf(days: OnlineDay[]): Row[] {
  const totals = Array.from({ length: 24 }, () => ({ sum: 0, days: 0 }));
  for (const { end_time: end, value } of days) {
    if (!end || !value || Object.keys(value).length < 24) continue;
    const start = Date.parse(end) - 24 * HOUR_MS;
    for (let key = 0; key < 24; key++) {
      const total = totals[Number(clock(new Date(start + key * HOUR_MS)).slice(0, 2))]!;
      total.sum += value[key] ?? 0;
      total.days += 1;
    }
  }
  return totals.flatMap((total, hour) => (total.days > 0 ? [{ hour: String(hour), followers: String(Math.round(total.sum / total.days)) }] : []));
}

export function bestHour(rows: Row[]): number | null {
  const followers = new Map(rows.map((row) => [Number(row.hour), Number(row.followers)]));
  const waking = [...followers].filter(([hour]) => hour >= FIRST_HOUR && hour <= LAST_HOUR);
  const [hour, most] = waking.sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] ?? [0, 0];
  return most === 0 ? null : hour;
}

export function freeMoments(hour: number, taken: Set<string>, now: Date): string[] {
  const later = new Date(now.getTime() + SOON_MS);
  const earliest = `${ymd(later)}T${clock(later)}`;
  const found: string[] = [];
  for (let ahead = 0; ahead < LOOK_AHEAD_DAYS && found.length < SUGGESTIONS; ahead++) {
    const day = addDays(ymd(now), ahead);
    const moment = `${day}T${String(hour).padStart(2, '0')}:00`;
    if (!taken.has(day) && moment > earliest) found.push(moment);
  }
  return found;
}
