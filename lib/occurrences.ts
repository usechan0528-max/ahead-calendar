import { getSeoulDate, nextOccurrenceDate, occurrenceInstant } from './recurrence';
import { lastCoveredDate, occurrenceDayStatus, occurrenceEndDate, occurrencesInRange, reminderTime, shiftEventDate, type EventDuration } from './event-duration';

export type OccurrenceChanges = {
  title: string; note: string; eventDate: string; eventTime: string;
  allDay: boolean; allDayReminderTime: string; endDate: string | null; endTime: string | null;
};
export type OccurrenceOverride = { originalDate: string; cancelled: boolean; changes: OccurrenceChanges | null; updatedAt: string };
export type OccurrenceEvent = EventDuration & { occurrenceOverrides?: OccurrenceOverride[] };
export type ResolvedOccurrence<T> = { originalDate: string; start: string; end: string; lastCovered: string; event: T };

/** Stable identity always comes from the series, never from a moved date. */
export function resolveOccurrence<T extends OccurrenceEvent>(event: T, originalDate: string): ResolvedOccurrence<T> | null {
  if (nextOccurrenceDate(event, originalDate) !== originalDate) return null;
  const override = event.occurrenceOverrides?.find((item) => item.originalDate === originalDate);
  if (override?.cancelled) return null;
  const start = override?.changes?.eventDate ?? originalDate;
  const effective = { ...event, eventDate: originalDate, endDate: event.endDate ? occurrenceEndDate(event, originalDate) : null, ...override?.changes,
    // A resolved view is a single instance. The master retains the repeat rule.
    recurrence: 'none' as const, recurrenceUntil: null, occurrenceOverrides: [] };
  const end = occurrenceEndDate(effective, start);
  const last = lastCoveredDate(effective, start);
  return end && last ? { originalDate, start, end, lastCovered: last, event: effective } : null;
}

export function resolvedOccurrencesInRange<T extends OccurrenceEvent>(event: T, from: string, through: string): ResolvedOccurrence<T>[] {
  const identities = new Set(occurrencesInRange(event, from, through).map((span) => span.start));
  // Include exceptions whose original dates lie outside the visible window.
  for (const override of event.occurrenceOverrides ?? []) identities.add(override.originalDate);
  return [...identities].map((date) => resolveOccurrence(event, date))
    .filter((item): item is ResolvedOccurrence<T> => !!item && item.start <= through && item.lastCovered >= from)
    .sort((a, b) => a.start.localeCompare(b.start) || a.event.eventTime.localeCompare(b.event.eventTime) || a.originalDate.localeCompare(b.originalDate));
}

export function relevantResolvedOccurrence<T extends OccurrenceEvent>(event: T, today = getSeoulDate(), now?: Date, excludedOriginalDates?: ReadonlySet<string>): ResolvedOccurrence<T> | null {
  const eligible = (row: ResolvedOccurrence<T> | null): row is ResolvedOccurrence<T> => !!row && !excludedOriginalDates?.has(row.originalDate) && occurrenceDayStatus(row.event, row.start, today, now) !== 'past';
  const current = resolvedOccurrencesInRange(event, today, today).filter(eligible);
  if (current.length) return current.filter((row) => occurrenceDayStatus(row.event, row.start, today, now) === 'ongoing').at(-1) ?? current[0];
  const candidates = (event.occurrenceOverrides ?? []).map((override) => resolveOccurrence(event, override.originalDate))
    .filter((row): row is ResolvedOccurrence<T> => eligible(row) && row.start >= today);
  let next = nextOccurrenceDate(event, today);
  // Only finitely many overrides can hide the next base occurrence.
  for (let i = 0; next && i <= (event.occurrenceOverrides?.length ?? 0) + (excludedOriginalDates?.size ?? 0) + 1; i++) {
    const row = resolveOccurrence(event, next);
    if (eligible(row) && row.start >= today) candidates.push(row);
    if (!event.occurrenceOverrides?.some((override) => override.originalDate === next) && eligible(row)) break;
    const after = shiftEventDate(next, 1);
    next = after ? nextOccurrenceDate(event, after) : null;
  }
  return candidates.sort((a, b) => a.start.localeCompare(b.start) || a.event.eventTime.localeCompare(b.event.eventTime) || a.originalDate.localeCompare(b.originalDate))[0] ?? null;
}

export function resolvedReminderOccurrences<T extends OccurrenceEvent>(event: T, offsetMinutes: number, from: Date, until: Date) {
  const offset = offsetMinutes * 60_000;
  const fromDate = getSeoulDate(new Date(from.getTime() + offset));
  const through = getSeoulDate(new Date(until.getTime() + offset));
  return resolvedOccurrencesInRange(event, fromDate, through).flatMap((row) => {
    const occurrenceAt = occurrenceInstant(row.start, reminderTime(row.event)).toISOString();
    const due = new Date(Date.parse(occurrenceAt) - offset);
    const changedAt = event.occurrenceOverrides?.find((item) => item.originalDate === row.originalDate)?.updatedAt;
    return due >= from && due <= until && (!changedAt || due >= new Date(changedAt))
      ? [{ ...row, occurrenceAt, dueAt: due.toISOString() }] : [];
  });
}
