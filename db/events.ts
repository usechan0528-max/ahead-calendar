import { env } from 'cloudflare:workers';
import { refreshEventReminders } from './reminder-planner';
import { attemptHistorySql } from './notification-history';
import type { EventInput } from '../lib/event-input';
import { captureLegacyPreparationDates } from './legacy-completions';
import { readStoredPlace, type KakaoPlace } from '../lib/kakao-place';
import { readTravelPlan, type TravelPlan } from '../lib/travel-plan';
import { mapOverride, type OverrideRow } from './occurrence-data';
import type { OccurrenceOverride } from '../lib/occurrences';

export type StoredPreparation = {
  id: number;
  event_id: number;
  title: string;
  timing: string;
  status: 'pending' | 'complete';
};

export type StoredReminder = {
  id: number;
  event_id: number;
  offset_minutes: number;
  repeat_until_ack: number;
};

export type StoredDelivery = {
  id: number;
  event_id: number;
  channel: string;
  kind: string;
  status: string;
  sent_at: string;
};

export type ReminderPreset = 'minimal' | 'standard' | 'thorough';
export type EventRecurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export type StoredEvent = {
  id: number;
  title: string;
  category: string;
  event_date: string;
  event_time: string;
  all_day: number;
  all_day_reminder_time: string;
  end_date: string | null;
  end_time: string | null;
  location: string;
  place: KakaoPlace | null;
  travelPlan: TravelPlan | null;
  note: string;
  preparations_enabled: number;
  recurrence: EventRecurrence;
  recurrence_interval: number;
  recurrence_day: number | null;
  recurrence_until: string | null;
  notification_revision: number;
  occurrenceOverrides: OccurrenceOverride[];
  preparations: StoredPreparation[];
  reminders: StoredReminder[];
  deliveries: StoredDelivery[];
};

type EventRow = Omit<StoredEvent, 'preparations' | 'reminders' | 'deliveries' | 'place' | 'travelPlan' | 'occurrenceOverrides'> & { place_json: string | null; travel_plan_json: string | null };

export type NewEvent = EventInput;

const preparationTemplates: Record<string, Array<[string, string]>> = {
  기념일: [
    ['축하 방법이나 선물 정하기', '지금'],
    ['예약과 필요한 준비 확인하기', '기념일 전'],
    ['마음을 전할 메시지 준비하기', '당일'],
  ],
  행사: [
    ['참석 여부 확인하기', '지금'],
    ['필요한 준비물 챙기기', '행사 전'],
    ['출발 시간 확인하기', '당일'],
  ],
  여행: [
    ['예약 내역 확인하기', '지금'],
    ['여행 일정에 맞춰 짐 싸기', '출발 전'],
    ['체크인과 출발 시간 확인하기', '당일'],
  ],
  일정: [
    ['필요한 준비 확인하기', '지금'],
    ['장소와 이동 계획 정하기', '일정 전'],
    ['마지막 준비 확인하기', '당일'],
  ],
};

const reminderPresetOffsets: Record<ReminderPreset, number[]> = {
  minimal: [1440],
  standard: [10080, 1440, 120],
  thorough: [20160, 10080, 4320, 1440, 180, 60],
};

let schemaReady: Promise<void> | null = null;

export function ensureEventSchema() {
  if (process.env.NODE_ENV === 'production') return Promise.resolve();
  schemaReady ??= initializeEventSchema();
  return schemaReady;
}

