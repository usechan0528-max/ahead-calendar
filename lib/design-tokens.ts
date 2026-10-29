import { isPresetCategory } from './event-category';

export const CATEGORY_PALETTE = [
  { name: '장미', color: '#be3455' }, { name: '파랑', color: '#2563b8' },
  { name: '초록', color: '#218357' }, { name: '보라', color: '#7c4bb4' },
  { name: '주황', color: '#b76c12' }, { name: '청록', color: '#117d89' },
  { name: '벽돌', color: '#b54e27' }, { name: '회색', color: '#596778' },
] as const;

export function parseCategoryColor(value: unknown) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

function themeForColor(accent: string) {
  const rgb = [1, 3, 5].map(index => parseInt(accent.slice(index, index + 2), 16));
  const hex = (values: number[]) => `#${values.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
  const softRgb = rgb.map(value => value * .13 + 255 * .87);
  const luminance = (values: number[]) => values.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  let textRgb = rgb;
  // Darken the label only; preserve the exact user color on markers and borders.
  while ((luminance(softRgb) + .05) / (luminance(textRgb) + .05) < 4.8) textRgb = textRgb.map(value => Math.floor(value * .85));
  return { accent, soft: hex(softRgb), text: hex(textRgb) };
}

/** Shared, distinct identity across calendar, overview and detail surfaces. */
export const categoryTheme = {
  기념일: themeForColor(CATEGORY_PALETTE[0].color), 행사: themeForColor(CATEGORY_PALETTE[1].color),
  여행: themeForColor(CATEGORY_PALETTE[2].color), 일정: themeForColor(CATEGORY_PALETTE[3].color),
};

export function getCategoryTheme(category: string, override?: unknown) {
  const color = parseCategoryColor(override);
  if (color) return themeForColor(color);
  if (isPresetCategory(category)) return categoryTheme[category];
  const hash = Array.from(category.normalize('NFC')).reduce((value, char) => (Math.imul(value, 31) + char.codePointAt(0)!) >>> 0, 0);
  return themeForColor(CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length].color);
}
