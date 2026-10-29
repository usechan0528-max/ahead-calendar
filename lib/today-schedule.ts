import { getSeoulDate } from './recurrence';
import { occurrenceDayStatus, type EventDuration } from './event-duration';
import { resolvedOccurrencesInRange } from './occurrences';

/** Include today's actual occurrences, even after their end time or on overlapping repeats. */
export function partitionTodaySchedules<T extends EventDuration & { storageId?: number }>(
  schedules: T[], completedEvents: Array<{ eventId: number; date: string }>, now: number,
) {
  const today = getSeoulDate(new Date(now));
  const completed = new Set(completedEvents.map((entry) => `${entry.eventId}:${entry.date}`));
  const rows = schedules.flatMap((item) => resolvedOccurrencesInRange(item, today, today).map(({ event, start, originalDate }) => ({
    item: event, date: start, originalDate, status: occurrenceDayStatus(event, start, today, new Date(now)) as ReturnType<typeof occurrenceDayStatus>,
  }))).sort((a, b) => a.date.localeCompare(b.date) || a.item.eventTime.localeCompare(b.item.eventTime));
  const isComplete = (row: typeof rows[number]) => row.item.storageId !== undefined && completed.has(`${row.item.storageId}:${row.originalDate}`);
  return { remaining: rows.filter((row) => !isComplete(row)), completed: rows.filter(isComplete) };
}
