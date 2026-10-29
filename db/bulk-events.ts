import { env } from 'cloudflare:workers';
import { updateEvent, type StoredEvent } from './events';
import { attemptHistorySql } from './notification-history';
import { refreshEventReminders } from './reminder-planner';
import { shiftEventDate } from '../lib/event-duration';
import type { EventInput } from '../lib/event-input';

export async function readBulkShiftBlockedIds(owner: string) {
  const rows = await env.DB.prepare(`SELECT e.id FROM events e WHERE e.owner_id = ? AND (
    e.recurrence <> 'none' OR EXISTS (SELECT 1 FROM event_occurrence_overrides o WHERE o.event_id = e.id)
    OR EXISTS (SELECT 1 FROM occurrence_completions c WHERE c.event_id = e.id)
    OR EXISTS (SELECT 1 FROM preparation_items p WHERE p.event_id = e.id AND (p.status = 'complete' OR p.legacy_completed = 1 OR p.legacy_completed_date IS NOT NULL))
    OR EXISTS (SELECT 1 FROM xp_ledger x WHERE x.owner_id = e.owner_id AND
      (x.action_key LIKE 'event:' || e.id || ':%' OR x.action_key LIKE 'preparation:' || e.id || ':%'))
  )`).bind(owner).all<{ id: number }>();
  return rows.results.map(row => row.id);
}

export function storedEventInput(event: StoredEvent): EventInput {
  return { title: event.title, category: event.category, eventDate: event.event_date, eventTime: event.event_time,
    allDay: !!event.all_day, allDayReminderTime: event.all_day_reminder_time, endDate: event.end_date, endTime: event.end_time,
    location: event.location, place: event.place, travelPlan: event.travelPlan, note: event.note,
    preparationsEnabled: !!event.preparations_enabled, recurrence: event.recurrence, recurrenceInterval: event.recurrence_interval,
    recurrenceDay: event.recurrence_day, recurrenceUntil: event.recurrence_until };
}

export async function changeBulkCategory(owner: string, event: StoredEvent, category: string) {
  return updateEvent(owner, event.id, { ...storedEventInput(event), category }, event.notification_revision);
}

export async function deleteBulkEvent(owner: string, event: StoredEvent) {
  // One guarded statement: FK cascades remove only this event's dependents atomically.
  // The independent XP ledger intentionally remains, just like individual deletion.
  const deleted = await env.DB.prepare('DELETE FROM events WHERE id = ? AND owner_id = ? AND notification_revision = ? RETURNING id')
    .bind(event.id, owner, event.notification_revision).first<{ id: number }>();
  return deleted?.id === event.id;
}

export async function shiftBulkEvent(owner: string, event: StoredEvent, days: number) {
  if (event.recurrence !== 'none' || event.occurrenceOverrides.length) return 'repeating' as const;
  const start = shiftEventDate(event.event_date, days);
  const end = event.end_date ? shiftEventDate(event.end_date, days) : null;
  if (!start || (event.end_date && !end)) return 'range' as const;
  // Dates are completion identities. Do not move any practiced event, even after
  // unchecking it or deleting a completed preparation; include zero-XP receipts.
  const eligible = `SELECT e.id FROM events e WHERE e.id = ? AND e.owner_id = ? AND e.notification_revision = ?
    AND e.recurrence = 'none'
    AND NOT EXISTS (SELECT 1 FROM event_occurrence_overrides o WHERE o.event_id = e.id)
    AND NOT EXISTS (SELECT 1 FROM occurrence_completions c WHERE c.event_id = e.id)
    AND NOT EXISTS (SELECT 1 FROM preparation_items p WHERE p.event_id = e.id AND (p.status = 'complete' OR p.legacy_completed = 1 OR p.legacy_completed_date IS NOT NULL))
    AND NOT EXISTS (SELECT 1 FROM xp_ledger x WHERE x.owner_id = e.owner_id AND
      (x.action_key LIKE 'event:' || e.id || ':%' OR x.action_key LIKE 'preparation:' || e.id || ':%'))`;
  const args = [event.id, owner, event.notification_revision];
  const stamp = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE notification_jobs SET lifetime_attempt_count = ${attemptHistorySql()}, status = 'cancelled', claimed_at = NULL,
      updated_at = ?, last_error = 'Event date moved.' WHERE event_id = ? AND owner_id = ? AND kind = 'reminder'
      AND status IN ('scheduled','processing') AND EXISTS (${eligible})`).bind(stamp, event.id, owner, ...args),
    env.DB.prepare(`UPDATE events SET event_date = ?, end_date = ?, notification_revision = notification_revision + 1,
      reminders_changed_at = ? WHERE id IN (${eligible})`).bind(start, end, stamp, ...args),
  ]);
  if (!results[1].meta.changes) return 'changed_or_practiced' as const;
  await refreshEventReminders(env.DB, event.id);
  return 'success' as const;
}
