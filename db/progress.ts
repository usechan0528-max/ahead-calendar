import { attemptHistorySql } from './notification-history';
import { completionKey, DAILY_XP_CAP, PROGRESSION_VERSION, XP_REWARDS, type CompletionKind, type OccurrenceCompletion, type ProgressSummary } from '../lib/progression';
import { getSeoulDate, isValidEventDate, nextOccurrenceDate, occurrenceInstant, type RecurrenceRule } from '../lib/recurrence';
import { captureLegacyPreparationDates } from './legacy-completions';
import { readOccurrenceOverrides } from './occurrence-data';
import { relevantResolvedOccurrence, resolveOccurrence } from '../lib/occurrences';

export class ProgressError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
type EventRow = { id: number; owner_id: string; event_date: string; event_time: string; all_day: number;
  recurrence: RecurrenceRule['recurrence']; recurrence_interval: number; recurrence_day: number | null; recurrence_until: string | null;
  end_date: string | null; end_time: string | null; notification_revision: number };
const ruleFor = (e: EventRow): RecurrenceRule => ({ eventDate: e.event_date, recurrence: e.recurrence, recurrenceInterval: e.recurrence_interval, recurrenceDay: e.recurrence_day, recurrenceUntil: e.recurrence_until });

async function ownedOccurrence(db: D1Database, owner: string, eventId: number, date: string, now: Date) {
  if (!isValidEventDate(date)) throw new ProgressError(400, '올바른 날짜를 선택해 주세요.');
  const event = await db.prepare('SELECT id, owner_id, event_date, event_time, all_day, end_date, end_time, recurrence, recurrence_interval, recurrence_day, recurrence_until, notification_revision FROM events WHERE id = ? AND owner_id = ?')
    .bind(eventId, owner).first<EventRow>();
  if (!event) throw new ProgressError(404, '일정을 찾을 수 없어요.');
  const rule = ruleFor(event);
  if (nextOccurrenceDate(rule, date) !== date) throw new ProgressError(400, '실제로 발생하는 회차를 선택해 주세요.');
  const today = getSeoulDate(now);
  const master = { ...rule, eventTime: event.event_time, allDay: !!event.all_day, endDate: event.end_date, endTime: event.end_time,
    occurrenceOverrides: await readOccurrenceOverrides(db, eventId) };
  const resolved = resolveOccurrence(master, date);
  if (!resolved) throw new ProgressError(400, '취소된 회차는 완료할 수 없어요.');
  return { event, first: nextOccurrenceDate(rule, event.event_date),
    canCompleteEvent: resolved.event.allDay ? resolved.start <= today : occurrenceInstant(resolved.start, resolved.event.eventTime) <= now,
    canCompletePreparation: resolved.start <= today || date === relevantResolvedOccurrence(master, today, now)?.originalDate };
}

export async function readOccurrenceCompletion(db: D1Database, owner: string, eventId: number, date: string, now = new Date()): Promise<OccurrenceCompletion> {
  const { event, first, canCompleteEvent, canCompletePreparation } = await ownedOccurrence(db, owner, eventId, date, now);
  const [checks, preps] = await Promise.all([
    db.prepare('SELECT kind, item_id, complete FROM occurrence_completions WHERE owner_id = ? AND event_id = ? AND occurrence_date = ?').bind(owner, eventId, date).all<{ kind: CompletionKind; item_id: number; complete: number }>(),
    db.prepare('SELECT id, status, legacy_completed_date FROM preparation_items WHERE event_id = ?').bind(eventId).all<{ id: number; status: string; legacy_completed_date: string | null }>(),
  ]);
  const completedPreparationIds = preps.results.filter((p) => {
    const row = checks.results.find((c) => c.kind === 'preparation' && c.item_id === p.id);
    return row ? !!row.complete : p.status === 'complete' && date === (p.legacy_completed_date ?? first);
  }).map((p) => p.id);
  return { eventId, date, revision: event.notification_revision, complete: !!checks.results.find((c) => c.kind === 'event')?.complete,
    completedPreparationIds, canCompleteEvent, canCompletePreparation };
}

