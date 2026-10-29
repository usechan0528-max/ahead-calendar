import type { OccurrenceChanges, OccurrenceOverride } from '../lib/occurrences';

export type OverrideRow = { event_id: number; original_date: string; cancelled: number; data_json: string | null; updated_at: string };
export function mapOverride(row: OverrideRow): OccurrenceOverride {
  return { originalDate: row.original_date, cancelled: !!row.cancelled,
    changes: row.data_json ? JSON.parse(row.data_json) as OccurrenceChanges : null, updatedAt: row.updated_at };
}
export async function readOccurrenceOverrides(db: D1Database, eventId: number) {
  const rows = await db.prepare('SELECT * FROM event_occurrence_overrides WHERE event_id = ? ORDER BY original_date').bind(eventId).all<OverrideRow>();
  return rows.results.map(mapOverride);
}
