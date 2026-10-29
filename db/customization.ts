import { attemptHistorySql } from './notification-history';
import { env } from 'cloudflare:workers';
import { ensureEventSchema, type StoredPreparation, type StoredReminder } from './events';
import { refreshEventReminders } from './reminder-planner';
import { recommendationKeysForTitle } from '../lib/preparation-recommendations';

async function ownedReminders(ownerId: string, eventId: number) {
  const result = await env.DB.prepare(`SELECT r.id, r.event_id, r.offset_minutes, r.repeat_until_ack
    FROM reminder_rules r INNER JOIN events e ON e.id = r.event_id
    WHERE e.id = ? AND e.owner_id = ? ORDER BY r.offset_minutes DESC`).bind(eventId, ownerId).all<StoredReminder>();
  return result.results;
}

/** All guards run inside the same batch as the revision change, cancellation and rule edit. */
export async function changeReminderRule(ownerId: string, eventId: number, ruleId: number, nextOffset: number | null) {
  await ensureEventSchema();
  const eligible = `EXISTS (SELECT 1 FROM reminder_rules r INNER JOIN events e ON e.id = r.event_id
    WHERE r.id = ? AND e.id = ? AND e.owner_id = ? AND (? IS NULL OR (r.offset_minutes <> ? AND NOT EXISTS (
      SELECT 1 FROM reminder_rules other WHERE other.event_id = r.event_id AND other.offset_minutes = ? AND other.id <> r.id))))`;
  const guardValues = [ruleId, eventId, ownerId, nextOffset, nextOffset, nextOffset];
  const timestamp = new Date().toISOString();
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE events SET notification_revision = notification_revision + 1, reminders_changed_at = ?
      WHERE id = ? AND owner_id = ? AND ${eligible}`).bind(timestamp, eventId, ownerId, ...guardValues),
    env.DB.prepare(`UPDATE notification_jobs SET lifetime_attempt_count = ${attemptHistorySql()}, status = 'cancelled', claimed_at = NULL,
      updated_at = ?, last_error = 'Reminder rule changed.'
      WHERE event_id = ? AND owner_id = ? AND kind = 'reminder' AND status IN ('scheduled', 'processing') AND ${eligible}`)
      .bind(timestamp, eventId, ownerId, ...guardValues),
    nextOffset === null
      ? env.DB.prepare(`DELETE FROM reminder_rules WHERE id = ? AND event_id = ? AND ${eligible}`).bind(ruleId, eventId, ...guardValues)
      : env.DB.prepare(`UPDATE reminder_rules SET offset_minutes = ? WHERE id = ? AND event_id = ? AND ${eligible}`).bind(nextOffset, ruleId, eventId, ...guardValues),
  ]);
  if (Number(result[2].meta.changes) === 0) {
    const current = await env.DB.prepare(`SELECT r.offset_minutes FROM reminder_rules r INNER JOIN events e ON e.id = r.event_id
      WHERE r.id = ? AND e.id = ? AND e.owner_id = ?`).bind(ruleId, eventId, ownerId).first<{ offset_minutes: number }>();
    if (!current) return { status: 'not_found' as const };
    if (nextOffset !== current.offset_minutes) return { status: 'duplicate' as const };
  } else await refreshEventReminders(env.DB, eventId);
  return { status: 'ok' as const, reminders: await ownedReminders(ownerId, eventId) };
}

async function getPreparation(ownerId: string, id: number) {
  return env.DB.prepare(`SELECT p.id, p.event_id, p.title, p.timing, p.status
    FROM preparation_items p INNER JOIN events e ON e.id = p.event_id WHERE p.id = ? AND e.owner_id = ?`)
    .bind(id, ownerId).first<StoredPreparation>();
}

export async function createPreparation(ownerId: string, eventId: number, input: { title: string; timing: string }) {
  await ensureEventSchema();
  const result = await env.DB.prepare(`INSERT INTO preparation_items (event_id, title, timing, status, source)
    SELECT id, ?, ?, 'pending', 'user' FROM events WHERE id = ? AND owner_id = ?`)
    .bind(input.title, input.timing, eventId, ownerId).run();
  return Number(result.meta.changes) === 1 ? getPreparation(ownerId, Number(result.meta.last_row_id)) : null;
}

export async function editPreparation(ownerId: string, id: number, input: { title: string; timing: string }) {
  await ensureEventSchema();
  const result = await env.DB.prepare(`UPDATE preparation_items SET title = ?, timing = ? WHERE id = ?
    AND EXISTS (SELECT 1 FROM events e WHERE e.id = preparation_items.event_id AND e.owner_id = ?)`)
    .bind(input.title, input.timing, id, ownerId).run();
  return Number(result.meta.changes) === 1 ? getPreparation(ownerId, id) : null;
}

export async function deletePreparation(ownerId: string, id: number) {
  await ensureEventSchema();
  const item = await getPreparation(ownerId, id);
  if (!item) return false;
  const keys = recommendationKeysForTitle(item.title);
  const result = await env.DB.batch([
    ...keys.map((key) => env.DB.prepare(`INSERT INTO recommendation_state (event_id, rule_key, preparation_id)
      SELECT p.event_id, ?, p.id FROM preparation_items p INNER JOIN events e ON e.id = p.event_id
      WHERE p.id = ? AND p.title = ? AND e.owner_id = ?
      ON CONFLICT(event_id, rule_key) DO UPDATE SET preparation_id = COALESCE(recommendation_state.preparation_id, excluded.preparation_id)`)
      .bind(key, id, item.title, ownerId)),
    env.DB.prepare(`DELETE FROM preparation_items WHERE id = ? AND title = ?
      AND EXISTS (SELECT 1 FROM events e WHERE e.id = preparation_items.event_id AND e.owner_id = ?)`)
      .bind(id, item.title, ownerId),
  ]);
  return Number(result[result.length - 1].meta.changes) === 1;
}
