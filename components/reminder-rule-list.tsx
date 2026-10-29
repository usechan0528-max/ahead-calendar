'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { formatReminderOffset, offsetInput, type ReminderRule } from '@/lib/reminder-settings';

export function ReminderRuleList({ eventId, rules, fallback, eventDate, eventTime, allDay = false, busy, beginChange, endChange, onChanged }: {
  eventId?: number; rules: ReminderRule[]; fallback: string[]; eventDate: string; eventTime: string; allDay?: boolean;
  busy: boolean; beginChange: () => boolean; endChange: () => void; onChanged: (rules: ReminderRule[]) => void;
}) {
  const [editing, setEditing] = useState<ReminderRule | null>(null);
  const ruleLabel = (offset: number) => allDay && offset === 0 ? '알림 기준 시각' : formatReminderOffset(offset);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  async function change(ruleId: number, offsetMinutes: number | null) {
    if (!eventId || !beginChange()) return;
    setError(null);
    try {
      const response = await fetch(`/api/events/${eventId}/reminders/${ruleId}`, {
        method: offsetMinutes === null ? 'DELETE' : 'PATCH',
        ...(offsetMinutes === null ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ offsetMinutes }) }),
      });
      if (!response.ok) throw new Error(response.status === 409 ? '이미 같은 시점의 알림이 있어요. 다른 시점으로 바꿔 주세요.' : response.status === 404 ? '설정이 바뀌었어요. 새로고침 후 다시 시도해 주세요.' : '알림 설정을 저장하지 못했어요. 다시 시도해 주세요.');
      const result = await response.json() as { reminders: ReminderRule[] };
      onChanged(result.reminders); setEditing(null); setDeleting(null);
    } catch (error) { setError(error instanceof Error ? error.message : '다시 시도해 주세요.'); }
    finally { endChange(); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const offset = Number(form.get('amount')) * Number(form.get('unit'));
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 525600) { setError('시작 시각부터 최대 365일 전까지 설정할 수 있어요.'); return; }
    void change(editing.id, offset);
  }

  return <section className="reminder-rule-editor" aria-label="저장된 알림 시점">
    <div className="editor-heading"><h3>저장된 알림 시점</h3><span>{eventId ? rules.length : fallback.length}개</span></div>
    {eventId && <p className="editor-help">표시된 날짜는 진행 중 또는 다음 회차 시작 기준의 예상 시각이에요. 실제 수신은 이 기기의 알림 설정을 따라요.</p>}
    {!eventId ? <div className="reminder-sample-labels">{fallback.map((label) => <span key={label}>{label}</span>)}</div> : rules.length === 0 ? <div className="editor-empty"><strong>이 일정의 알림이 없어요.</strong><p>자동으로 발송하지 않아요. 아래에서 시점을 추가하거나 위의 프리셋을 선택해 주세요.</p></div> : <div className="reminder-rule-items">{rules.map((rule) => {
      const dueAt = new Date(new Date(`${eventDate}T${eventTime}:00+09:00`).getTime() - rule.offset_minutes * 60_000);
      const past = dueAt.getTime() < now;
      const label = Number.isFinite(dueAt.getTime()) ? new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(dueAt) : '다가오는 회차 없음';
      return <div className="reminder-rule-item" key={rule.id}>
        <div className="reminder-rule-summary"><div><strong>{ruleLabel(rule.offset_minutes)}</strong><span>{label}{past ? ' · 지난 시각' : ''}</span></div><div className="item-actions"><button type="button" disabled={busy} aria-label={`${ruleLabel(rule.offset_minutes)} 알림 수정`} onClick={() => { setEditing(rule); setDeleting(null); setError(null); }}>수정</button><button type="button" disabled={busy} aria-label={`${ruleLabel(rule.offset_minutes)} 알림 삭제`} onClick={() => { setDeleting(rule.id); setEditing(null); setError(null); }}>삭제</button></div></div>
        {deleting === rule.id && <div className="inline-confirm"><span>{rules.length === 1 ? '마지막 알림이에요. 삭제하면 이 일정은 자동으로 알리지 않아요.' : '이 시점의 알림을 삭제할까요?'}</span><div><button type="button" disabled={busy} onClick={() => setDeleting(null)}>취소</button><button type="button" className="danger-text" disabled={busy} onClick={() => change(rule.id, null)}>삭제하기</button></div></div>}
        {editing?.id === rule.id && <form onSubmit={submit} className="inline-editor" key={rule.id} aria-label="알림 시점 수정"><label htmlFor={`edit-reminder-${rule.id}`}>언제 알려드릴까요?</label><div className="reminder-edit-inputs"><input id={`edit-reminder-${rule.id}`} name="amount" type="number" min="0" max="525600" step="1" required defaultValue={offsetInput(rule.offset_minutes).amount} disabled={busy} autoFocus /><select name="unit" aria-label="알림 시간 단위" defaultValue={offsetInput(rule.offset_minutes).unit} disabled={busy}><option value="1">분 전</option><option value="60">시간 전</option><option value="1440">일 전</option></select></div><p className="editor-help">{allDay ? '0이면 시작일의 알림 기준 시각에 알려드려요.' : '0이면 일정 시작 시각에 알려드려요.'}</p><div className="editor-buttons"><button type="button" disabled={busy} onClick={() => { setEditing(null); setError(null); }}>취소</button><button type="submit" disabled={busy} className="primary-button">{busy ? '저장 중…' : '저장'}</button></div></form>}
      </div>;
    })}</div>}
    {error && <p role="alert" className="editor-error">{error}</p>}
    {eventId && <p className="editor-help">변경 사항은 아직 발송하지 않은 알림부터 적용돼요. 이미 전송한 알림은 회수할 수 없어요.</p>}
  </section>;
}
