'use client';
import { useState } from 'react';
import { SNOOZE_MINUTES, type SnoozeMinutes } from '@/lib/user-journey';
export function SnoozeControls({disabled,onSnooze}: {disabled: boolean; onSnooze:(minutes:SnoozeMinutes)=>void}) {
  const [minutes,setMinutes] = useState<SnoozeMinutes>(10);
  return <div className="snooze-controls"><label>다시 알릴 시간<select aria-label="다시 알릴 시간" value={minutes} disabled={disabled} onChange={event=>setMinutes(Number(event.target.value) as SnoozeMinutes)}>{SNOOZE_MINUTES.map(value=><option key={value} value={value}>{value}분 뒤</option>)}</select></label><button type="button" className="text-button" disabled={disabled} onClick={()=>onSnooze(minutes)}>알림만 미루기</button><small>일정 날짜·시간과 준비 기한은 바뀌지 않아요.</small></div>;
}
