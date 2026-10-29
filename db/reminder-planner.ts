import { type EventRecurrence } from '../lib/recurrence';
import { resolvedReminderOccurrences } from '../lib/occurrences';
import { mapOverride, type OverrideRow } from './occurrence-data';
import { attemptHistorySql } from './notification-history';

const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
export const REMINDER_MAX_LATENESS_MS = 30 * 60 * 1000;
const EVENT_BATCH = 50;

function reminderLabel(minutes: number) {
  if (minutes === 0) return '지금 시작해요';
  if (minutes % 10080 === 0) return `${minutes / 10080}주 전 알림`;
  if (minutes % 1440 === 0) return `${minutes / 1440}일 전 알림`;
  if (minutes % 60 === 0) return `${minutes / 60}시간 전 알림`;
  return `${minutes}분 전 알림`;
}

type PlanningEvent = {
  id: number; owner_id: string; title: string; event_date: string; event_time: string;
  all_day: number; all_day_reminder_time: string;
  recurrence: EventRecurrence; recurrence_interval: number; recurrence_day: number | null;
  notification_revision: number; reminders_changed_at: string;
  recurrence_until: string | null;
};
type PlanningRule = { event_id: number; offset_minutes: number };
type PlanningDevice = { id: number; owner_id: string; reminders_enabled_at: string };

// A revision guards validity, but is intentionally NOT part of the delivery identity.
// Changing a title or replacing identical preset rules must not send an occurrence twice.
export function currentReminderSql(job = 'notification_jobs') {
  return `(${job}.kind <> 'reminder' OR EXISTS (
    SELECT 1 FROM events e
    INNER JOIN reminder_rules r ON r.event_id = e.id AND r.channel = 'push'
    INNER JOIN push_subscriptions s ON s.id = ${job}.subscription_id AND s.owner_id = e.owner_id
    WHERE e.id = ${job}.event_id AND e.owner_id = ${job}.owner_id
      AND e.notification_revision = ${job}.event_revision
      AND r.offset_minutes = ${job}.reminder_offset_minutes
      AND s.disabled_at IS NULL AND s.reminders_enabled_at IS NOT NULL
      AND ${job}.created_at >= s.reminders_enabled_at
      AND NOT EXISTS (SELECT 1 FROM notification_jobs duplicate WHERE duplicate.kind = 'reminder'
        AND duplicate.event_id = ${job}.event_id AND duplicate.subscription_id = ${job}.subscription_id
        AND duplicate.reminder_offset_minutes = ${job}.reminder_offset_minutes
        AND COALESCE(duplicate.original_occurrence_date, date(duplicate.occurrence_at, '+9 hours')) = COALESCE(${job}.original_occurrence_date, date(${job}.occurrence_at, '+9 hours'))
        AND (${attemptHistorySql('duplicate')} > ${attemptHistorySql(job)} OR (${attemptHistorySql('duplicate')} = ${attemptHistorySql(job)} AND duplicate.id < ${job}.id)))
      AND (e.recurrence_until IS NULL OR COALESCE(${job}.original_occurrence_date, date(${job}.occurrence_at, '+9 hours')) <= e.recurrence_until)
      AND NOT EXISTS (SELECT 1 FROM event_occurrence_overrides o WHERE o.event_id = e.id AND o.cancelled = 1
        AND o.original_date = COALESCE(${job}.original_occurrence_date, date(${job}.occurrence_at, '+9 hours')))
      AND NOT EXISTS (SELECT 1 FROM occurrence_completions c WHERE c.owner_id = e.owner_id AND c.event_id = e.id
        AND c.kind = 'event' AND c.complete = 1 AND c.occurrence_date = COALESCE(${job}.original_occurrence_date, date(${job}.occurrence_at, '+9 hours')))
  ))`;
}

export async function cancelObsoleteReminders(d1: D1Database, now: Date) {
  await d1.prepare(`UPDATE notification_jobs
    SET lifetime_attempt_count = ${attemptHistorySql()}, status = 'cancelled', claimed_at = NULL, updated_at = ?,
        last_error = 'Reminder settings changed, device disabled, or delivery window expired.'
    WHERE id IN (SELECT id FROM notification_jobs
      WHERE kind = 'reminder' AND status IN ('scheduled', 'processing')
        AND (expires_at <= ? OR NOT ${currentReminderSql()}) LIMIT 500)
  `).bind(now.toISOString(), now.toISOString()).run();
}

