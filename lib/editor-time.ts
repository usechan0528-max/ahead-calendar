import { isValidEventDate, isValidEventTime } from './recurrence';
import { daysBetween, MAX_EVENT_SPAN_DAYS } from './event-duration';

/** Shift the end by exactly the start-time delta; never repair an invalid range silently. */
export function shiftEndWithStart(date: string, previous: string, next: string, endDate: string, endTime: string) {
  if (![date, endDate].every(isValidEventDate) || ![previous, next, endTime].every(isValidEventTime)) return null;
  const start = Date.parse(`${date}T${previous}:00Z`);
  const end = Date.parse(`${endDate}T${endTime}:00Z`);
  if (end <= start || daysBetween(date, endDate) > MAX_EVENT_SPAN_DAYS) return null;
  const moved = new Date(Date.parse(`${date}T${next}:00Z`) + end - start).toISOString();
  const movedDate = moved.slice(0, 10);
  if (!isValidEventDate(movedDate) || daysBetween(date, movedDate) > MAX_EVENT_SPAN_DAYS) return null;
  return { endDate: movedDate, endTime: moved.slice(11, 16) };
}
