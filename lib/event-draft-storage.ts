import { isCreationRequestId } from './event-save';
import { parseInitialReminderChoice, type InitialReminderChoice } from './reminder-settings';
import { parseKakaoPlace } from './kakao-place';
import { MAX_WAYPOINTS, parseTravelPlan, travelModes, type TravelMode } from './travel-plan';

const fields = ['title', 'date', 'time', 'allDay', 'hasEnd', 'endDate', 'endTime', 'allDayReminderTime', 'category', 'location', 'place', 'travelPlan', 'routeOriginQuery', 'preparationsEnabled', 'recurrence', 'recurrenceInterval', 'recurrenceDay', 'recurrenceUntil', 'note', 'initialReminderChoice', 'initialReminderDraft', 'rememberInitialReminders'] as const;
export type DraftValues = Partial<Record<typeof fields[number], string>>;
export type CreationAttempt = { requestId: string; scope: string; payload: string; values: DraftValues; reminders: InitialReminderChoice; remember: boolean };
export type EventDraft = { version: 1; draftId: string; scope: string; savedAt: number; values: DraftValues; pending: CreationAttempt | null };
export const EVENT_DRAFT_TTL = 7 * 86_400_000;
const LIMIT = 60000;
export const eventDraftKey = (scope: string, draftId: string) => `toj:event-draft:v1:${scope}:${draftId}`;
export function captureDraftValues(data: FormData): DraftValues {
  const values: DraftValues = {};
  for (const field of fields) { const value = data.get(field); if (typeof value === 'string') values[field] = value; }
  return values;
}
function validValues(value: unknown): value is DraftValues {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([key, item]) => (fields as readonly string[]).includes(key) && typeof item === 'string' && item.length <= 16000);
}
export function readEventDraft(raw: string | null, scope: string, now = Date.now()): EventDraft | null {
  if (!raw || raw.length > LIMIT || !/^[a-f0-9]{64}$/.test(scope)) return null;
  try {
    const value = JSON.parse(raw) as EventDraft;
    if (value.version !== 1 || !isCreationRequestId(value.draftId) || value.scope !== scope || !Number.isFinite(value.savedAt) || value.savedAt > now || now - value.savedAt > EVENT_DRAFT_TTL || !validValues(value.values)) return null;
    if (value.pending !== null) {
      const pending = value.pending;
      if (!pending || pending.requestId !== value.draftId || !isCreationRequestId(pending.requestId) || pending.scope !== scope || typeof pending.payload !== 'string'
        || typeof pending.remember !== 'boolean' || !validValues(pending.values) || !parseInitialReminderChoice(pending.reminders)) return null;
      const payload = JSON.parse(pending.payload);
      if (!payload || typeof payload !== 'object' || payload.requestId !== pending.requestId) return null;
    }
    return value;
  } catch { return null; }
}
export function loadLatestEventDraft(storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'removeItem'>, scope: string) {
  const prefix = `toj:event-draft:v1:${scope}:`;
  const drafts: EventDraft[] = [];
  const expired: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index); if (!key?.startsWith(prefix)) continue;
    const draft = readEventDraft(storage.getItem(key), scope);
    if (draft) drafts.push(draft); else expired.push(key);
  }
  expired.forEach(key => storage.removeItem(key));
  return drafts.sort((a, b) => Number(!!b.pending) - Number(!!a.pending) || b.savedAt - a.savedAt)[0] ?? null;
}
export function writeEventDraft(storage: Pick<Storage, 'getItem' | 'setItem'>, draft: EventDraft) {
  const raw = JSON.stringify(draft);
  if (raw.length > LIMIT) throw new Error('draft-too-large');
  const key = eventDraftKey(draft.scope, draft.draftId);
  const existing = readEventDraft(storage.getItem(key), draft.scope);
  // Another tab may have submitted this same draft. Never erase its pending identity.
  if (existing?.pending && !draft.pending) return;
  storage.setItem(key, raw);
}
export function draftInitial(values: DraftValues) {
  const parse = (raw: string | undefined) => { try { return JSON.parse(raw ?? 'null'); } catch { return null; } };
  const raw = parse(values.travelPlan);
  const travelDraft = raw && typeof raw === 'object' && travelModes.includes(raw.mode) && Array.isArray(raw.waypoints) && raw.waypoints.length <= MAX_WAYPOINTS
    ? { origin: parseKakaoPlace(raw.origin), waypoints: raw.waypoints.map((point: unknown) => parseKakaoPlace(point)).filter((point: unknown) => !!point) as NonNullable<ReturnType<typeof parseKakaoPlace>>[], mode: raw.mode as TravelMode } : undefined;
  return {
    eventTime: values.time ?? '09:00', allDay: values.allDay !== undefined,
    allDayReminderTime: values.allDayReminderTime ?? '09:00',
    hasEnd: values.hasEnd !== undefined, endDate: values.hasEnd !== undefined ? values.endDate ?? '' : null, endTime: values.hasEnd !== undefined ? values.endTime ?? null : null,
    place: parseKakaoPlace(parse(values.place)), travelPlan: parseTravelPlan(parse(values.travelPlan)),
    travelDraft,
    reminders: parseInitialReminderChoice(parse(values.initialReminderChoice)),
    preparationsEnabled: values.preparationsEnabled !== undefined,
  };
}
