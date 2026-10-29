import { nextOccurrenceDate, getSeoulDate } from './recurrence';
import { relevantOccurrenceDate, type EventDuration } from './event-duration';

/** Editing an old repeating plan must not unexpectedly send the user to its first year. */
export function savedCalendarDate(saved: EventDuration, previous: EventDuration | null, selectedDate: string, now: number) {
  if (previous && saved.eventDate === previous.eventDate) {
    const sameRule = saved.recurrence === previous.recurrence && saved.recurrenceInterval === previous.recurrenceInterval && saved.recurrenceDay === previous.recurrenceDay;
    if (sameRule && nextOccurrenceDate(saved, selectedDate) === selectedDate) return selectedDate;
    return relevantOccurrenceDate(saved, getSeoulDate(new Date(now)), new Date(now));
  }
  return nextOccurrenceDate(saved, saved.eventDate) ?? saved.eventDate;
}
