import { nextOccurrenceDate, type RecurrenceRule } from '../lib/recurrence';

/** Freeze legacy completion attribution before any edit can move its first date. */
export async function captureLegacyPreparationDates(db: D1Database, owner: string, eventId: number) {
  const event = await db.prepare('SELECT event_date, recurrence, recurrence_interval, recurrence_day, notification_revision FROM events WHERE id = ? AND owner_id = ?')
    .bind(eventId, owner).first<{ event_date: string; recurrence: RecurrenceRule['recurrence']; recurrence_interval: number; recurrence_day: number | null; notification_revision: number }>();
  if (!event) return;
  const first = nextOccurrenceDate({ eventDate: event.event_date, recurrence: event.recurrence, recurrenceInterval: event.recurrence_interval, recurrenceDay: event.recurrence_day }, event.event_date);
  if (!first) return;
  await db.prepare(`UPDATE preparation_items SET legacy_completed_date = ?, legacy_completed = 1
    WHERE event_id = ? AND legacy_completed_date IS NULL AND (status = 'complete' OR legacy_completed = 1)
      AND EXISTS (SELECT 1 FROM events WHERE id = ? AND owner_id = ? AND notification_revision = ?)`)
    .bind(first, eventId, eventId, owner, event.notification_revision).run();
}