async function initializeEventSchema() {
  const d1 = env.DB;
  if (!d1) throw new Error('The event database is unavailable.');

  await d1.batch([
    d1.prepare(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id TEXT NOT NULL,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        event_date TEXT NOT NULL,
        event_time TEXT NOT NULL,
        location TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        recurrence TEXT NOT NULL DEFAULT 'none',
        recurrence_interval INTEGER NOT NULL DEFAULT 1,
        recurrence_day INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    d1.prepare(`
      CREATE TABLE IF NOT EXISTS reminder_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        offset_minutes INTEGER NOT NULL,
        channel TEXT NOT NULL DEFAULT 'push',
        repeat_until_ack INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      )
    `),
    d1.prepare(`
      CREATE TABLE IF NOT EXISTS preparation_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        timing TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        source TEXT NOT NULL DEFAULT 'rule',
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      )
    `),
    d1.prepare(`
      CREATE TABLE IF NOT EXISTS notification_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id TEXT NOT NULL,
        event_id INTEGER NOT NULL,
        channel TEXT NOT NULL DEFAULT 'browser',
        kind TEXT NOT NULL DEFAULT 'test',
        status TEXT NOT NULL DEFAULT 'sent',
        sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      )
    `),
    d1.prepare(`
      CREATE INDEX IF NOT EXISTS idx_events_owner_date
      ON events(owner_id, event_date)
    `),
    d1.prepare(`
      CREATE INDEX IF NOT EXISTS idx_reminder_rules_event_id
      ON reminder_rules(event_id)
    `),
    d1.prepare(`
      CREATE INDEX IF NOT EXISTS idx_preparation_items_event_id
      ON preparation_items(event_id)
    `),
    d1.prepare(`
      CREATE INDEX IF NOT EXISTS idx_notification_deliveries_owner_sent
      ON notification_deliveries(owner_id, sent_at)
    `),
  ]);

  const eventColumns = await d1.prepare('PRAGMA table_info(events)').all<{ name: string }>();
  const existingColumns = new Set(eventColumns.results.map((column) => column.name));
  const columnMigrations = [
    !existingColumns.has('location')
      ? d1.prepare("ALTER TABLE events ADD COLUMN location TEXT NOT NULL DEFAULT ''")
      : null,
    !existingColumns.has('note')
      ? d1.prepare("ALTER TABLE events ADD COLUMN note TEXT NOT NULL DEFAULT ''")
      : null,
    !existingColumns.has('recurrence')
      ? d1.prepare("ALTER TABLE events ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none'")
      : null,
    !existingColumns.has('recurrence_interval')
      ? d1.prepare('ALTER TABLE events ADD COLUMN recurrence_interval INTEGER NOT NULL DEFAULT 1')
      : null,
    !existingColumns.has('recurrence_day')
      ? d1.prepare('ALTER TABLE events ADD COLUMN recurrence_day INTEGER')
      : null,
  ].filter((statement): statement is D1PreparedStatement => statement !== null);
  if (columnMigrations.length > 0) await d1.batch(columnMigrations);

  await d1.prepare('PRAGMA optimize').run();
}

export async function listEvents(ownerId: string): Promise<StoredEvent[]> {
  await ensureEventSchema();
  const [eventsResult, preparationsResult, remindersResult, deliveriesResult, overridesResult] = await Promise.all([
    env.DB.prepare(
      `SELECT id, title, category, event_date, event_time, all_day, all_day_reminder_time, end_date, end_time, location, note, recurrence,
              recurrence_interval, recurrence_day, recurrence_until, notification_revision, place_json, travel_plan_json, preparations_enabled
       FROM events
       WHERE owner_id = ?
       ORDER BY event_date ASC, event_time ASC`,
    )
      .bind(ownerId)
      .all<EventRow>(),
    env.DB.prepare(
      `SELECT preparation_items.id, preparation_items.event_id, preparation_items.title,
              preparation_items.timing, preparation_items.status
       FROM preparation_items
       INNER JOIN events ON events.id = preparation_items.event_id
       WHERE events.owner_id = ?
       ORDER BY preparation_items.id ASC`,
    )
      .bind(ownerId)
      .all<StoredPreparation>(),
    env.DB.prepare(
      `SELECT reminder_rules.id, reminder_rules.event_id, reminder_rules.offset_minutes,
              reminder_rules.repeat_until_ack
       FROM reminder_rules
       INNER JOIN events ON events.id = reminder_rules.event_id
       WHERE events.owner_id = ?
       ORDER BY reminder_rules.offset_minutes DESC`,
    )
      .bind(ownerId)
      .all<StoredReminder>(),
    env.DB.prepare(
      `SELECT id, event_id, channel, kind, status, sent_at
       FROM notification_deliveries
       WHERE owner_id = ?
       ORDER BY sent_at DESC, id DESC
       LIMIT 30`,
    )
      .bind(ownerId)
      .all<StoredDelivery>(),
    env.DB.prepare(`SELECT o.* FROM event_occurrence_overrides o JOIN events e ON e.id = o.event_id WHERE e.owner_id = ? ORDER BY o.original_date`)
      .bind(ownerId).all<OverrideRow>(),
  ]);

  return eventsResult.results.map(({ place_json, travel_plan_json, ...event }) => ({
    ...event,
    place: readStoredPlace(place_json, event.location),
    travelPlan: readTravelPlan(travel_plan_json, readStoredPlace(place_json, event.location)),
    preparations: preparationsResult.results.filter((item) => item.event_id === event.id),
    reminders: remindersResult.results.filter((item) => item.event_id === event.id),
    deliveries: deliveriesResult.results.filter((item) => item.event_id === event.id),
    occurrenceOverrides: overridesResult.results.filter((item) => item.event_id === event.id).map(mapOverride),
  }));
}

export async function readCreationReceipt(ownerId: string, requestId: string) {
  return env.DB.prepare(`SELECT r.event_id, r.payload_hash, e.id AS live_id FROM event_creation_receipts r
    LEFT JOIN events e ON e.id = r.event_id AND e.owner_id = r.owner_id WHERE r.owner_id = ? AND r.request_id = ?`)
    .bind(ownerId, requestId).first<{ event_id: number; payload_hash: string; live_id: number | null }>();
}

export class CreationConflict extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function createEvent(ownerId: string, input: NewEvent, initialReminderOffsets?: number[], seedPreparations = true,
  receipt?: { requestId: string; payloadHash: string }): Promise<number> {
  await ensureEventSchema();
  const guard = receipt ? 'NOT EXISTS (SELECT 1 FROM event_creation_receipts WHERE owner_id = ? AND request_id = ?)' : '1 = 1';
  const guardArgs = receipt ? [ownerId, receipt.requestId] : [];
  const insert = env.DB.prepare(
    `INSERT INTO events (
       owner_id, title, category, event_date, event_time, location, note, recurrence,
       recurrence_interval, recurrence_day, all_day, all_day_reminder_time, end_date, end_time, place_json, travel_plan_json, preparations_enabled, recurrence_until
     ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard} RETURNING id`,
  )
    .bind(
      ownerId,
      input.title,
      input.category,
      input.eventDate,
      input.eventTime,
      input.location,
      input.note,
      input.recurrence,
      input.recurrenceInterval,
      input.recurrenceDay,
      input.allDay ? 1 : 0,
      input.allDayReminderTime,
      input.endDate,
      input.endTime,
      input.place ? JSON.stringify(input.place) : null,
      input.travelPlan ? JSON.stringify(input.travelPlan) : null,
      input.preparationsEnabled === false ? 0 : 1,
      input.recurrenceUntil ?? null,
      ...guardArgs,
    );

  const templates = !seedPreparations || input.preparationsEnabled === false ? [] : Object.hasOwn(preparationTemplates, input.category) ? preparationTemplates[input.category] : preparationTemplates['일정'];
  const offsets = initialReminderOffsets ?? reminderPresetOffsets.standard;
  // D1 batch is one transaction. No other event insert can interleave, so the latest
  // owner-scoped AUTOINCREMENT event is this insert even after child rowids change.
  const results = await env.DB.batch([
    insert,
    ...offsets.map((offset) => env.DB.prepare(
      `INSERT INTO reminder_rules (event_id, offset_minutes, channel, repeat_until_ack)
       SELECT id, ?, 'push', ? FROM events WHERE owner_id = ? AND ${guard} ORDER BY id DESC LIMIT 1`,
    ).bind(offset, initialReminderOffsets === undefined && offset === 120 ? 1 : 0, ownerId, ...guardArgs)),
    ...templates.map(([title, timing]) =>
      env.DB.prepare(
        `INSERT INTO preparation_items (event_id, title, timing, status, source)
         SELECT id, ?, ?, 'pending', 'rule' FROM events WHERE owner_id = ? AND ${guard} ORDER BY id DESC LIMIT 1`,
      ).bind(title, timing, ownerId, ...guardArgs),
    ),
    ...(receipt ? [env.DB.prepare(`INSERT INTO event_creation_receipts (owner_id, request_id, payload_hash, event_id)
      SELECT ?, ?, ?, id FROM events WHERE owner_id = ? AND ${guard} ORDER BY id DESC LIMIT 1`)
      .bind(ownerId, receipt.requestId, receipt.payloadHash, ownerId, ...guardArgs)] : []),
  ]);

  const stored = receipt ? await readCreationReceipt(ownerId, receipt.requestId) : null;
  if (receipt && !stored) throw new Error('Creation result unavailable');
  if (stored && stored.payload_hash !== receipt!.payloadHash) throw new CreationConflict(409, 'request_changed', '같은 저장 요청의 내용이 달라졌어요. 저장 결과를 먼저 확인해 주세요.');
  if (stored && !stored.live_id) throw new CreationConflict(410, 'event_deleted', '이미 저장한 뒤 삭제된 일정이에요. 다시 만들려면 새 일정을 작성해 주세요.');
  const eventId = stored?.event_id ?? Number((results[0].results[0] as { id: number }).id);
  await refreshEventReminders(env.DB, eventId);
  return eventId;
}

export async function updateEvent(
  ownerId: string,
  eventId: number,
  input: NewEvent,
  expectedRevision: number,
): Promise<boolean> {
  await ensureEventSchema();
  const previous = await env.DB.prepare('SELECT * FROM events WHERE id = ? AND owner_id = ? AND notification_revision = ?')
    .bind(eventId, ownerId, expectedRevision).first<StoredEvent>();
  if (!previous) return false;
  const timingChanged = input.eventDate !== previous.event_date || input.eventTime !== previous.event_time
    || Number(input.allDay) !== previous.all_day || input.allDayReminderTime !== previous.all_day_reminder_time
    || input.recurrence !== previous.recurrence || input.recurrenceInterval !== previous.recurrence_interval
    || input.recurrenceDay !== previous.recurrence_day || input.recurrenceUntil !== previous.recurrence_until;
  await captureLegacyPreparationDates(env.DB, ownerId, eventId);
  const timestamp = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE notification_jobs SET lifetime_attempt_count = ${attemptHistorySql()}, status = 'cancelled', claimed_at = NULL, updated_at = ?, last_error = 'Event settings changed.'
      WHERE event_id = ? AND owner_id = ? AND kind = 'reminder' AND status IN ('scheduled','processing')
      AND ? = 1
      AND EXISTS (SELECT 1 FROM events WHERE id = ? AND owner_id = ? AND notification_revision = ?)`)
      .bind(timestamp, eventId, ownerId, Number(timingChanged), eventId, ownerId, expectedRevision),
    // Metadata edits do not revoke snoozes or reset their delivery window/history.
    env.DB.prepare(`UPDATE notification_jobs SET event_revision = ?, title = CASE WHEN status = 'scheduled' THEN COALESCE(
      (SELECT json_extract(o.data_json, '$.title') FROM event_occurrence_overrides o
       WHERE o.event_id = notification_jobs.event_id AND o.original_date = COALESCE(notification_jobs.original_occurrence_date, date(notification_jobs.occurrence_at, '+9 hours'))), ?) ELSE title END
      WHERE event_id = ? AND owner_id = ? AND kind = 'reminder' AND event_revision = ? AND ? = 0
        AND EXISTS (SELECT 1 FROM events WHERE id = ? AND owner_id = ? AND notification_revision = ?)`)
      .bind(expectedRevision + 1, input.title, eventId, ownerId, expectedRevision, Number(timingChanged), eventId, ownerId, expectedRevision),
    env.DB.prepare(
    `UPDATE events
     SET title = ?, category = ?, event_date = ?, event_time = ?,
         location = ?, note = ?, recurrence = ?, recurrence_interval = ?, recurrence_day = ?,
         all_day = ?, all_day_reminder_time = ?, end_date = ?, end_time = ?, place_json = ?, travel_plan_json = ?,
         preparations_enabled = ?, recurrence_until = ?, notification_revision = notification_revision + 1,
         reminders_changed_at = CASE WHEN ? = 1 THEN ? ELSE reminders_changed_at END
     WHERE id = ? AND owner_id = ? AND notification_revision = ?`,
  )
    .bind(
      input.title,
      input.category,
      input.eventDate,
      input.eventTime,
      input.location,
      input.note,
      input.recurrence,
      input.recurrenceInterval,
      input.recurrenceDay,
      input.allDay ? 1 : 0,
      input.allDayReminderTime,
      input.endDate,
      input.endTime,
      input.place ? JSON.stringify(input.place) : null,
      input.travelPlan ? JSON.stringify(input.travelPlan) : null,
      input.preparationsEnabled === false ? 0 : 1,
      input.recurrenceUntil ?? null,
      Number(timingChanged),
      timestamp,
      eventId,
      ownerId,
      expectedRevision,
    )]);
  const changed = Number(results[2].meta.changes) === 1;
  if (changed) await refreshEventReminders(env.DB, eventId);
  return changed;
}

/** Display preference only: never alter checklist records, XP or notification scheduling. */
export async function setPreparationsEnabled(ownerId: string, eventId: number, enabled: boolean) {
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE notification_jobs SET event_revision = event_revision + 1
      WHERE event_id = ? AND owner_id = ? AND kind = 'reminder' AND EXISTS (
        SELECT 1 FROM events e WHERE e.id = notification_jobs.event_id AND e.owner_id = notification_jobs.owner_id
        AND e.notification_revision = notification_jobs.event_revision AND e.preparations_enabled <> ?)`)
      .bind(eventId, ownerId, Number(enabled)),
    env.DB.prepare(`UPDATE events SET notification_revision = notification_revision + CASE WHEN preparations_enabled <> ? THEN 1 ELSE 0 END,
      preparations_enabled = ? WHERE id = ? AND owner_id = ?`).bind(Number(enabled), Number(enabled), eventId, ownerId),
  ]);
  return Number(results[1].meta.changes) === 1;
}

