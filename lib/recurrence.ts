export type EventRecurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export type RecurrenceRule = {
  eventDate: string;
  recurrence: EventRecurrence;
  recurrenceInterval: number;
  recurrenceDay: number | null;
  recurrenceUntil?: string | null;
};

const DAY_MS = 86_400_000;

export function isValidEventDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 9999) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isValidEventTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function getSeoulDate(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function monthDate(year: number, monthIndex: number, day: number) {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return Date.UTC(year, monthIndex, Math.min(day, last));
}

// UTC represents calendar arithmetic here, not the instant of a Korean event.
export function nextOccurrenceDate(rule: RecurrenceRule, onOrAfter: string): string | null {
  if (!isValidEventDate(rule.eventDate) || !isValidEventDate(onOrAfter)) return null;
  const { recurrence, recurrenceInterval: interval, recurrenceDay } = rule;
  if (!Number.isInteger(interval) || interval < 1 || interval > 99) return null;
  const [year, month, day] = rule.eventDate.split('-').map(Number);
  const anchor = Date.UTC(year, month - 1, day);
  const threshold = Math.max(anchor, Date.parse(`${onOrAfter}T00:00:00Z`));
  const target = new Date(threshold);
  let candidate: number;
  if (recurrence === 'none') return anchor >= threshold ? rule.eventDate : null;
  if (recurrence === 'daily' || recurrence === 'weekly') {
    let first = anchor;
    if (recurrence === 'weekly') {
      const weekday = recurrenceDay ?? new Date(anchor).getUTCDay();
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
      first += ((weekday - new Date(anchor).getUTCDay() + 7) % 7) * DAY_MS;
    }
    const step = interval * (recurrence === 'weekly' ? 7 : 1) * DAY_MS;
    candidate = first + Math.max(0, Math.ceil((threshold - first) / step)) * step;
  } else if (recurrence === 'monthly') {
    const targetDay = recurrenceDay ?? day;
    if (!Number.isInteger(targetDay) || targetDay < 1 || targetDay > 31) return null;
    const anchorMonth = year * 12 + month - 1;
    const targetMonth = target.getUTCFullYear() * 12 + target.getUTCMonth();
    let step = Math.max(0, Math.floor((targetMonth - anchorMonth) / interval));
    const at = (n: number) => {
      const absoluteMonth = anchorMonth + n * interval;
      return monthDate(Math.floor(absoluteMonth / 12), absoluteMonth % 12, targetDay);
    };
    candidate = at(step);
    if (candidate < threshold) candidate = at(++step);
  } else if (recurrence === 'yearly') {
    let step = Math.max(0, Math.floor((target.getUTCFullYear() - year) / interval));
    candidate = monthDate(year + step * interval, month - 1, day);
    if (candidate < threshold) candidate = monthDate(year + ++step * interval, month - 1, day);
  } else return null;
  const result = new Date(candidate).toISOString().slice(0, 10);
  return isValidEventDate(result) && (!rule.recurrenceUntil || result <= rule.recurrenceUntil) ? result : null;
}

export function occurrenceInstant(date: string, time: string) {
  return new Date(`${date}T${time}:00+09:00`);
}

export function reminderOccurrences(rule: RecurrenceRule, time: string, offsetMinutes: number, from: Date, until: Date) {
  const results: Array<{ occurrenceAt: string; dueAt: string }> = [];
  if (!isValidEventTime(time) || !Number.isInteger(offsetMinutes) || offsetMinutes < 0 || offsetMinutes > 525_600) return results;
  const offset = offsetMinutes * 60_000;
  const lastDate = getSeoulDate(new Date(until.getTime() + offset));
  let date = nextOccurrenceDate(rule, getSeoulDate(new Date(from.getTime() + offset)));
  while (date && date <= lastDate) {
    const occurrence = occurrenceInstant(date, time);
    const due = new Date(occurrence.getTime() - offset);
    if (due >= from && due <= until) results.push({ occurrenceAt: occurrence.toISOString(), dueAt: due.toISOString() });
    const followingDay = new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
    date = nextOccurrenceDate(rule, followingDay);
  }
  return results;
}