export async function readProgress(db: D1Database, owner: string, now = new Date()): Promise<ProgressSummary> {
  const day = getSeoulDate(now);
  const results = await db.batch([
    db.prepare(`SELECT COALESCE(SUM(xp), 0) AS total, COALESCE(SUM(CASE WHEN earned_date = ? THEN xp ELSE 0 END), 0) AS today,
      COUNT(DISTINCT CASE WHEN kind <> 'goal' THEN earned_date END) AS days,
      SUM(CASE WHEN kind = 'event' AND earned_date = ? THEN 1 ELSE 0 END) AS event_count,
      MAX(CASE WHEN kind = 'goal' AND earned_date = ? THEN 1 ELSE 0 END) AS achieved
      FROM xp_ledger WHERE owner_id = ?`).bind(day, day, day, owner),
    db.prepare('SELECT target FROM daily_goals WHERE owner_id = ? AND day = ?').bind(owner, day),
    db.prepare("SELECT event_id AS eventId, occurrence_date AS date FROM occurrence_completions WHERE owner_id = ? AND kind = 'event' AND complete = 1").bind(owner),
  ]);
  const aggregate = results[0].results[0] as { total: number; today: number; days: number; event_count: number | null; achieved: number | null };
  return { version: PROGRESSION_VERSION, day, totalXp: Number(aggregate.total), todayXp: Number(aggregate.today), activeDays: Number(aggregate.days),
    goal: { target: Number((results[1].results[0] as { target: number } | undefined)?.target ?? 3), count: Number(aggregate.event_count ?? 0), locked: !!aggregate.event_count, achieved: !!aggregate.achieved },
    completedEvents: results[2].results as ProgressSummary['completedEvents'] };
}

export async function setDailyGoal(db: D1Database, owner: string, target: number, now = new Date()) {
  if (!Number.isInteger(target) || target < 1 || target > 5) throw new ProgressError(400, '목표는 1~5개 중에서 선택해 주세요.');
  const day = getSeoulDate(now);
  const result = await db.prepare(`INSERT INTO daily_goals (owner_id, day, target)
    SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM xp_ledger WHERE owner_id = ? AND earned_date = ? AND kind = 'event')
    ON CONFLICT(owner_id, day) DO UPDATE SET target = excluded.target`).bind(owner, day, target, owner, day).run();
  if (!result.meta.changes) throw new ProgressError(409, '첫 계획을 완료한 뒤에는 오늘 목표가 고정돼요. 내일 다시 정할 수 있어요.');
  return readProgress(db, owner, now);
}