function cancelEventReminders(eventId: number, ownerId: string, timestamp: string) {
  return env.DB.prepare(`UPDATE notification_jobs SET lifetime_attempt_count = ${attemptHistorySql()}, status = 'cancelled', claimed_at = NULL,
    updated_at = ?, last_error = 'Event or reminder settings changed.'
    WHERE event_id = ? AND owner_id = ? AND kind = 'reminder' AND status IN ('scheduled', 'processing')`)
    .bind(timestamp, eventId, ownerId);
}

function reviseEventReminders(eventId: number, ownerId: string, timestamp: string) {
  return env.DB.prepare(`UPDATE events SET notification_revision = notification_revision + 1,
    reminders_changed_at = ? WHERE id = ? AND owner_id = ?`).bind(timestamp, eventId, ownerId);
}

export async function deleteEvent(ownerId: string, eventId: number): Promise<boolean> {
  await ensureEventSchema();
  const ownedEvent = await env.DB.prepare(
    `SELECT id FROM events WHERE id = ? AND owner_id = ?`,
  )
    .bind(eventId, ownerId)
    .first<{ id: number }>();
  if (!ownedEvent) return false;

  await env.DB.batch([
    env.DB.prepare('DELETE FROM notification_deliveries WHERE event_id = ?').bind(eventId),
    env.DB.prepare('DELETE FROM preparation_items WHERE event_id = ?').bind(eventId),
    env.DB.prepare('DELETE FROM reminder_rules WHERE event_id = ?').bind(eventId),
    env.DB.prepare('DELETE FROM events WHERE id = ? AND owner_id = ?').bind(eventId, ownerId),
  ]);
  return true;
}

