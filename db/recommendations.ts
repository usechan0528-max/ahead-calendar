import { env } from 'cloudflare:workers';
import { buildRecommendations, isRecommendationProfile, normalizePreparationTitle, type RecommendationEvent, type RecommendationProfile, type RecommendationSnapshot } from '../lib/preparation-recommendations';
import type { StoredPreparation } from './events';
import { mapOverride, type OverrideRow } from './occurrence-data';
import { relevantResolvedOccurrence } from '../lib/occurrences';

type EventRow = { id: number; title: string; category: string; event_date: string; event_time: string; all_day: number; all_day_reminder_time: string; end_date: string | null; end_time: string | null; location: string; travel_plan_json: string | null; recurrence: RecommendationEvent['recurrence']; recurrence_interval: number; recurrence_day: number | null; notification_revision: number; profile: string | null; profile_revision: number; preparations_enabled: number };
type Preparation = StoredPreparation & { recommendation_key: string | null };
type State = { rule_key: string; preparation_id: number | null; dismissed: number };
export type RecommendationAction = { action: 'adopt' | 'dismiss'; ruleId: string; token: string; timing?: string } | { action: 'restore'; token: string } | { action: 'profile'; profile: RecommendationProfile; token: string };

async function load(ownerId: string, eventId: number) {
  // One transactional snapshot: never mistake a concurrently adopted item for a deleted one.
  const reads = await env.DB.batch([
    env.DB.prepare(`SELECT e.*, s.profile, COALESCE(s.revision, 0) AS profile_revision
      FROM events e LEFT JOIN recommendation_settings s ON s.event_id = e.id WHERE e.id = ? AND e.owner_id = ?`).bind(eventId, ownerId),
    env.DB.prepare(`SELECT p.id, p.event_id, p.title, p.timing, p.status, p.recommendation_key FROM preparation_items p
      INNER JOIN events e ON e.id = p.event_id WHERE e.id = ? AND e.owner_id = ? ORDER BY p.id`).bind(eventId, ownerId),
    env.DB.prepare(`SELECT s.rule_key, s.preparation_id, s.dismissed FROM recommendation_state s
      INNER JOIN events e ON e.id = s.event_id WHERE e.id = ? AND e.owner_id = ?`).bind(eventId, ownerId),
    env.DB.prepare(`SELECT o.* FROM event_occurrence_overrides o JOIN events e ON e.id = o.event_id WHERE e.id = ? AND e.owner_id = ?`).bind(eventId, ownerId),
  ]);
  const row = reads[0].results[0] as (EventRow & { recurrence_until: string | null }) | undefined;
  if (!row) return null;
  const preparations = { results: reads[1].results as Preparation[] };
  const states = { results: reads[2].results as State[] };
  const event: RecommendationEvent = { title: row.title, category: row.category, location: row.location, hasTravelPlan: !!row.travel_plan_json && row.travel_plan_json !== 'null',
    eventDate: row.event_date, eventTime: row.event_time, allDay: !!row.all_day, allDayReminderTime: row.all_day_reminder_time,
    endDate: row.end_date, endTime: row.end_time, recurrence: row.recurrence, recurrenceInterval: row.recurrence_interval, recurrenceDay: row.recurrence_day,
    recurrenceUntil: row.recurrence_until };
  const configuredProfile = isRecommendationProfile(row.profile) ? row.profile : 'auto';
  const now = new Date();
  const resolved = relevantResolvedOccurrence({ ...event, occurrenceOverrides: (reads[3].results as OverrideRow[]).map(mapOverride) }, undefined, now);
  const generated = buildRecommendations(resolved?.event ?? event, configuredProfile, now);
  if (!resolved) { generated.items = []; generated.basis = '다가오는 회차가 없어요.'; }
  const snapshot: RecommendationSnapshot = {
    token: `${row.notification_revision}:${row.profile_revision}:${generated.occurrenceDate}:${row.preparations_enabled}`, configuredProfile,
    profile: generated.profile, profileLabel: generated.profileLabel, basis: generated.basis, occurrenceDate: generated.occurrenceDate,
    recurring: event.recurrence !== 'none', generatedAt: now.toISOString(), enabled: row.preparations_enabled !== 0,
    items: (row.preparations_enabled === 0 ? [] : generated.items).map((item) => {
      const state = states.results.find((entry) => entry.rule_key === item.id);
      const names = [item.title, ...item.aliases].map(normalizePreparationTitle);
      const prep = state?.preparation_id != null ? preparations.results.find((p) => p.id === state.preparation_id)
        : preparations.results.find((p) => p.recommendation_key === item.id || names.includes(normalizePreparationTitle(p.title)));
      return { ...item, preparationId: prep?.id ?? null,
        state: prep ? 'added' : state?.preparation_id != null ? 'removed' : state?.dismissed ? 'dismissed' : 'available' };
    }),
  };
  return { row, preparations: preparations.results, states: states.results, snapshot };
}

export async function getRecommendations(ownerId: string, eventId: number) { return (await load(ownerId, eventId))?.snapshot ?? null; }

