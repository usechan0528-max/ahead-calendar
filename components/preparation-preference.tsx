'use client';

import { useEffect, useRef, useState } from 'react';
import { EditorSection } from './editor-section';

function PreparationSwitch({ enabled, disabled, onChange, name }: { enabled: boolean; disabled?: boolean; onChange: (value: boolean) => void; name?: string }) {
  return <label className="preparation-switch">
    <span><strong>준비 항목 사용</strong><small>{enabled ? '체크리스트와 맞춤 추천을 표시해요.' : '체크리스트와 맞춤 추천을 표시하지 않아요.'}</small></span>
    <input type="checkbox" role="switch" name={name} checked={enabled} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
  </label>;
}

export function PreparationField({ initialEnabled = true }: { initialEnabled?: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  return <EditorSection title="준비 항목" summary={enabled ? '사용 · 필요한 항목은 직접 선택' : '사용 안 함'}><div className="preparation-preference is-form"><PreparationSwitch name="preparationsEnabled" enabled={enabled} onChange={setEnabled} /><p>언제든 바꿀 수 있어요. 기존 준비 기록과 알림은 그대로 유지돼요.</p></div></EditorSection>;
}

export function PreparationPreference({ eventId, enabled, disabled = false, onBusyChange, onSaved, onFeedback }: { eventId?: number; enabled: boolean; disabled?: boolean; onBusyChange?: (busy: boolean) => void; onSaved: (enabled: boolean) => void; onFeedback: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function save(next: boolean) {
    if (locked.current || disabled) return;
    if (!eventId) { onSaved(next); return; }
    locked.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    try {
      const response = await fetch(`/api/events/${eventId}/preparation-settings`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: next }) });
      const result = await response.json() as { enabled?: boolean; error?: string };
      if (!response.ok || typeof result.enabled !== 'boolean') throw new Error(result.error || '설정을 저장하지 못했어요.');
      // Update only the captured event when the user changes selection mid-request.
      onSaved(result.enabled);
      onFeedback(result.enabled ? '준비 항목을 다시 표시해요.' : '준비 항목을 숨겼어요. 기존 기록과 알림은 유지돼요.');
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : '설정을 저장하지 못했어요. 다시 시도해 주세요.');
    } finally { locked.current = false; onBusyChange?.(false); if (alive.current) setBusy(false); }
  }
  return <div className="preparation-preference" aria-busy={busy}>
    <PreparationSwitch enabled={enabled} disabled={busy || disabled} onChange={(next) => void save(next)} />
    {!enabled && <p>기존 준비 기록은 보관돼요. 다시 켜면 이어서 쓸 수 있어요. 알림 설정은 바뀌지 않아요.</p>}
    {busy && <p role="status">설정을 저장하고 있어요…</p>}
    {error && <p role="alert" className="editor-error">{error}</p>}
  </div>;
}
