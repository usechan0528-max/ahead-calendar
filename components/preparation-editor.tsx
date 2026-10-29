'use client';

import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AppIcon } from './calendar-workspace';

export type PreparationItem = { id?: number; label: string; meta: string; tone: 'now' | 'soon' | 'later'; complete: boolean };

export function PreparationEditor({ eventId, items, onToggle, onSaved, onDeleted, completionDisabled = false, canComplete = true }: {
  eventId?: number; items: PreparationItem[];
  onToggle: (item: PreparationItem) => Promise<void>;
  onSaved: (item: Omit<PreparationItem, 'complete'>) => void;
  onDeleted: (id: number) => void;
  completionDisabled?: boolean;
  canComplete?: boolean;
}) {
  const [draft, setDraft] = useState<{ id?: number; title: string; timing: string } | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  function lock() { if (busyRef.current) return false; busyRef.current = true; setBusy(true); setError(null); return true; }
  function unlock() { busyRef.current = false; setBusy(false); }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!eventId || !draft || !lock()) return;
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(draft.id ? `/api/preparations/${draft.id}` : `/api/events/${eventId}/preparations`, {
        method: draft.id ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: String(form.get('title')).trim(), timing: String(form.get('timing')).trim() }),
      });
      if (!response.ok) throw new Error(response.status === 404 ? '항목을 찾지 못했어요. 새로고침 후 다시 시도해 주세요.' : '저장하지 못했어요. 내용을 확인하고 다시 시도해 주세요.');
      const { preparation } = await response.json() as { preparation: { id: number; title: string; timing: string } };
      onSaved({ id: preparation.id, label: preparation.title, meta: preparation.timing, tone: 'later' });
      setDraft(null);
    } catch (error) { setError(error instanceof Error ? error.message : '다시 시도해 주세요.'); }
    finally { unlock(); }
  }

  async function remove(id: number) {
    if (!lock()) return;
    try {
      const response = await fetch(`/api/preparations/${id}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 404) throw new Error('삭제하지 못했어요. 다시 시도해 주세요.');
      onDeleted(id); setDeleting(null);
    } catch (error) { setError(error instanceof Error ? error.message : '다시 시도해 주세요.'); }
    finally { unlock(); }
  }

  return <section aria-label="준비 체크리스트">
    <div className="editor-heading"><h3 id="preparation-checklist-title" tabIndex={-1}>준비 체크리스트</h3><span>{items.filter((item) => item.complete).length}/{items.length} 완료</span></div>
    <progress className="preparation-progress" value={items.filter((item) => item.complete).length} max={Math.max(1, items.length)} aria-label="준비 완료 진행률" />
    <p className="editor-help">준비 시점은 메모예요. 푸시 알림은 ‘알림’에서 별도로 설정해 주세요.</p>
    <div className="preparation-items">{items.map((item, index) => <div key={item.id ?? item.label} className={`preparation-item ${item.complete ? 'is-complete' : ''}`}>
      <button type="button" className="preparation-check" disabled={busy || completionDisabled || (!item.complete && !canComplete)} aria-pressed={item.complete} onClick={async () => { if (!lock()) return; try { await onToggle(item); } finally { unlock(); } }}>
        <span className="check-circle">{item.complete ? <AppIcon name="check" size={17} /> : index + 1}</span><span><strong>{item.label}</strong><span>{item.meta}</span></span>
      </button>
      {item.id && <div className="item-actions"><button type="button" disabled={busy} aria-label={`${item.label} 수정`} onClick={() => { setDraft({ id: item.id, title: item.label, timing: item.meta }); setDeleting(null); setError(null); }}>수정</button><button type="button" disabled={busy} aria-label={`${item.label} 삭제`} onClick={() => { setDeleting(item.id!); setDraft(null); setError(null); }}>삭제</button></div>}
      {deleting === item.id && <div className="inline-confirm"><span>이 준비 항목을 삭제할까요?</span><div><button type="button" disabled={busy} onClick={() => setDeleting(null)}>취소</button><button type="button" className="danger-text" disabled={busy} onClick={() => remove(item.id!)}>삭제하기</button></div></div>}
    </div>)}</div>
    {items.length === 0 && <p className="editor-empty">아직 준비 항목이 없어요. 필요한 일을 직접 추가해 보세요.</p>}
    {draft ? <form className="inline-editor" onSubmit={save} key={draft.id ?? 'new'} aria-label={draft.id ? '준비 항목 수정' : '준비 항목 추가'}>
      <label>준비할 일<input name="title" required maxLength={160} defaultValue={draft.title} autoFocus placeholder="예: 케이크 예약하기" disabled={busy} /></label>
      <label>준비 시점 <span>(메모)</span><input name="timing" required maxLength={60} defaultValue={draft.timing} placeholder="예: 일주일 전까지" disabled={busy} /></label>
      <div className="editor-buttons"><button type="button" disabled={busy} onClick={() => { setDraft(null); setError(null); }}>취소</button><button type="submit" disabled={busy} className="primary-button">{busy ? '저장 중…' : '저장'}</button></div>
    </form> : <button type="button" className="add-item-button" disabled={!eventId || busy} onClick={() => { setDraft({ title: '', timing: '일정 전' }); setDeleting(null); setError(null); }}><AppIcon name="plus" size={17} />준비 항목 추가</button>}
    {!eventId && <p className="editor-help">내 일정을 저장하면 준비 항목을 직접 편집할 수 있어요.</p>}
    {error && <p role="alert" className="editor-error">{error}</p>}
  </section>;
}
