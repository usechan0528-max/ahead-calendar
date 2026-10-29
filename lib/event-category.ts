export const PRESET_CATEGORIES = ['기념일', '행사', '여행', '일정'] as const;
export const MAX_CATEGORY_LENGTH = 20;

export function isPresetCategory(value: string): value is (typeof PRESET_CATEGORIES)[number] {
  return PRESET_CATEGORIES.some(category => category === value);
}

export function parseEventCategory(value: unknown): string | null {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return null;
  const category = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  return category.replace(/\p{Cf}/gu, '').trim().length > 0 && category.length <= MAX_CATEGORY_LENGTH ? category : null;
}

export function eventCategoryOptions(values: readonly string[]) {
  const custom = [...new Set(values.map(parseEventCategory).filter((value): value is string => !!value && !isPresetCategory(value)))];
  return [...PRESET_CATEGORIES, ...custom.sort((a, b) => a.localeCompare(b, 'ko'))];
}
