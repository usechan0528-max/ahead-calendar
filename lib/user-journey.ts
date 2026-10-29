import { getSeoulDate, isValidEventDate } from './recurrence';
import { occurrenceDayStatus, shiftEventDate } from './event-duration';
import { resolveOccurrence, resolvedOccurrencesInRange, type OccurrenceEvent } from './occurrences';

export type JourneyEvent = OccurrenceEvent & { id: number; storageId?: number; isSample?: boolean; preparationsEnabled?: boolean };
export function recentUnfinished<T extends JourneyEvent>(schedules: T[], completed: Array<{eventId: number; date: string}>, now: number) {
  const today = getSeoulDate(new Date(now));
  const from = shiftEventDate(today, -7) ?? '1900-01-01';
  const through = shiftEventDate(today, -1);
  if (!through) return [];
  const done = new Set(completed.map((item) => `${item.eventId}:${item.date}`));
  return schedules.filter((event) => !event.isSample && event.storageId).flatMap((event) =>
    resolvedOccurrencesInRange(event, from, through).filter((row) => row.lastCovered < today
      && occurrenceDayStatus(row.event, row.start, today, new Date(now)) === 'past'
      && !done.has(`${event.storageId}:${row.originalDate}`)).map((row) => ({ ...row, master: event })),
  ).sort((a, b) => b.lastCovered.localeCompare(a.lastCovered) || a.start.localeCompare(b.start) || a.originalDate.localeCompare(b.originalDate));
}

export function tomorrowOccurrences<T extends JourneyEvent>(schedules: T[], now: number) {
  const tomorrow = shiftEventDate(getSeoulDate(new Date(now)), 1);
  return tomorrow ? schedules.filter((event) => !event.isSample && event.storageId)
    .flatMap((event) => resolvedOccurrencesInRange(event, tomorrow, tomorrow))
    .sort((a, b) => a.start.localeCompare(b.start) || a.event.eventTime.localeCompare(b.event.eventTime)) : [];
}

export const RESUME_KEY = 'to-j:last-view:v1';
export type DetailDestination = 'summary' | 'preparations' | 'reminders' | 'place';
export type ResumeBookmark = { version: 1; eventId: number; originalDate: string; section: DetailDestination };
export function readResumeBookmark(raw: string | null): ResumeBookmark | null {
  if (!raw) return null;
  try {
    const item = JSON.parse(raw);
    if (!item || item.version !== 1 || !Number.isSafeInteger(item.eventId) || item.eventId < 1
      || !isValidEventDate(item.originalDate) || !['summary','preparations','reminders','place'].includes(item.section)) return null;
    return { version: 1, eventId: item.eventId, originalDate: item.originalDate, section: item.section };
  } catch { return null; }
}
export function resolveResume<T extends JourneyEvent>(bookmark: ResumeBookmark | null, schedules: T[]) {
  const master = bookmark && schedules.find((event) => !event.isSample && event.storageId === bookmark.eventId);
  if (!bookmark || !master) return null;
  const row = resolveOccurrence(master, bookmark.originalDate);
  if (!row) return null;
  const section = bookmark.section === 'preparations' && master.preparationsEnabled === false ? 'summary' : bookmark.section;
  return { ...row, section, id: master.id };
}

export const SNOOZE_MINUTES = [10, 30, 60] as const;
export type SnoozeMinutes = typeof SNOOZE_MINUTES[number];
export function isSnoozeMinutes(value: unknown): value is SnoozeMinutes { return SNOOZE_MINUTES.some((minutes) => value === minutes); }
export function parseSnoozeBody(raw: string): SnoozeMinutes | null {
  if (!raw.trim()) return 10;
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    return !Object.hasOwn(body, 'minutes') ? 10 : isSnoozeMinutes(body.minutes) ? body.minutes : null;
  } catch { return null; }
}

export function notificationDestination(input: { kind: string; offset: number | null; preparationsEnabled: boolean; hasLocation: boolean }): DetailDestination {
  if (input.kind !== 'reminder') return 'reminders';
  if (input.offset !== null && input.offset > 0 && input.preparationsEnabled) return 'preparations';
  return input.hasLocation ? 'place' : 'summary';
}
