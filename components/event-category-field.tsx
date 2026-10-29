'use client';

import { useState } from 'react';
import { MAX_CATEGORY_LENGTH, PRESET_CATEGORIES, isPresetCategory } from '@/lib/event-category';
import { getCategoryTheme } from '@/lib/design-tokens';

export function EventCategoryField({ value, onChange, colors = {} }: { value: string; onChange: (category: string) => void; colors?: Record<string, string> }) {
  const [custom, setCustom] = useState(() => !isPresetCategory(value));
  const [customValue, setCustomValue] = useState(() => isPresetCategory(value) ? '' : value);
  return <fieldset className="event-category-field">
    <legend className="sr-only">일정 종류</legend>
    <input type="hidden" name="category" value={value} />
    <div className="event-category-options">
      {PRESET_CATEGORIES.map(category => <label key={category}>
        <input className="sr-only" type="radio" name="categoryChoice" value={category} checked={!custom && value === category} onChange={() => { setCustom(false); onChange(category); }} />
        <span><i aria-hidden="true" style={{ background: getCategoryTheme(category, colors[category]).accent }} />{category}</span>
      </label>)}
      <label><input className="sr-only" type="radio" name="categoryChoice" value="custom" checked={custom} onChange={() => { setCustom(true); onChange(customValue); }} /><span>직접 입력</span></label>
    </div>
    {custom && <label className="event-category-custom"><span>종류 이름<small>최대 {MAX_CATEGORY_LENGTH}자</small></span>
      <input type="text" name="categoryCustom" value={customValue} required maxLength={MAX_CATEGORY_LENGTH} pattern=".*\S.*" placeholder="예: 운동, 공부, 업무" onChange={event => { setCustomValue(event.target.value); onChange(event.target.value); }} />
    </label>}
  </fieldset>;
}
