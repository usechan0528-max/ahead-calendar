'use client';
import { formatEventRange } from '@/lib/event-duration';
import { resolveResume, type ResumeBookmark } from '@/lib/user-journey';
import type { CalendarSchedule } from './calendar-workspace';

export function ResumeCard({bookmark,schedules,completed,onResume,onDismiss}: {
  bookmark: ResumeBookmark; schedules: CalendarSchedule[]; completed: Array<{eventId:number;date:string}>;
  onResume: (id: number,date: string,section: ResumeBookmark['section'])=>void; onDismiss:()=>void;
}) {
  const row = resolveResume(bookmark,schedules);
  // Never show data from an unowned/deleted event, even if local storage was modified.
  if (!row) return <section className="resume-card"><h2>오늘부터 이어가 볼까요?</h2><p>이 기기에 기억한 일정이 변경되었거나 더 이상 열 수 없어요.</p><button type="button" className="text-button" onClick={onDismiss}>기억 지우고 오늘 보기</button></section>;
  const done = completed.some(item=>item.eventId===bookmark.eventId&&item.date===bookmark.originalDate);
  return <section className="resume-card" aria-label="이 기기에서 이어보기"><h2>{done ? '지난번 보던 일정은 완료했어요' : '지난번 보던 일정을 이어볼까요?'}</h2><strong>{row.event.title}</strong><p>{formatEventRange(row.event,row.start)}</p><div><button type="button" className="primary-button" onClick={()=>onResume(row.id,row.originalDate,row.section)}>{done ? '완료 기록 보기' : '이어서 보기'}</button><button type="button" className="text-button" onClick={onDismiss}>기억 지우고 오늘 보기</button></div><small>이 브라우저에만 마지막 열람 위치를 기억해요. 일정 내용이나 완료 상태를 저장하지 않아요.</small></section>;
}
