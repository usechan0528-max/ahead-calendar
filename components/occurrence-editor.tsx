'use client';
import { useRef, useState, type FormEvent } from 'react';
import { EventEditorDialog } from './event-editor-dialog';
import { EventTimeFields } from './event-time-fields';
import { parseEventInput } from '@/lib/event-input';
import { calendarDateLabel } from '@/lib/calendar-view';
import type { OccurrenceChanges } from '@/lib/occurrences';

export function OccurrenceEditor({ originalDate, initial, onSave, onClose, isOffline = false }: {
  originalDate: string; initial: OccurrenceChanges;
  isOffline?: boolean;
  onSave: (changes: OccurrenceChanges) => Promise<void>; onClose: () => void;
}) {
  const [date, setDate] = useState(initial.eventDate);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || isOffline) return;
    if (!navigator.onLine) { setError('인터넷에 다시 연결한 뒤 저장해 주세요.'); return; }
    const form = new FormData(event.currentTarget);
    const eventDate = String(form.get('date') ?? date);
    const allDay = form.has('allDay');
    const endDate = form.has('hasEnd') ? String(form.get('endDate')) : allDay ? eventDate : null;
    const input = parseEventInput({ title: form.get('title'), note: form.get('note'), category: '일정', recurrence: 'none',
      eventDate, eventTime: form.get('time'), allDay, allDayReminderTime: form.get('allDayReminderTime'),
      endDate, endTime: !allDay && endDate ? form.get('endTime') : null });
    if (!input) { setError('제목과 날짜·시간을 확인해 주세요. 종료는 시작보다 뒤여야 해요.'); return; }
    busyRef.current = true; setBusy(true); setError(null);
    try { await onSave(input); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '저장하지 못했어요.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <EventEditorDialog title="이번 회차 수정" isSaving={busy} isOffline={isOffline} error={error} onSubmit={submit} onClose={onClose}
    footer={<button type="submit" disabled={busy || isOffline} className="primary-button w-full">{busy ? '저장 중…' : isOffline ? '인터넷 연결 후 저장' : '이번 회차만 저장'}</button>}>
    <p className="editor-help">원래 {calendarDateLabel(originalDate)} 회차만 바꿔요. 다른 회차와 반복 규칙은 그대로 유지돼요.</p>
    <label className="occurrence-field">일정 제목<input name="title" autoFocus required maxLength={100} defaultValue={initial.title} /></label>
    <EventTimeFields date={date} onDateChange={setDate} initial={initial} />
    <label className="occurrence-field">메모<textarea name="note" rows={3} maxLength={500} defaultValue={initial.note} /></label>
    <p className="editor-help">장소·이동 경로·준비 항목·알림 간격은 전체 일정의 설정을 사용해요. 알림 시각은 변경한 날짜와 시간을 기준으로 다시 계산해요.</p>
  </EventEditorDialog>;
}
