const ZONE = 'Europe/Amsterdam';

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const clockFormat = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fullFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});

const whenFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const whenLabel = (stamp: string): string => whenFormat.format(new Date(`${stamp}:00`));
const longDayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const longClockFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
export const longWhenLabel = (stamp: string): string => {
  const date = new Date(`${stamp}:00`);
  return `${longDayFormat.format(date)} ${longClockFormat.format(date)}`;
};
export function parseClock(text: string): string | null {
  const match = /^\s*(\d{1,2})(?:[:.]?(\d{2}))?\s*$/.exec(text);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? '0');
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export const ymd = (date: Date): string => dayFormat.format(date);
export const clock = (date: Date): string => clockFormat.format(date);

function offsetMs(utc: number): number {
  const parts = fullFormat.formatToParts(new Date(utc));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return local - Math.floor(utc / 1000) * 1000;
}

export function parseDate(value: string): Date {
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`invalid date "${value}"`);
    return date;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new Error(`invalid date "${value}"; write it like 2026-11-20T10:30`);
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const calendar = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (calendar.getUTCMonth() !== mo - 1 || calendar.getUTCDate() !== d || h > 23 || mi > 59) throw new Error(`invalid date "${value}"`);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - offsetMs(guess);
  return new Date(guess - offsetMs(first));
}

export const shortDay = (day: string, now: Date): string =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(day.slice(0, 4) !== ymd(now).slice(0, 4) && { year: 'numeric' }), timeZone: 'UTC' });
