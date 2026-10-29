import { isValidEventDate, isValidEventTime, nextOccurrenceDate, type EventRecurrence } from './recurrence';
import { daysBetween, MAX_EVENT_SPAN_DAYS } from './event-duration';
import { parseKakaoPlace, type KakaoPlace } from './kakao-place';
import { parseTravelPlan, type TravelPlan } from './travel-plan';
import { parseEventCategory } from './event-category';

export type EventInput = {
  title: string; category: string; eventDate: string; eventTime: string;
  location: string; note: string; recurrence: EventRecurrence; recurrenceInterval: number; recurrenceDay: number | null;
  allDay: boolean; allDayReminderTime: string; endDate: string | null; endTime: string | null;
  place: KakaoPlace | null;
  travelPlan: TravelPlan | null;
  preparationsEnabled: boolean;
  recurrenceUntil: string | null;
};
type ExistingDuration = { all_day: number; all_day_reminder_time: string; end_date: string | null; end_time: string | null; location?: string; place?: KakaoPlace | null; travelPlan?: TravelPlan | null; preparations_enabled?: number; recurrence_until?: string | null };
const recurrences = new Set(['none', 'daily', 'weekly', 'monthly', 'yearly']);

export function parseEventInput(body: Record<string, unknown> | null, existing?: ExistingDuration): EventInput | null {
  if (!body) return null;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const category = parseEventCategory(body.category);
  const eventDate = typeof body.eventDate === 'string' ? body.eventDate : '';
  const allDay = body.allDay === undefined ? !!existing?.all_day : body.allDay;
  const preparationsEnabled = body.preparationsEnabled === undefined ? existing?.preparations_enabled !== 0 : body.preparationsEnabled;
  if (typeof preparationsEnabled !== 'boolean') return null;
  const eventTime = typeof body.eventTime === 'string' ? body.eventTime : allDay ? '09:00' : '';
  const allDayReminderTime = body.allDayReminderTime === undefined ? existing?.all_day_reminder_time ?? '09:00' : body.allDayReminderTime;
  const endDate = body.endDate === undefined ? existing?.end_date ?? null : body.endDate;
  const endTime = body.endTime === undefined ? existing?.end_time ?? null : body.endTime;
  const location = typeof body.location === 'string' ? body.location.trim() : '';
  // Older clients preserve a selection only while the location text still matches.
  const place = body.place === undefined
    ? (existing?.place?.name === location ? existing.place : null)
    : body.place === null ? null : parseKakaoPlace(body.place);
  if (body.place != null && (!place || place.name !== location)) return null;
  const sameDestination = place && existing?.place && JSON.stringify(place) === JSON.stringify(existing.place);
  const travelPlan = body.travelPlan === undefined
    ? (sameDestination ? existing?.travelPlan ?? null : null)
    : body.travelPlan === null ? null : parseTravelPlan(body.travelPlan);
  if ((body.travelPlan != null && !travelPlan) || (travelPlan && !place)) return null;
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  const recurrence = typeof body.recurrence === 'string' ? body.recurrence : 'none';
  const recurrenceInterval = Number(body.recurrenceInterval ?? 1);
  const recurrenceUntil = recurrence === 'none' ? null : body.recurrenceUntil === undefined ? existing?.recurrence_until ?? null : body.recurrenceUntil;
  if (recurrenceUntil !== null && (typeof recurrenceUntil !== 'string' || !isValidEventDate(recurrenceUntil) || recurrenceUntil < eventDate)) return null;
  const recurrenceDay = recurrence === 'weekly'
    ? Number(body.recurrenceDay ?? new Date(`${eventDate}T00:00:00Z`).getUTCDay())
    : recurrence === 'monthly' ? Number(body.recurrenceDay ?? eventDate.slice(8, 10)) : null;
  if (!title || title.length > 100 || !category || !isValidEventDate(eventDate) || !isValidEventTime(eventTime)
    || location.length > 120 || note.length > 500 || !recurrences.has(recurrence)
    || !Number.isInteger(recurrenceInterval) || recurrenceInterval < 1 || recurrenceInterval > 99
    || (recurrence === 'weekly' && (recurrenceDay === null || !Number.isInteger(recurrenceDay) || recurrenceDay < 0 || recurrenceDay > 6))
    || (recurrence === 'monthly' && (recurrenceDay === null || !Number.isInteger(recurrenceDay) || recurrenceDay < 1 || recurrenceDay > 31))
    || typeof allDay !== 'boolean' || typeof allDayReminderTime !== 'string' || !isValidEventTime(allDayReminderTime)
    || (endDate !== null && (typeof endDate !== 'string' || !isValidEventDate(endDate)))
    || (endTime !== null && (typeof endTime !== 'string' || !isValidEventTime(endTime)))) return null;
  if (endDate && (endDate < eventDate || daysBetween(eventDate, endDate) > MAX_EVENT_SPAN_DAYS)) return null;
  if (allDay ? endTime !== null : (endDate === null) !== (endTime === null)) return null;
  if (!allDay && endDate && endTime && `${endDate}T${endTime}` <= `${eventDate}T${eventTime}`) return null;
  if (recurrenceUntil && !nextOccurrenceDate({ eventDate, recurrence: recurrence as EventRecurrence, recurrenceInterval, recurrenceDay, recurrenceUntil }, eventDate)) return null;
  return { title, category, eventDate, eventTime, location, note, recurrence: recurrence as EventRecurrence,
    recurrenceInterval, recurrenceDay, recurrenceUntil, allDay, allDayReminderTime, endDate, endTime, place, travelPlan, preparationsEnabled };
}
