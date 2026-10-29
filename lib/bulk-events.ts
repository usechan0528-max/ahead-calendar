import { isValidEventDate } from './recurrence';
import { parseEventCategory } from './event-category';

export const BULK_EVENT_LIMIT = 20;
export type BulkTarget = { id: number; revision: number; date: string | null };
export type BulkAction = 'complete' | 'pending' | 'category' | 'shift' | 'delete';
export type BulkRequest = { action: BulkAction; targets: BulkTarget[]; category?: string; days?: number };
export type BulkResult = { id: number; status: 'success' | 'failed' | 'unknown'; message?: string };

export function parseBulkRequest(value: unknown): BulkRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (typeof body.action !== 'string' || !['complete', 'pending', 'category', 'shift', 'delete'].includes(body.action)
    || !Array.isArray(body.targets) || !body.targets.length || body.targets.length > BULK_EVENT_LIMIT) return null;
  const keys = ['action', 'targets', ...(body.action === 'category' ? ['category'] : body.action === 'shift' ? ['days'] : [])];
  if (Object.keys(body).some(key => !keys.includes(key))) return null;
  const seen = new Set<number>();
  const targets: BulkTarget[] = [];
  for (const raw of body.targets) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || Object.keys(raw).some(key => !['id', 'revision', 'date'].includes(key))) return null;
    const { id, revision, date } = raw;
    if (!Number.isSafeInteger(id) || id < 1 || seen.has(id) || !Number.isSafeInteger(revision) || revision < 0
      || (date !== null && (typeof date !== 'string' || !isValidEventDate(date)))
      || (['complete', 'pending'].includes(String(body.action)) && date === null)) return null;
    seen.add(id); targets.push({ id, revision, date });
  }
  const category = body.action === 'category' ? parseEventCategory(body.category) : undefined;
  if (category === null || (body.action === 'shift' && (!Number.isInteger(body.days) || Number(body.days) === 0 || Math.abs(Number(body.days)) > 365))) return null;
  return { action: body.action as BulkAction, targets, ...(category ? { category } : {}), ...(body.action === 'shift' ? { days: body.days as number } : {}) };
}
