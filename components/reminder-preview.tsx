'use client';
import { useEffect, useRef, useState } from 'react';
import { previewReminders, reminderDateLabel } from '@/lib/reminder-preview';
import type { EventDuration } from '@/lib/event-duration';
import { parseInitialReminderChoice } from '@/lib/reminder-settings';

export function ReminderPreview({ onSuggestion }: { onSuggestion: (offset: number) => void }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<ReturnType<typeof previewReminders>>(null);
  const [enabled, setEnabled] = useState(false);
  const [recurring, setRecurring] = useState(false);
  useEffect(() => {
    const form = anchor.current?.closest('form'); if (!form) return;
    let frame = 0;
    const read = () => {
      const data = new FormData(form);
      let choice; try { choice = parseInitialReminderChoice(JSON.parse(String(data.get('initialReminderChoice')))); } catch { choice = null; }
      setEnabled(!!choice?.offsets.length);
      const recurrence = String(data.get('recurrence') ?? 'none') as EventDuration['recurrence'];
      setRecurring(recurrence !== 'none');
      setPreview(choice ? previewReminders({ eventDate: String(data.get('date') ?? ''), eventTime: String(data.get('time') ?? ''),
        allDay: data.has('allDay'), allDayReminderTime: String(data.get('allDayReminderTime') ?? '09:00'),
        endDate: data.has('hasEnd') ? String(data.get('endDate') ?? '') : null,
        endTime: data.has('hasEnd') && !data.has('allDay') ? String(data.get('endTime') ?? '') : null,
        recurrence, recurrenceInterval: Number(data.get('recurrenceInterval') ?? 1),
        recurrenceDay: data.has('recurrenceDay') ? Number(data.get('recurrenceDay')) : null,
        recurrenceUntil: String(data.get('recurrenceUntil') ?? '') || null }, choice.offsets, Date.now()) : null);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(read); };
    schedule();
    form.addEventListener('input', schedule); form.addEventListener('change', schedule); form.addEventListener('click', schedule);
    const observer = new MutationObserver(schedule); observer.observe(form, { subtree: true, attributes: true, attributeFilter: ['value', 'checked'] });
    const timer = window.setInterval(read, 30_000);
    return () => { cancelAnimationFrame(frame); window.clearInterval(timer); observer.disconnect(); form.removeEventListener('input', schedule); form.removeEventListener('change', schedule); form.removeEventListener('click', schedule); };
  }, []);
  return <div ref={anchor}>{enabled && preview && <div className={`reminder-preview ${preview.upcoming.length ? '' : 'is-warning'}`} aria-live="polite">
    <strong>{preview.upcoming.length ? `이번 ${recurring ? '회차' : '일정'}에 남은 알림 ${preview.upcoming.length}개` : `이번 ${recurring ? '회차' : '일정'}에 남은 알림이 없어요`}</strong>
    {preview.upcoming[0] ? <p>다음 알림 시점 · {reminderDateLabel(preview.upcoming[0].at)}</p> : <p>{preview.date ? '설정한 알림 시각이 모두 지났어요.' : '반복 종료일까지 남은 회차가 없어요.'}</p>}
    {!preview.upcoming.length && preview.suggestion !== null && <button type="button" className="text-button" onClick={() => onSuggestion(preview.suggestion!)}>{preview.suggestion ? '10분 전 알림으로 변경' : '시작 시각 알림으로 변경'}</button>}
    <details><summary>알림 시점 안내</summary><p>설정 기준의 예상 시각이에요. 수신 설정과 연결 상태에 따라 실제 도착이 달라질 수 있어요.{preview.past > 0 ? ` 이번 일정에서 이미 지난 ${preview.past}개 시점은 보내지 않아요.` : ''}{recurring ? ' 알림 시점을 바꾸면 이후 회차에도 적용돼요.' : ''}</p></details>
  </div>}</div>;
}