export async function changeRecommendation(ownerId: string, eventId: number, action: RecommendationAction) {
  const context = await load(ownerId, eventId);
  if (!context) return { status: 'not_found' as const };
  const { row, snapshot } = context;
  if (!snapshot.enabled) return { status: 'disabled' as const, snapshot };
  if (snapshot.token !== action.token) return { status: 'stale' as const, snapshot };
  // Guard each SQL write against concurrent event/profile edits, not just the initial read.
  const guard = `EXISTS (SELECT 1 FROM events e LEFT JOIN recommendation_settings s ON s.event_id = e.id
    WHERE e.id = ? AND e.owner_id = ? AND e.notification_revision = ? AND COALESCE(s.revision, 0) = ? AND e.preparations_enabled = 1)`;
  const guardValues = [eventId, ownerId, row.notification_revision, row.profile_revision];
  let preparation: StoredPreparation | undefined;
  let outcome: 'adopted' | 'existing' | 'dismissed' | 'restored' | 'profile' = 'profile';

  if (action.action === 'profile') {
    const result = await env.DB.prepare(`INSERT INTO recommendation_settings (event_id, profile, revision)
      SELECT ?, ?, 1 WHERE ${guard} ON CONFLICT(event_id) DO UPDATE SET profile = excluded.profile, revision = recommendation_settings.revision + 1`)
      .bind(eventId, action.profile, ...guardValues).run();
    if (!result.meta.changes) return { status: 'stale' as const };
  } else if (action.action === 'restore') {
    await env.DB.prepare(`UPDATE recommendation_state SET dismissed = 0 WHERE event_id = ? AND ${guard}`).bind(eventId, ...guardValues).run();
    outcome = 'restored';
  } else {
    const item = snapshot.items.find((candidate) => candidate.id === action.ruleId);
    if (!item) return { status: 'invalid' as const };
    if (action.action === 'dismiss') {
      await env.DB.prepare(`INSERT INTO recommendation_state (event_id, rule_key, dismissed) SELECT ?, ?, 1 WHERE ${guard}
        ON CONFLICT(event_id, rule_key) DO UPDATE SET dismissed = 1`).bind(eventId, item.id, ...guardValues).run();
      outcome = 'dismissed';
    } else {
      if (item.state === 'removed' || item.state === 'dismissed') return { status: 'unavailable' as const };
      const names = [item.title, ...item.aliases].map(normalizePreparationTitle);
      // Existing user/seeded equivalents are adopted without rewriting their title, timing or completion.
      const match = `(p.recommendation_key = ? OR p.id = ? OR replace(replace(replace(lower(trim(p.title)), ' ', ''), char(9), ''), char(10), '') IN (${names.map(() => '?').join(',')}))`;
      const matchValues = [item.id, item.preparationId ?? -1, ...names];
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO recommendation_state (event_id, rule_key) SELECT ?, ? WHERE ${guard} ON CONFLICT(event_id, rule_key) DO NOTHING`).bind(eventId, item.id, ...guardValues),
        env.DB.prepare(`INSERT INTO preparation_items (event_id, title, timing, status, source, recommendation_key)
          SELECT ?, ?, ?, 'pending', 'recommendation', ? WHERE ${guard}
          AND EXISTS (SELECT 1 FROM recommendation_state WHERE event_id = ? AND rule_key = ? AND preparation_id IS NULL AND dismissed = 0)
          AND NOT EXISTS (SELECT 1 FROM preparation_items p WHERE p.event_id = ? AND ${match})
          ON CONFLICT(event_id, recommendation_key) DO NOTHING`)
          .bind(eventId, item.title, action.timing ?? `${item.timing} · 추천 준비 시점`, item.id, ...guardValues, eventId, item.id, eventId, ...matchValues),
        env.DB.prepare(`UPDATE recommendation_state SET preparation_id = (SELECT p.id FROM preparation_items p WHERE p.event_id = ? AND ${match} ORDER BY p.id LIMIT 1)
          WHERE event_id = ? AND rule_key = ? AND preparation_id IS NULL AND dismissed = 0 AND ${guard}`)
          .bind(eventId, ...matchValues, eventId, item.id, ...guardValues),
      ]);
      outcome = item.state === 'added' ? 'existing' : 'adopted';
    }
  }
  const current = await load(ownerId, eventId);
  if (!current) return { status: 'not_found' as const };
  if (action.action === 'adopt') {
    // A later profile edit must not hide an adoption that already committed successfully.
    const receipt = current.states.find((item) => item.rule_key === action.ruleId);
    preparation = current.preparations.find((item) => item.id === receipt?.preparation_id);
    if (!preparation && current.snapshot.token !== snapshot.token) return { status: 'stale' as const, snapshot: current.snapshot };
    if (!preparation) return { status: 'unavailable' as const, snapshot: current.snapshot };
  } else if (action.action !== 'profile' && current.snapshot.token !== snapshot.token) return { status: 'stale' as const, snapshot: current.snapshot };
  return { status: 'ok' as const, outcome, snapshot: current.snapshot, preparation };
}
