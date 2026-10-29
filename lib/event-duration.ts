import { getSeoulDate, isValidEventDate, nextOccurrenceDate, type RecurrenceRule } from './recurrence';

export type EventDuration = RecurrenceRule & {
  eventTime: string; allDay?: boolean; allDayReminderTime?: string;
  endDate?: string | null; endTime?: string | null;
};
const DAY_MS = 86_400_000;
export const MAX_EVENT_SPAN_DAYS = 366;

export function daysBetween(start: string, end: string) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS);
}

export function shiftEventDate(date: string, days: number) {
  const shifted = new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
  return isValidEventDate(shifted) ? shifted : null;
}

export function reminderTime(event: Pick<EventDuration, 'allDay' | 'allDayReminderTime' | 'eventTime'>) {
  return event.allDay ? event.allDayReminderTime ?? '09:00' : event.eventTime;
}

export function occurrenceEndDate(event: EventDuration, start: string) {
  return event.endDate ? shiftEventDate(start, daysBetween(event.eventDate, event.endDate)) : start;
}

export function lastCoveredDate(event: EventDuration, start: string) {
  const end = occurrenceEndDate(event, start);
  if (!end) return null;
  return !event.allDay && event.endTime === '00:00' && end > start ? shiftEventDate(end, -1) : end;
}

/** Recurrence starts, not day cells: a multi-day instance generates reminders only once. */
export function occurrencesInRange(event: EventDuration, from: string, through: string) {
  const duration = Math.max(0, Math.min(MAX_EVENT_SPAN_DAYS, event.endDate ? daysBetween(event.eventDate, event.endDate) : 0));
  const lower = shiftEventDate(from, -duration) ?? '1900-01-01';
  let start = nextOccurrenceDate(event, lower);
  const result: Array<{ start: string; end: string; lastCovered: string }> = [];
  while (start && start <= through) {
    const end = occurrenceEndDate(event, start);
    const lastCovered = lastCoveredDate(event, start);
    if (end && lastCovered && lastCovered >= from) result.push({ start, end, lastCovered });
    const after = shiftEventDate(start, 1);
    start = after ? nextOccurrenceDate(event, after) : null;
  }
  return result;
}

export function relevantOccurrenceDate(event: EventDuration, today = getSeoulDate(), now?: Date) {
  const spans = occurrencesInRange(event, today, today);
  const current = spans.filter((span) => occurrenceDayStatus(event, span.start, today, now) === 'ongoing').at(-1)
    ?? spans.filter((span) => occurrenceDayStatus(event, span.start, today, now) !== 'past').at(-1);
  if (current) return current.start;
  let next = nextOccurrenceDate(event, today);
  if (next && occurrenceDayStatus(event, next, today, now) === 'past') {
    const following = shiftEventDate(today, 1);
    next = following ? nextOccurrenceDate(event, following) : null;
  }
  return next ?? event.eventDate;
}

export function occurrenceDayStatus(event: EventDuration, start: string, today: string, now?: Date) {
  if (now && !event.allDay && event.endDate && event.endTime) {
    const end = occurrenceEndDate(event, start);
    if (end) {
      if (now.getTime() >= Date.parse(`${end}T${event.endTime}:00+09:00`)) return 'past';
      if (now.getTime() >= Date.parse(`${start}T${event.eventTime}:00+09:00`)) return 'ongoing';
      return 'upcoming';
    }
  }
  const end = lastCoveredDate(event, start) ?? start;
  if (end < today) return 'past';
  if ((start < today || (event.allDay && start === today)) && end >= today) return 'ongoing';
  return 'upcoming';
}

export function formatEventRange(event: EventDuration, start: string) {
  const end = occurrenceEndDate(event, start) ?? start;
  const date = (value: string) => new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
  if (event.allDay) return `${date(start)}${end !== start ? ` ~ ${date(end)}` : ''} · 종일`;
  if (!event.endDate) return `${date(start)} ${event.eventTime}`;
  return `${date(start)} ${event.eventTime} ~ ${end !== start ? `${date(end)} ` : ''}${event.endTime}`;
}