export async function materializeReminders(
  d1: D1Database,
  now = new Date(),
  only?: { eventId?: number; ownerId?: string },
) {
  const state = only ? null : await d1.prepare('SELECT last_event_id FROM notification_planner_state WHERE id = 1')
    .first<{ last_event_id: number }>();
  const readEvents = (after: number) => d1.prepare(`
    SELECT e.id, e.owner_id, e.title, e.event_date, e.event_time, e.all_day, e.all_day_reminder_time, e.recurrence,
           e.recurrence_interval, e.recurrence_day, e.recurrence_until, e.notification_revision, e.reminders_changed_at
    FROM events e WHERE e.id > ?
      AND (? IS NULL OR e.id = ?) AND (? IS NULL OR e.owner_id = ?)
      AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.owner_id = e.owner_id
        AND s.reminders_enabled_at IS NOT NULL AND s.disabled_at IS NULL
        AND (s.expiration_time IS NULL OR s.expiration_time > ?))
    ORDER BY e.id LIMIT ?
  `).bind(after, only?.eventId ?? null, only?.eventId ?? null, only?.ownerId ?? null,
    only?.ownerId ?? null, now.getTime(), EVENT_BATCH).all<PlanningEvent>();
  let events = (await readEvents(state?.last_event_id ?? 0)).results;
  if (!only && events.length === 0 && state?.last_event_id) events = (await readEvents(0)).results;
  if (events.length === 0) {
    if (!only) await d1.prepare('INSERT INTO notification_planner_state (id, last_event_id) VALUES (1, 0) ON CONFLICT(id) DO UPDATE SET last_event_id = 0').run();
    return { scanned: 0, planned: 0 };
  }
  const ids = events.map((e) => e.id);
  const placeholders = ids.map(() => '?').join(',');
  const [rules, devices, overrides] = await Promise.all([
    d1.prepare(`SELECT DISTINCT event_id, offset_minutes FROM reminder_rules WHERE channel = 'push' AND event_id IN (${placeholders})`)
      .bind(...ids).all<PlanningRule>(),
    d1.prepare(`SELECT id, owner_id, reminders_enabled_at FROM push_subscriptions
      WHERE owner_id IN (SELECT owner_id FROM events WHERE id IN (${placeholders}))
        AND reminders_enabled_at IS NOT NULL AND disabled_at IS NULL
        AND (expiration_time IS NULL OR expiration_time > ?)`)
      .bind(...ids, now.getTime()).all<PlanningDevice>(),
    d1.prepare(`SELECT * FROM event_occurrence_overrides WHERE event_id IN (${placeholders})`).bind(...ids).all<OverrideRow>(),
  ]);
  let planned = 0;
  let statements: D1PreparedStatement[] = [];
  const flush = async () => {
    if (!statements.length) return;
    const results = await d1.batch(statements);
    planned += results.reduce((sum, result) => sum + Number(result.meta.changes), 0);
    statements = [];
  };
  for (const event of events) {
    const rule = { title: event.title, eventDate: event.event_date, eventTime: event.event_time, allDay: !!event.all_day,
      allDayReminderTime: event.all_day_reminder_time, recurrence: event.recurrence, recurrenceUntil: event.recurrence_until,
      recurrenceInterval: event.recurrence_interval, recurrenceDay: event.recurrence_day,
      occurrenceOverrides: overrides.results.filter((o) => o.event_id === event.id).map(mapOverride) };
    for (const device of devices.results.filter((s) => s.owner_id === event.owner_id)) {
      const lower = Math.max(now.getTime() - REMINDER_MAX_LATENESS_MS,
        Date.parse(device.reminders_enabled_at), Date.parse(event.reminders_changed_at) || 0);
      if (!Number.isFinite(lower)) continue;
      for (const reminder of rules.results.filter((r) => r.event_id === event.id)) {
        const occurrences = resolvedReminderOccurrences(rule, reminder.offset_minutes,
          new Date(lower), new Date(now.getTime() + LOOKAHEAD_MS));
        for (const occurrence of occurrences) {
          const expires = new Date(Date.parse(occurrence.dueAt) + REMINDER_MAX_LATENESS_MS).toISOString();
          const key = `reminder:${event.id}:${occurrence.originalDate}:${reminder.offset_minutes}:${device.id}`;
          const date = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
            .format(new Date(occurrence.occurrenceAt));
          statements.push(d1.prepare(`INSERT INTO notification_jobs (
            owner_id, event_id, subscription_id, kind, title, body, scheduled_for,
            idempotency_key, created_at, updated_at, occurrence_at, reminder_offset_minutes,
            event_revision, expires_at, original_occurrence_date
          ) SELECT e.owner_id, e.id, s.id, 'reminder', ?, ?, ?,
            COALESCE((SELECT j.idempotency_key FROM notification_jobs j WHERE j.event_id = e.id AND j.subscription_id = s.id
              AND j.kind = 'reminder' AND j.reminder_offset_minutes = ?
              AND COALESCE(j.original_occurrence_date, date(j.occurrence_at, '+9 hours')) = ? ORDER BY ${attemptHistorySql('j')} DESC, j.id LIMIT 1), ?),
            ?, ?, ?, ?, e.notification_revision, ?, ?
            FROM events e INNER JOIN push_subscriptions s ON s.owner_id = e.owner_id
            WHERE e.id = ? AND e.owner_id = ? AND e.notification_revision = ?
              AND s.id = ? AND s.reminders_enabled_at = ? AND s.disabled_at IS NULL
              AND (s.expiration_time IS NULL OR s.expiration_time > ?)
              AND EXISTS (SELECT 1 FROM reminder_rules r WHERE r.event_id = e.id AND r.channel = 'push' AND r.offset_minutes = ?)
              AND NOT EXISTS (SELECT 1 FROM occurrence_completions c WHERE c.owner_id = e.owner_id AND c.event_id = e.id
                AND c.kind = 'event' AND c.complete = 1 AND c.occurrence_date = ?)
            ON CONFLICT(idempotency_key) DO UPDATE SET
              title = excluded.title, body = excluded.body, scheduled_for = excluded.scheduled_for,
              occurrence_at = excluded.occurrence_at, original_occurrence_date = excluded.original_occurrence_date,
              status = 'scheduled', last_error = NULL, event_revision = excluded.event_revision,
              expires_at = excluded.expires_at, created_at = excluded.created_at, updated_at = excluded.updated_at
            WHERE notification_jobs.kind = 'reminder'
              AND notification_jobs.owner_id = excluded.owner_id
              AND notification_jobs.event_id = excluded.event_id
              AND notification_jobs.subscription_id = excluded.subscription_id
              AND ${attemptHistorySql()} = 0 AND (
              notification_jobs.status = 'cancelled' OR
              (notification_jobs.status = 'scheduled' AND notification_jobs.event_revision <> excluded.event_revision))
          `).bind(occurrence.event.title, occurrence.event.allDay
            ? `${date} 기준 · 종일 일정 · ${reminder.offset_minutes === 0 ? '기준 시각 알림' : reminderLabel(reminder.offset_minutes)}`
            : `${date} 일정 · ${reminderLabel(reminder.offset_minutes)}`,
            occurrence.dueAt, reminder.offset_minutes, occurrence.originalDate, key, now.toISOString(), now.toISOString(), occurrence.occurrenceAt,
            reminder.offset_minutes, expires, occurrence.originalDate, event.id, event.owner_id, event.notification_revision,
            device.id, device.reminders_enabled_at, now.getTime(), reminder.offset_minutes, occurrence.originalDate));
          if (statements.length === 25) await flush();
        }
      }
    }
  }
  await flush();
  if (!only) await d1.prepare(`INSERT INTO notification_planner_state (id, last_event_id) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET last_event_id = excluded.last_event_id`).bind(events.at(-1)!.id).run();
  return { scanned: events.length, planned };
}

// Saving a calendar edit must remain successful even if immediate planning fails.
// The scheduled planner retries, using a persisted cursor to avoid starving later events.
export async function refreshEventReminders(d1: D1Database, eventId: number) {
  try { await materializeReminders(d1, new Date(), { eventId }); }
  catch { console.error(JSON.stringify({ event: 'ahead.reminder.planning.deferred' })); }
}