export async function updatePreparationStatus(
  ownerId: string,
  preparationId: number,
  status: 'pending' | 'complete',
): Promise<boolean> {
  await ensureEventSchema();
  const preparation = await env.DB.prepare('SELECT event_id FROM preparation_items WHERE id = ?').bind(preparationId).first<{ event_id: number }>();
  if (preparation) await captureLegacyPreparationDates(env.DB, ownerId, preparation.event_id);
  const result = await env.DB.prepare(
    `UPDATE preparation_items
     SET legacy_completed = CASE WHEN status = 'complete' OR ? = 'complete' THEN 1 ELSE legacy_completed END, status = ?
     WHERE id = ?
       AND EXISTS (
         SELECT 1 FROM events
         WHERE events.id = preparation_items.event_id
           AND events.owner_id = ?
       )`,
  )
    .bind(status, status, preparationId, ownerId)
    .run();

  return Number(result.meta.changes) === 1;
}

export async function updateReminderPreset(
  ownerId: string,
  eventId: number,
  preset: ReminderPreset,
): Promise<StoredReminder[] | null> {
  await ensureEventSchema();
  const ownedEvent = await env.DB.prepare(
    `SELECT id FROM events WHERE id = ? AND owner_id = ?`,
  )
    .bind(eventId, ownerId)
    .first<{ id: number }>();
  if (!ownedEvent) return null;

  const offsets = reminderPresetOffsets[preset];
  const timestamp = new Date().toISOString();
  await env.DB.batch([
    reviseEventReminders(eventId, ownerId, timestamp),
    cancelEventReminders(eventId, ownerId, timestamp),
    env.DB.prepare(`DELETE FROM reminder_rules WHERE event_id = ?`).bind(eventId),
    ...offsets.map((offset, index) =>
      env.DB.prepare(
        `INSERT INTO reminder_rules (event_id, offset_minutes, channel, repeat_until_ack)
         VALUES (?, ?, 'push', ?)`,
      ).bind(eventId, offset, index === offsets.length - 1 ? 1 : 0),
    ),
  ]);

  await refreshEventReminders(env.DB, eventId);

  const result = await env.DB.prepare(
    `SELECT id, event_id, offset_minutes, repeat_until_ack
     FROM reminder_rules
     WHERE event_id = ?
     ORDER BY offset_minutes DESC`,
  )
    .bind(eventId)
    .all<StoredReminder>();
  return result.results;
}

