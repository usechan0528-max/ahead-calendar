export type ReminderRule = { id: number; offset_minutes: number };
export type ReminderPreset = 'minimal' | 'standard' | 'thorough';
export const reminderPresets: Record<ReminderPreset, number[]> = {
  minimal: [1440], standard: [10080, 1440, 120], thorough: [20160, 10080, 4320, 1440, 180, 60],
};

export function matchReminderPreset(rules: Array<{ offset_minutes: number }>): ReminderPreset | 'custom' | 'none' {
  if (!rules.length) return 'none';
  const offsets = rules.map((rule) => rule.offset_minutes).sort((a, b) => b - a);
  return (Object.keys(reminderPresets) as ReminderPreset[]).find((preset) =>
    offsets.length === reminderPresets[preset].length && offsets.every((offset, index) => offset === reminderPresets[preset][index]),
  ) ?? 'custom';
}

export function formatReminderOffset(minutes: number) {
  if (minutes === 0) return '시작 시각';
  if (minutes % 10080 === 0) return `${minutes / 10080}주 전`;
  if (minutes % 1440 === 0) return `${minutes / 1440}일 전`;
  if (minutes % 60 === 0) return `${minutes / 60}시간 전`;
  return `${minutes}분 전`;
}

export function offsetInput(minutes: number) {
  if (minutes > 0 && minutes % 1440 === 0) return { amount: minutes / 1440, unit: 1440 };
  if (minutes > 0 && minutes % 60 === 0) return { amount: minutes / 60, unit: 60 };
  return { amount: minutes, unit: 1 };
}

export const MAX_INITIAL_REMINDERS = 10;
export const INITIAL_REMINDER_PREFERENCE_KEY = 'to-j.initial-reminders.v1';
export type InitialReminderMode = 'none' | 'once' | 'standard' | 'custom';
export type InitialReminderChoice = { mode: InitialReminderMode; offsets: number[] };

export function parseInitialReminderOffsets(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > MAX_INITIAL_REMINDERS
    || value.some((offset) => typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > 525600)
    || new Set(value).size !== value.length) return null;
  return [...value].sort((a, b) => b - a);
}

export function parseInitialReminderChoice(value: unknown): InitialReminderChoice | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { mode, offsets: raw } = value as Record<string, unknown>;
  const offsets = parseInitialReminderOffsets(raw);
  if (!offsets || typeof mode !== 'string' || !['none', 'once', 'standard', 'custom'].includes(mode)) return null;
  if ((mode === 'none' && offsets.length !== 0) || (mode === 'once' && offsets.length !== 1)
    || (mode === 'custom' && offsets.length === 0)
    || (mode === 'standard' && (offsets.length !== 3 || offsets.some((offset, index) => offset !== reminderPresets.standard[index])))) return null;
  return { mode: mode as InitialReminderMode, offsets };
}

export function readInitialReminderPreference(raw: string | null): InitialReminderChoice | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value?.version === 1 ? parseInitialReminderChoice(value) : null;
  } catch { return null; }
}
