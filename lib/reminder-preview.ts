import { getSeoulDate, isValidEventDate, isValidEventTime, occurrenceInstant } from './recurrence';
import { reminderTime, type EventDuration } from './event-duration';
import { relevantResolvedOccurrence, resolveOccurrence } from './occurrences';

/** A settings preview, not a delivery guarantee or a queued-job claim. */
export function previewReminders(event: EventDuration, offsets: number[], now: number) {
  if (!Number.isFinite(now) || !isValidEventDate(event.eventDate) || !isValidEventTime(reminderTime(event))
    || (event.endDate != null && !isValidEventDate(event.endDate))
    || (event.endTime != null && !isValidEventTime(event.endTime))
    || (event.recurrenceUntil != null && !isValidEventDate(event.recurrenceUntil))
    || !Number.isInteger(event.recurrenceInterval ?? 1) || (event.recurrenceInterval ?? 1) < 1) return null;
  const row = relevantResolvedOccurrence(event, getSeoulDate(new Date(now)), new Date(now))
    ?? (event.recurrence === 'none' ? resolveOccurrence(event, event.eventDate) : null);
  if (!row) return { date: null, upcoming: [], past: offsets.length, suggestion: null };
  const at = occurrenceInstant(row.start, reminderTime(row.event)).getTime();
  const upcoming = offsets.map(offset => ({ offset, at: at - offset * 60_000 })).filter(item => item.at > now).sort((a, b) => a.at - b.at);
  const suggestion = at - 10 * 60_000 > now ? 10 : at > now ? 0 : null;
  return { date: row.start, upcoming, past: offsets.length - upcoming.length, suggestion };
}

export function reminderDateLabel(at: number) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(at);
}
