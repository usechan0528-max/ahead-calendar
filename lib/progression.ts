/** Portable product rules. No browser, React, database or hosting dependencies. */
export const PROGRESSION_VERSION = 1;
export const DAILY_XP_CAP = 60;
export const FINAL_XP = 12_000;
export const MAX_LEVEL = 50;
export const XP_REWARDS = { event: 10, preparation: 3, goal: 10 } as const;
export type CompletionKind = 'event' | 'preparation';
export const LEVEL_THRESHOLDS = Array.from({ length: MAX_LEVEL }, (_, index) =>
  Math.round(20 * index + (FINAL_XP - 20 * (MAX_LEVEL - 1)) * (index / (MAX_LEVEL - 1)) ** 2));

export function growthLevel(totalXp: number) {
  const xp = Math.max(0, Math.floor(totalXp));
  const level = LEVEL_THRESHOLDS.findLastIndex((threshold) => xp >= threshold) + 1;
  const stage = level === 50 ? 'J' : level >= 36 ? 'J−' : level >= 21 ? 'PJ' : level >= 11 ? 'P+' : 'P';
  const floor = LEVEL_THRESHOLDS[level - 1];
  const next = level === MAX_LEVEL ? FINAL_XP : LEVEL_THRESHOLDS[level];
  return { level, stage, floor, next, remaining: Math.max(0, next - xp),
    progress: level === MAX_LEVEL ? 1 : (xp - floor) / (next - floor) };
}

export function completionKey(eventId: number, date: string, kind: CompletionKind, itemId = 0) {
  return `${kind}:${eventId}:${date}:${kind === 'event' ? 0 : itemId}`;
}

export type ProgressSummary = {
  version: number; day: string; totalXp: number; todayXp: number; activeDays: number;
  goal: { target: number; count: number; locked: boolean; achieved: boolean };
  completedEvents: Array<{ eventId: number; date: string }>;
};
export type OccurrenceCompletion = {
  eventId: number; date: string; complete: boolean; completedPreparationIds: number[];
  revision?: number;
  canCompleteEvent: boolean; canCompletePreparation: boolean;
};
