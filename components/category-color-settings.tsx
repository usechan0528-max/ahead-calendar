'use client';
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { CATEGORY_PALETTE, getCategoryTheme } from '@/lib/design-tokens';

export type ColorSettings = { colors: Record<string, string>; ready: boolean; busy: boolean; error: string | null; refresh: () => void; save: (category: string, color: string | null) => Promise<boolean> };
export function CategoryColorSettings({ categories, settings, offline }: { categories: string[]; settings: ColorSettings; offline: boolean }) {
  const [selected, setSelected] = useState(categories[0]);
  const [message, setMessage] = useState('');
  const category = categories.includes(selected) ? selected : categories[0];
  const saved = Object.hasOwn(settings.colors, category) ? settings.colors[category] : null;
  return <details className="category-color-settings">
    <summary>종류별 색상</summary>
    <div><label className="category-color-select">일정 종류<select value={category} disabled={settings.busy} onChange={event => { setSelected(event.target.value); setMessage(''); }}>{categories.map(name => <option key={name}>{name}</option>)}</select></label>
      <CategoryColorEditor key={`${category}:${saved}`} category={category} saved={saved} settings={settings} offline={offline} onMessage={setMessage} />
      <p className="category-color-message" role="status">{offline ? '인터넷 연결 후 저장할 수 있어요.' : !settings.ready ? settings.error ? '' : '색상을 불러오는 중…' : message}</p>
      {settings.error && <p className="category-color-error" role="alert">{settings.error} <button type="button" className="text-button" disabled={settings.busy} onClick={settings.refresh}>다시 불러오기</button></p>}
    </div>
  </details>;
}
function CategoryColorEditor({ category, saved, settings, offline, onMessage }: { category: string; saved: string | null; settings: ColorSettings; offline: boolean; onMessage: (message: string) => void }) {
  const [choice, setChoice] = useState(saved);
  const theme = getCategoryTheme(category, choice);
  const change = (color: string | null) => { setChoice(color); onMessage(''); };
  return <form onSubmit={async event => { event.preventDefault(); if (settings.busy || !settings.ready || offline || choice === saved) return; onMessage(''); if (await settings.save(category, choice)) onMessage(`${category} 색상을 저장했어요.`); }}>
    <fieldset disabled={settings.busy || !settings.ready || offline}><legend className="sr-only">종류 색상 선택</legend>
      <div className="category-palette">{CATEGORY_PALETTE.map(item => <button key={item.color} type="button" style={{ '--swatch': item.color } as CSSProperties} aria-label={`${item.name} 색 선택`} aria-pressed={theme.accent === item.color} onClick={() => change(item.color)}><span aria-hidden="true" /></button>)}
        <label className="category-custom-color">직접 선택<input type="color" value={theme.accent} onChange={event => change(event.target.value)} /></label></div>
      <div className="category-color-preview" style={{ borderColor: theme.accent, background: theme.soft, color: theme.text }}><span style={{ background: theme.accent }} />{category}</div>
      <p className="category-color-scope">같은 종류의 모든 일정에 적용돼요.</p>
      <div className="category-color-actions"><button type="submit" className="primary-button" disabled={choice === saved}>{settings.busy ? '저장 중…' : '색상 저장'}</button><button type="button" className="text-button" onClick={() => change(null)}>기본색으로</button></div>
    </fieldset>
  </form>;
}
