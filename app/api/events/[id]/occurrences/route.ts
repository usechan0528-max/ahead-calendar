import { attemptHistorySql } from '@/db/notification-history';
import { env } from 'cloudflare:workers';
import { getOwnerId } from '@/app/api/owner';
import { parsePositiveId, readJsonObject } from '@/app/api/input';
import { listEvents } from '@/db/events';
import { refreshEventReminders } from '@/db/reminder-planner';
import { parseEventInput } from '@/lib/event-input';
import { isValidEventDate, nextOccurrenceDate } from '@/lib/recurrence';
import { resolveOccurrence, type OccurrenceChanges } from '@/lib/occurrences';

export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getOwnerId();
  if (!ownerId) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
  const eventId = parsePositiveId((await params).id);
  const body = await readJsonObject(request);
  if (!eventId || !body || typeof body.originalDate !== 'string' || !isValidEventDate(body.originalDate)
    || typeof body.action !== 'string' || !['edit', 'cancel', 'restore'].includes(body.action) || !Number.isInteger(body.revision)) {
    return Response.json({ error: 'Invalid occurrence.' }, { status: 400 });
  }
  const existing = (await listEvents(ownerId)).find((event) => event.id === eventId);
  if (!existing) return Response.json({ error: 'Event not found.' }, { status: 404 });
  if (existing.notification_revision !== body.revision) return Response.json({ error: '일정이 변경되었어요. 새로고침 후 다시 시도해 주세요.' }, { status: 409 });
  if (body.action === 'restore' && !existing.occurrenceOverrides.some((o) => o.originalDate === body.originalDate)) {
    return Response.json({ event: existing });
  }
  const rule = { eventDate: existing.event_date, recurrence: existing.recurrence,
    recurrenceInterval: existing.recurrence_interval, recurrenceDay: existing.recurrence_day,
    recurrenceUntil: body.action === 'restore' ? null : existing.recurrence_until };
  if (existing.recurrence === 'none' || nextOccurrenceDate(rule, body.originalDate) !== body.originalDate) {
    return Response.json({ error: '유효한 반복 회차를 선택해 주세요.' }, { status: 400 });
  }
  if (body.action !== 'restore' && existing.occurrenceOverrides.length >= 500 && !existing.occurrenceOverrides.some((o) => o.originalDate === body.originalDate)) {
    return Response.json({ error: '한 일정에 회차별 변경은 최대 500개까지 저장할 수 있어요.' }, { status: 409 });
  }
  let changes: OccurrenceChanges | null = null;
  if (body.action === 'edit') {
    const input = body.changes && typeof body.changes === 'object' && !Array.isArray(body.changes)
      ? parseEventInput({ ...body.changes, category: existing.category, recurrence: 'none' }) : null;
    if (!input) return Response.json({ error: '제목과 날짜·시간을 확인해 주세요.' }, { status: 400 });
    const { title, note, eventDate, eventTime, allDay, allDayReminderTime, endDate, endTime } = input;
    changes = { title, note, eventDate, eventTime, allDay, allDayReminderTime, endDate, endTime };
  }
  const timestamp = new Date().toISOString();
  const master = { ...rule, eventTime: existing.event_time, allDay: !!existing.all_day, allDayReminderTime: existing.all_day_reminder_time,
    endDate: existing.end_date, endTime: existing.end_time, occurrenceOverrides: existing.occurrenceOverrides };
  const before = resolveOccurrence(master, body.originalDate)?.event;
  const after = body.action === 'cancel' ? null : changes ?? resolveOccurrence({ ...master, occurrenceOverrides: [] }, body.originalDate)?.event;
  const timingChanged = !before || !after || before.eventDate !== after.eventDate || before.eventTime !== after.eventTime
    || before.allDay !== after.allDay || before.allDayReminderTime !== after.allDayReminderTime;
  // updated_at is the notification catch-up cutoff: a note-only edit must not move it.
  const timingCutoff = timingChanged ? timestamp : existing.occurrenceOverrides.find((o) => o.originalDate === body.originalDate)?.updatedAt ?? '1970-01-01T00:00:00.000Z';
  const guard = `EXISTS (SELECT 1 FROM events WHERE id = ? AND owner_id = ? AND notification_revision = ?)`;
  const args = [eventId, ownerId, existing.notification_revision];
  // Keep a restore tombstone: it prevents catching up obsolete alarms before this change.
  const writes = await env.DB.batch([
    env.DB.prepare(`INSERT INTO event_occurrence_overrides (event_id, original_date, cancelled, data_json, updated_at)
      SELECT ?, ?, ?, ?, ? WHERE ${guard}
      ON CONFLICT(event_id, original_date) DO UPDATE SET cancelled = excluded.cancelled, data_json = excluded.data_json, updated_at = excluded.updated_at`)
      .bind(eventId, body.originalDate, body.action === 'cancel' ? 1 : 0, changes ? JSON.stringify(changes) : null, timingCutoff, ...args),
    env.DB.prepare(`UPDATE notification_jobs SET lifetime_attempt_count = ${attemptHistorySql()}, status = CASE WHEN status IN ('scheduled','processing') THEN 'cancelled' ELSE status END,
      claimed_at = NULL, updated_at = ? WHERE event_id = ? AND owner_id = ? AND kind = 'reminder'
      AND COALESCE(original_occurrence_date, date(occurrence_at, '+9 hours')) = ? AND ? = 1 AND ${guard}`)
      .bind(timestamp, eventId, ownerId, body.originalDate, Number(timingChanged), ...args),
    // Other occurrences (including snoozed jobs) remain valid under the new series revision.
    env.DB.prepare(`UPDATE notification_jobs SET event_revision = ?, title = CASE WHEN status = 'scheduled'
      AND COALESCE(original_occurrence_date, date(occurrence_at, '+9 hours')) = ? THEN ? ELSE title END
      WHERE event_id = ? AND owner_id = ? AND kind = 'reminder' AND event_revision = ?
      AND (? = 0 OR COALESCE(original_occurrence_date, date(occurrence_at, '+9 hours')) <> ?) AND ${guard}`)
      .bind(existing.notification_revision + 1, body.originalDate, changes?.title ?? existing.title, eventId, ownerId, existing.notification_revision, Number(timingChanged), body.originalDate, ...args),
    env.DB.prepare(`UPDATE events SET notification_revision = notification_revision + 1 WHERE id = ? AND owner_id = ? AND notification_revision = ?`).bind(...args),
  ]);
  if (!writes[3].meta.changes) return Response.json({ error: '일정이 변경되었어요. 새로고침 후 다시 시도해 주세요.' }, { status: 409 });
  await refreshEventReminders(env.DB, eventId);
  return Response.json({ event: (await listEvents(ownerId)).find((event) => event.id === eventId) });
}