export async function addCustomReminder(
  ownerId: string,
  eventId: number,
  offsetMinutes: number,
): Promise<StoredReminder[] | null> {
  await ensureEventSchema();
  const ownedEvent = await env.DB.prepare(
    `SELECT id FROM events WHERE id = ? AND owner_id = ?`,
  )
    .bind(eventId, ownerId)
    .first<{ id: number }>();
  if (!ownedEvent) return null;

  const existing = await env.DB.prepare(
    `SELECT id FROM reminder_rules WHERE event_id = ? AND offset_minutes = ?`,
  )
    .bind(eventId, offsetMinutes)
    .first<{ id: number }>();

  if (!existing) {
    const timestamp = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`UPDATE events SET notification_revision = notification_revision + 1, reminders_changed_at = ?
        WHERE id = ? AND owner_id = ? AND NOT EXISTS (SELECT 1 FROM reminder_rules WHERE event_id = ? AND offset_minutes = ?)`)
        .bind(timestamp, eventId, ownerId, eventId, offsetMinutes),
      env.DB.prepare(`UPDATE notification_jobs SET lifetime_attempt_count = ${attemptHistorySql()}, status = 'cancelled', claimed_at = NULL, updated_at = ?, last_error = 'Reminder added.'
        WHERE event_id = ? AND owner_id = ? AND kind = 'reminder' AND status IN ('scheduled', 'processing')
          AND NOT EXISTS (SELECT 1 FROM reminder_rules WHERE event_id = ? AND offset_minutes = ?)`)
        .bind(timestamp, eventId, ownerId, eventId, offsetMinutes),
      env.DB.prepare(
      `INSERT INTO reminder_rules (event_id, offset_minutes, channel, repeat_until_ack)
       SELECT id, ?, 'push', 0 FROM events WHERE id = ? AND owner_id = ?
         AND NOT EXISTS (SELECT 1 FROM reminder_rules WHERE event_id = ? AND offset_minutes = ?)`,
    )
      .bind(offsetMinutes, eventId, ownerId, eventId, offsetMinutes),
    ]);
    await refreshEventReminders(env.DB, eventId);
  }

  const result = await env.DB.prepare(
    `SELECT id, event_id, offset_minutes, repeat_until_ack
     FROM reminder_rules
     WHERE event_id = ?
     ORDER BY offset_minutes DESC`,
  )
    .bind(eventId)
    .all<StoredReminder>();
  return result.results;
}

export async function recordTestDelivery(
  ownerId: string,
  eventId: number,
): Promise<StoredDelivery | null> {
  await ensureEventSchema();
  const insert = await env.DB.prepare(
    `INSERT INTO notification_deliveries (owner_id, event_id, channel, kind, status)
     SELECT ?, id, 'browser', 'test', 'sent'
     FROM events
     WHERE id = ? AND owner_id = ?`,
  )
    .bind(ownerId, eventId, ownerId)
    .run();
  if (Number(insert.meta.changes) !== 1) return null;

  return env.DB.prepare(
    `SELECT id, event_id, channel, kind, status, sent_at
     FROM notification_deliveries
     WHERE id = ?`,
  )
    .bind(Number(insert.meta.last_row_id))
    .first<StoredDelivery>();
}