export async function setOccurrenceCompletion(db: D1Database, owner: string, eventId: number, date: string,
  kind: CompletionKind, itemId: number, complete: boolean, now = new Date(), expectedRevision?: number) {
  if (!['event', 'preparation'].includes(kind) || typeof complete !== 'boolean' || !Number.isSafeInteger(itemId)
    || (kind === 'event' ? itemId !== 0 : itemId <= 0)) throw new ProgressError(400, '완료 항목을 확인해 주세요.');
  const { event, first, canCompleteEvent, canCompletePreparation } = await ownedOccurrence(db, owner, eventId, date, now);
  if (expectedRevision !== undefined && event.notification_revision !== expectedRevision) {
    throw new ProgressError(409, '일정이 변경됐어요. 새로 불러온 뒤 다시 선택해 주세요.');
  }
  await captureLegacyPreparationDates(db, owner, eventId);
  if (complete && !(kind === 'event' ? canCompleteEvent : canCompletePreparation)) {
    throw new ProgressError(400, kind === 'event' ? '시작 전 일정은 아직 완료할 수 없어요.' : '미리 준비는 현재 또는 다음 회차에서 할 수 있어요.');
  }
  const day = getSeoulDate(now);
  const stamp = now.toISOString();
  const mutation = crypto.randomUUID();
  const key = completionKey(eventId, date, kind, itemId);
  // All statements run in a single D1 transaction. Award amounts are computed in SQL,
  // not from a stale client/server read. Zero-XP receipts prevent tomorrow's replay.
  const results = await db.batch([
    db.prepare(`INSERT INTO occurrence_completions (owner_id, event_id, occurrence_date, kind, item_id, complete, mutation_id, updated_at)
      SELECT e.owner_id, e.id, ?, ?, ?, ?, ?, ? FROM events e WHERE e.id = ? AND e.owner_id = ? AND e.notification_revision = ?
        AND (? = 'event' OR EXISTS (SELECT 1 FROM preparation_items p WHERE p.id = ? AND p.event_id = e.id))
      ON CONFLICT(owner_id, event_id, occurrence_date, kind, item_id) DO UPDATE SET complete = excluded.complete, mutation_id = excluded.mutation_id, updated_at = excluded.updated_at`)
      .bind(date, kind, itemId, complete ? 1 : 0, mutation, stamp, eventId, owner, event.notification_revision, kind, itemId),
    db.prepare(`INSERT INTO daily_goals (owner_id, day, target) SELECT ?, ?, 3
      WHERE EXISTS (SELECT 1 FROM occurrence_completions WHERE owner_id = ? AND mutation_id = ?)
      ON CONFLICT(owner_id, day) DO NOTHING`).bind(owner, day, owner, mutation),
    db.prepare(`INSERT INTO xp_ledger (owner_id, action_key, kind, earned_date, xp, rules_version, created_at)
      SELECT ?, ?, ?, ?, MAX(0, MIN(?, ? - COALESCE((SELECT SUM(xp) FROM xp_ledger WHERE owner_id = ? AND earned_date = ?), 0))), ?, ?
      WHERE EXISTS (SELECT 1 FROM occurrence_completions c WHERE c.owner_id = ? AND c.mutation_id = ? AND c.complete = 1)
        AND NOT (? = 'preparation' AND EXISTS (SELECT 1 FROM preparation_items WHERE id = ? AND event_id = ?
          AND ((legacy_completed_date = ?) OR (legacy_completed_date IS NULL AND ? = ? AND (status = 'complete' OR legacy_completed = 1)))))
      ON CONFLICT(owner_id, action_key) DO NOTHING`)
      .bind(owner, key, kind, day, XP_REWARDS[kind], DAILY_XP_CAP, owner, day, PROGRESSION_VERSION, stamp, owner, mutation, kind, itemId, eventId, date, date, first),
    db.prepare(`INSERT INTO xp_ledger (owner_id, action_key, kind, earned_date, xp, rules_version, created_at)
      SELECT ?, ?, 'goal', ?, MAX(0, MIN(?, ? - COALESCE((SELECT SUM(xp) FROM xp_ledger WHERE owner_id = ? AND earned_date = ?), 0))), ?, ?
      WHERE EXISTS (SELECT 1 FROM occurrence_completions WHERE owner_id = ? AND mutation_id = ? AND complete = 1)
        AND (SELECT COUNT(*) FROM xp_ledger WHERE owner_id = ? AND earned_date = ? AND kind = 'event') >=
          COALESCE((SELECT target FROM daily_goals WHERE owner_id = ? AND day = ?), 3)
      ON CONFLICT(owner_id, action_key) DO NOTHING`)
      .bind(owner, `goal:${day}`, day, XP_REWARDS.goal, DAILY_XP_CAP, owner, day, PROGRESSION_VERSION, stamp, owner, mutation, owner, day, owner, day),
    db.prepare(`UPDATE notification_jobs SET lifetime_attempt_count = ${attemptHistorySql()}, status = 'cancelled', claimed_at = NULL, updated_at = ?, last_error = 'Occurrence completed.'
      WHERE owner_id = ? AND event_id = ? AND kind = 'reminder' AND status IN ('scheduled', 'processing')
        AND COALESCE(original_occurrence_date, date(occurrence_at, '+9 hours')) = ? AND EXISTS (SELECT 1 FROM occurrence_completions
          WHERE owner_id = ? AND event_id = ? AND kind = 'event' AND complete = 1 AND mutation_id = ?)`)
      .bind(stamp, owner, eventId, date, owner, eventId, mutation),
  ]);
  if (!results[0].meta.changes) throw new ProgressError(409, '일정이나 항목이 변경됐어요. 새로고침 후 다시 시도해 주세요.');
  const [progress, occurrence] = await Promise.all([readProgress(db, owner, now), readOccurrenceCompletion(db, owner, eventId, date, now)]);
  return { progress, occurrence, awardedXp: results[2].meta.changes ? (await db.prepare('SELECT xp FROM xp_ledger WHERE owner_id = ? AND action_key = ?').bind(owner, key).first<{ xp: number }>())?.xp ?? 0 : 0 };
}
