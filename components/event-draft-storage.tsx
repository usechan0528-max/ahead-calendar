'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { captureDraftValues, eventDraftKey, writeEventDraft, type CreationAttempt, type DraftValues } from '@/lib/event-draft-storage';

export function EventDraftStorage({ scope, draftId, initialEnabled, pending, onSnapshot, onEnabled }: {
  scope: string; draftId: string; initialEnabled: boolean; pending: CreationAttempt | null;
  onSnapshot: (values: DraftValues) => void; onEnabled: (enabled: boolean) => void;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState('');
  const current = useRef({ enabled, pending, onSnapshot, onEnabled });
  useLayoutEffect(() => { current.current = { enabled, pending, onSnapshot, onEnabled }; }, [enabled, pending, onSnapshot, onEnabled]);
  const flushRef = useRef<() => void>(() => {});
  useEffect(() => {
    const form = anchor.current?.closest('form'); if (!form || !scope) return;
    let frame = 0;
    const flush = () => {
      if (current.current.pending && current.current.pending.scope !== scope) return;
      // Disabled controls disappear from FormData during saving. Keep the exact attempted form.
      const values = current.current.pending?.values ?? captureDraftValues(new FormData(form));
      if (!Object.hasOwn(values, 'date')) return;
      current.current.onSnapshot(values);
      if (!current.current.enabled) return;
      try { writeEventDraft(localStorage, { version: 1, draftId, scope, savedAt: Date.now(), values, pending: current.current.pending }); setError(''); }
      catch { setEnabled(false); current.current.onEnabled(false); setError('이 기기에 임시 보관하지 못했어요. 창을 닫기 전에 일정을 저장해 주세요.'); }
    };
    flushRef.current = flush;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(flush); };
    schedule();
    form.addEventListener('input', schedule); form.addEventListener('change', schedule); form.addEventListener('click', schedule);
    const observer = new MutationObserver(schedule); observer.observe(form, { subtree: true, attributes: true, attributeFilter: ['value', 'checked'] });
    const background = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', background); window.addEventListener('pagehide', flush);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); form.removeEventListener('input', schedule); form.removeEventListener('change', schedule); form.removeEventListener('click', schedule); document.removeEventListener('visibilitychange', background); window.removeEventListener('pagehide', flush); };
  }, [scope, draftId]);
  useEffect(() => { flushRef.current(); }, [enabled, pending]);
  return <div ref={anchor} className="event-draft-control">
    <label><input type="checkbox" checked={enabled} disabled={!scope || !!pending} onChange={event => {
      const next = event.target.checked; setEnabled(next); onEnabled(next);
      if (!next) { try { localStorage.removeItem(eventDraftKey(scope, draftId)); setError(''); } catch { setError('임시 보관 내용을 지우지 못했어요. 브라우저 저장소 설정을 확인해 주세요.'); } }
    }} />이 기기에 임시 보관</label>
    <small>{enabled ? '7일 동안 이어 쓸 수 있어요. 공용 기기에서는 꺼 주세요.' : '선택하면 새 일정 작성 내용을 이 브라우저에만 보관해요.'}</small>
    {error && <p role="alert">{error}</p>}
  </div>;
}
