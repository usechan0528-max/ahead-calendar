'use client';

import { useState } from 'react';
import type { CalendarSchedule } from './calendar-workspace';
import type { ProgressSummary } from '@/lib/progression';
import { getSeoulDate } from '@/lib/recurrence';
import { formatEventRange } from '@/lib/event-duration';
import { partitionTodaySchedules } from '@/lib/today-schedule';
import { recentUnfinished, tomorrowOccurrences } from '@/lib/user-journey';

type ReviewSchedule = CalendarSchedule & { preparationsEnabled?: boolean; preparations: {label: string}[] };
export function DailyReview({schedules, progress, error, now, onSelect, onRecover, onRetry}: {
  schedules: ReviewSchedule[]; progress: ProgressSummary | null; error: string | null; now: number;
  onSelect: (id: number, date: string, prepare?: boolean) => void; onRecover: (id: number, date: string) => void; onRetry: () => void;
}) {
  const [limit, setLimit] = useState(5);
  const today = getSeoulDate(new Date(now));
  const ready = progress?.day === today && !error;
  const missed = ready ? recentUnfinished(schedules, progress.completedEvents, now) : [];
  const groups = ready ? partitionTodaySchedules(schedules, progress.completedEvents, now) : null;
  const tomorrow = tomorrowOccurrences(schedules, now);
  return <section className="daily-review" aria-label="지난 일정과 하루 정리">
    <details><summary><strong>지난 일정 확인</strong><span>{ready ? `${missed.length}개 · 최근 7일` : '기록 확인'}</span></summary>
      {!ready ? <p role="status">{error ?? '완료 기록을 확인한 뒤 보여드릴게요.'}<button type="button" className="text-button" onClick={onRetry}>다시 확인</button></p> : <>
        <p>최근 7일에 끝난 일정 중 완료 기록이 없는 회차예요. 하나씩 확인하고, 그대로 두어도 괜찮아요.</p>
        {missed.length === 0 ? <p>이 기간에 확인할 지난 일정이 없어요.</p> : <ul className="journey-row-list">{missed.slice(0,limit).map((row) => <li key={`${row.master.id}:${row.originalDate}`}><div><strong>{row.event.title}</strong><span>{formatEventRange(row.event,row.start)}</span></div><button type="button" className="text-button" onClick={() => onRecover(row.master.id,row.originalDate)}>일정 정리하기</button></li>)}</ul>}
        {missed.length > limit && <button type="button" className="text-button" onClick={() => setLimit(value=>value+5)}>5개 더 보기</button>}
      </>}
    </details>
    <details><summary><strong>하루 정리 · 내일 미리 보기</strong><span>필요할 때만</span></summary>
      {!ready || !groups ? <p role="status">{error ?? '오늘 기록을 확인하고 있어요.'}<button type="button" className="text-button" onClick={onRetry}>다시 확인</button></p> : <>
        <div className="daily-review-counts"><p><strong>{groups.completed.length}</strong>오늘 일정 중 완료</p><p><strong>{groups.remaining.length}</strong>오늘 남은 일정</p><p><strong>{progress.todayXp} XP</strong>오늘 얻은 경험치</p></div>
        <p>지난 계획을 오늘 완료한 경험치도 포함돼요. 남은 일정을 자동으로 옮기지는 않아요.</p>
        {groups.remaining.length > 0 && <ul className="journey-row-list">{groups.remaining.map(row=><li key={`${row.item.id}:${row.originalDate}`}><div><strong>{row.item.title}</strong><span>{formatEventRange(row.item,row.date)}</span></div><button type="button" className="text-button" onClick={()=>onRecover(row.item.id,row.originalDate)}>확인하고 정리</button></li>)}</ul>}
      </>}
      <h3>내일 일정 · 진행 중인 일정 포함</h3>
      {!tomorrow.length ? <p>내일 등록된 일정은 없어요.</p> : <ul className="journey-row-list">{tomorrow.map(row=><li key={`${row.event.id}:${row.originalDate}`}><div><strong>{row.event.title}</strong><span>{formatEventRange(row.event,row.start)}</span>{row.event.preparationsEnabled !== false && row.event.preparations.length > 0 && <small>담은 준비 {row.event.preparations.length}개 · 완료 여부는 상세에서 확인</small>}</div><div><button type="button" className="text-button" onClick={()=>onSelect(row.event.id,row.originalDate)}>일정 보기</button>{row.event.preparationsEnabled !== false && <button type="button" className="text-button" onClick={()=>onSelect(row.event.id,row.originalDate,true)}>준비 보기</button>}</div></li>)}</ul>}
    </details>
  </section>;
}
