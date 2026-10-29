'use client';

import { useState } from 'react';
import { daysBetween, shiftEventDate } from '@/lib/event-duration';
import { isValidEventDate } from '@/lib/recurrence';
import { shiftEndWithStart } from '@/lib/editor-time';

type InitialTime = { eventTime?: string; allDay?: boolean; allDayReminderTime?: string; endDate?: string | null; endTime?: string | null; hasEnd?: boolean };

export function EventTimeFields({ date, onDateChange, initial }: { date: string; onDateChange: (value: string) => void; initial?: InitialTime }) {
  const [allDay, setAllDay] = useState(initial?.allDay ?? false);
  const [time, setTime] = useState(initial?.eventTime ?? '09:00');
  const [hasEnd, setHasEnd] = useState(initial?.hasEnd ?? (!!initial?.endDate && (!initial.allDay || initial.endDate !== date)));
  const [endDate, setEndDate] = useState(initial?.endDate ?? date);
  const [endTime, setEndTime] = useState(initial?.endTime ?? '10:00');
  const [alarmTime, setAlarmTime] = useState(initial?.allDayReminderTime ?? '09:00');
  const [timeNotice, setTimeNotice] = useState('');

  function changeTime(next: string) {
    if (next === time) return;
    const shifted = hasEnd && !allDay ? shiftEndWithStart(date, time, next, endDate, endTime) : null;
    if (shifted) { setEndDate(shifted.endDate); setEndTime(shifted.endTime); setTimeNotice('일정 길이를 유지해 종료 시각도 옮겼어요.'); }
    else setTimeNotice(hasEnd ? '종료 날짜와 시간을 확인해 주세요.' : '');
    setTime(next);
  }

  function changeDate(next: string) {
    if (hasEnd && isValidEventDate(date) && isValidEventDate(next) && isValidEventDate(endDate)) {
      setEndDate(shiftEventDate(endDate, daysBetween(date, next)) ?? next);
    }
    onDateChange(next);
  }

  function toggleEnd(next: boolean) {
    if (next) {
      const hour = Number(time.slice(0, 2)) + 1;
      setEndDate(!allDay && hour >= 24 ? shiftEventDate(date, 1) ?? date : date);
      setEndTime(`${String(hour % 24).padStart(2, '0')}:${time.slice(3)}`);
    }
    setHasEnd(next);
  }

  return <section className="event-time-fields" aria-label="일정 날짜와 시간">
    <label className="event-flag"><input type="checkbox" name="allDay" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} /><span>종일 일정</span><small>시간 없이 날짜만 기록</small></label>
    <div className={`date-time-grid ${allDay ? 'is-all-day' : ''}`}>
      <label>시작 날짜<input name="date" type="date" min="1900-01-01" max="9999-12-31" value={date} onInput={(event) => changeDate(event.currentTarget.value)} onChange={(event) => changeDate(event.target.value)} required /></label>
      {!allDay && <label>시작 시간<input name="time" type="time" value={time} onChange={(event) => changeTime(event.target.value)} required /></label>}
    </div>
    {allDay && <input type="hidden" name="time" value={time} />}
    <label className="event-flag end-flag"><input type="checkbox" name="hasEnd" checked={hasEnd} onChange={(event) => toggleEnd(event.target.checked)} /><span>{allDay ? '여러 날에 걸친 일정' : '종료 날짜·시간 지정'}</span></label>
    {hasEnd && <div className={`date-time-grid ${allDay ? 'is-all-day' : ''}`}>
      <label>종료 날짜<input name="endDate" type="date" min={date || '1900-01-01'} max={isValidEventDate(date) ? shiftEventDate(date, 366) ?? '9999-12-31' : '9999-12-31'} value={endDate} onInput={(event) => setEndDate(event.currentTarget.value)} onChange={(event) => setEndDate(event.target.value)} required /></label>
      {!allDay && <label>종료 시간<input name="endTime" type="time" value={endTime} onInput={(event) => setEndTime(event.currentTarget.value)} onChange={(event) => setEndTime(event.target.value)} required /></label>}
    </div>}
    {hasEnd && timeNotice && <p className="editor-help" role="status">{timeNotice}</p>}
    {allDay ? <div className="all-day-reminder"><label>알림 기준 시간<input type="time" name="allDayReminderTime" value={alarmTime} onInput={(event) => setAlarmTime(event.currentTarget.value)} onChange={(event) => setAlarmTime(event.target.value)} required /></label><p>시작일의 이 시각을 기준으로 ‘1일 전’, ‘2시간 전’ 등의 알림을 계산해요. 여러 날 일정도 매일 반복 발송하지 않아요.</p></div> : <input type="hidden" name="allDayReminderTime" value={alarmTime} />}
    {hasEnd && <p className="editor-help">{allDay ? '종료 날짜까지 포함해 표시해요.' : '종료 시각까지 이어지는 일정이에요. 자정에 끝나면 다음 날짜에는 표시하지 않아요.'} 시작일과 종료일의 간격은 최대 366일이에요.</p>}
  </section>;
}
