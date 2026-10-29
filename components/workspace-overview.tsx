'use client';

import { useState } from 'react';
import { AppIcon, type CalendarSchedule } from './calendar-workspace';
import { getSeoulDate } from '@/lib/recurrence';
import { daysBetween, formatEventRange, occurrenceDayStatus } from '@/lib/event-duration';
import { relevantResolvedOccurrence } from '@/lib/occurrences';
import { partitionTodaySchedules } from '@/lib/today-schedule';
import { occurrenceCheckKey, useOverviewChecks } from './use-overview-checks';

export type WorkspaceView = 'today' | 'calendar' | 'preparations' | 'notifications';
export const workspaceNavigation = [
  { id: 'today', label: '오늘', short: '오늘', icon: 'sun', description: '지금 할 일부터, 하나씩 실천해요.' },
  { id: 'calendar', label: '내 캘린더', short: '캘린더', icon: 'calendar', description: '기억하고 싶은 날, 여유롭게 준비하세요.' },
  { id: 'preparations', label: '준비 목록', short: '준비', icon: 'check', description: '일정마다 필요한 준비를 한곳에서 살펴봐요.' },
  { id: 'notifications', label: '알림', short: '알림', icon: 'bell', description: '중요한 순간을 놓치지 않도록, 미리 알려드려요.' },
] as const;

type OverviewSchedule = CalendarSchedule & { preparationsEnabled?: boolean; preparations: { id?: number; label: string; meta: string }[] };
type Row = { item: OverviewSchedule; date: string; originalDate: string; status: ReturnType<typeof occurrenceDayStatus> };
export function overviewRows(schedules: OverviewSchedule[], now: number, completedEvents: Array<{ eventId: number; date: string }> = []): Row[] {
  const today = getSeoulDate(new Date(now));
  const excluded = new Map<number, Set<string>>();
  for (const entry of completedEvents) {
    if (!excluded.has(entry.eventId)) excluded.set(entry.eventId, new Set());
    excluded.get(entry.eventId)!.add(entry.date);
  }
  return schedules.flatMap<Row>((item) => {
    const row = relevantResolvedOccurrence(item, today, new Date(now), item.storageId ? excluded.get(item.storageId) : undefined);
    return row ? [{ item: row.event, date: row.start, originalDate: row.originalDate, status: occurrenceDayStatus(row.event, row.start, today, new Date(now)) }] : [];
  }).sort((a, b) => Number(a.status === 'past') - Number(b.status === 'past') || a.date.localeCompare(b.date) || a.item.eventTime.localeCompare(b.item.eventTime));
}

/** Read-only continuation; original dates identify moved and overlapping repeats. */
export function nextActionRow(schedules: OverviewSchedule[], now: number, completedEvents: Array<{ eventId: number; date: string }>, current: { eventId: number; date: string }): Row | null {
  const rows = overviewRows(schedules.filter((item) => !item.isSample), now, [...completedEvents, current]).filter((row) => row.status !== 'past');
  return rows.find((row) => row.status === 'ongoing') ?? rows[0] ?? null;
}

function DayBadge({ row, today }: { row: Row; today: string }) {
  const days = daysBetween(today, row.date);
  return <span className="overview-dday">{row.status === 'ongoing' ? '진행 중' : row.status === 'past' ? '지난 일정' : days === 0 ? '오늘' : `D-${days}`}</span>;
}

export function UpcomingStrip({ schedules, now, onSelect, completedEvents = [] }: { schedules: OverviewSchedule[]; now: number; onSelect: (id: number, date: string) => void; completedEvents?: Array<{ eventId: number; date: string }> }) {
  const rows = overviewRows(schedules, now, completedEvents).filter((row) => row.status !== 'past').slice(0, 3);
  if (!rows.length) return null;
  return <section className="upcoming-strip" aria-label="다가오는 일정">
    <div className="section-heading"><h2>다가오는 일정</h2><span>진행 중 · 다음 회차</span></div>
    <div className="upcoming-grid">{rows.map((row) => <button type="button" key={row.item.id} className="upcoming-card" onClick={() => onSelect(row.item.id, row.originalDate)}>
      <span className="upcoming-card-top"><span className="detail-category" style={{ color: row.item.text ?? row.item.accent, background: row.item.soft, borderLeft: `3px solid ${row.item.accent}` }}>{row.item.category}</span><DayBadge row={row} today={getSeoulDate(new Date(now))} /></span>
      <strong>{row.item.title}</strong><span>{formatEventRange(row.item, row.date)}</span>{row.item.isSample && <small>예시 일정</small>}
    </button>)}</div>
  </section>;
}

export function PreparationBand({ schedules, now, onSelect, completedEvents = [] }: { schedules: OverviewSchedule[]; now: number; onSelect: (id: number, date: string) => void; completedEvents?: Array<{ eventId: number; date: string }> }) {
  const row = overviewRows(schedules, now, completedEvents).find((entry) => entry.status !== 'past' && entry.item.preparationsEnabled !== false);
  if (!row) return null;
  return <div className="preparation-band"><span className="band-icon"><AppIcon name="mail" size={24} /></span><div><strong>{row.item.title}, 미리 준비해 볼까요?</strong><p>{row.item.isSample ? '예시 일정 · ' : ''}{row.item.preparations.length ? `준비 항목 ${row.item.preparations.length}개를 확인해 보세요.` : '필요한 준비를 하나씩 더해 보세요.'}</p></div><button type="button" onClick={() => onSelect(row.item.id, row.originalDate)}>준비 보기<AppIcon name="arrow" size={17} /></button></div>;
}

export function WorkspaceOverview({ view, schedules, now, selectedId, onSelect, onPrepare, onCreate, deviceLoaded, deviceEnabled, onDeviceSettings, completedEvents, hideDeviceCard = false, accountScope = '', completionVersion = 0, onCompletionChanged, onSchedulesReload, offline = false }: {
  view: Exclude<WorkspaceView, 'calendar'>; schedules: OverviewSchedule[]; now: number; selectedId: number;
  onSelect: (id: number, date: string) => void; onCreate: () => void;
  onPrepare?: (id: number, date: string) => void;
  deviceLoaded: boolean; deviceEnabled: boolean; onDeviceSettings: () => void;
  hideDeviceCard?: boolean;
  completedEvents: Array<{ eventId: number; date: string }>;
  accountScope?: string; completionVersion?: number; onCompletionChanged?: () => void; onSchedulesReload?: () => void; offline?: boolean;
}) {
  const [remainingOnly, setRemainingOnly] = useState(false);
  const today = getSeoulDate(new Date(now));
  const rows = overviewRows(schedules, now);
  const todayGroups = view === 'today' ? partitionTodaySchedules(schedules, completedEvents, now) : { remaining: [], completed: [] };
  const statusOrder = (status: Row['status']) => status === 'ongoing' ? 0 : status === 'past' ? 2 : 1;
  const visible = view === 'today' ? [...todayGroups.remaining].sort((a, b) => statusOrder(a.status) - statusOrder(b.status)) : view === 'preparations' ? rows.filter((row) => row.item.preparationsEnabled !== false) : rows;
  const nextRows = view === 'today' ? overviewRows(schedules, now, completedEvents).filter((row) => row.status !== 'past') : [];
  const focus = nextRows.find((row) => row.status === 'ongoing') ?? nextRows[0];
  const preparationRows = nextRows.filter((row) => row.item.preparationsEnabled !== false && row.item.preparations.length > 0).slice(0, 2);
  const openPreparations = onPrepare ?? onSelect;
  const checkRows = view === 'notifications' ? [] : [...visible, ...todayGroups.completed];
  const checks = useOverviewChecks(checkRows.filter(row => !!row.item.storageId).map(row => ({ eventId: row.item.storageId!, date: row.originalDate, revision: row.item.revision ?? 0 })), accountScope, Math.floor(now / 60_000), completionVersion, onCompletionChanged);
  function quickEvent(row: Row) {
    if (!row.item.storageId) return null;
    const state = checks.values[occurrenceCheckKey(row.item.storageId, row.originalDate)];
    return <button type="button" id={`quick-event-${row.item.storageId}-${row.originalDate}`} className={`overview-quick-check ${state?.complete ? 'is-complete' : ''}`}
      aria-label={`${row.item.title} ${row.date} 회차 ${state?.complete ? '완료 해제' : '완료하기'}`} aria-pressed={state?.complete ?? false}
      disabled={offline || checks.busy || checks.loading || !state || (!state.complete && !state.canCompleteEvent)}
      onClick={() => void checks.toggle(row.item.storageId!, row.originalDate, 'event', 0, !state?.complete)}>
      <AppIcon name="check" size={17} />{state?.complete ? '완료 해제' : state && !state.canCompleteEvent ? '시작 전' : '완료하기'}
    </button>;
  }
  return <section className="overview-content" aria-label={workspaceNavigation.find((item) => item.id === view)?.label}>
    {view === 'today' && focus && <section className="today-focus" aria-labelledby="today-focus-title">
      <div className="today-focus-heading"><h2 id="today-focus-title">{focus.status === 'ongoing' ? '지금 할 일정' : '다음 일정'}</h2><DayBadge row={focus} today={today} /></div>
      <strong>{focus.item.title}</strong><p>{formatEventRange(focus.item, focus.date)}</p>
      {focus.item.location && <p>{focus.item.location}</p>}
      <button type="button" className="primary-button" onClick={() => onSelect(focus.item.id, focus.originalDate)}>일정 확인하기<AppIcon name="arrow" size={17} /></button>
    </section>}
    {view === 'notifications' && !hideDeviceCard && <div className="device-settings-card"><span className="band-icon"><AppIcon name="bell" size={24} /></span><div><h2>이 기기의 알림</h2><p>{!deviceLoaded ? '연결 상태를 확인하고 있어요.' : deviceEnabled ? '저장한 알림을 이 기기로 받아요.' : '이 기기의 일정 알림이 꺼져 있어요.'}</p></div><button type="button" className="text-button" onClick={onDeviceSettings}>설정 보기<AppIcon name="right" size={16} /></button></div>}
    <div className="section-heading"><h2>{view === 'today' ? '오늘 남은 일정' : view === 'preparations' ? '일정별 준비' : '일정별 알림 설정'}</h2><span aria-live="polite">{visible.length}개{view === 'today' ? ' · 진행 중 포함' : ''}</span></div>
    {view !== 'notifications' && <div className="overview-check-status" aria-live="polite">{checks.notice && <p>{checks.notice}</p>}{checks.error && <p role="alert">{checks.error} <button type="button" className="text-button" disabled={offline || checks.busy} onClick={checks.retry}>다시 확인</button></p>}</div>}
    {checks.stale && <p className="overview-help" role="status">다른 곳에서 변경된 일정이 있어요. <button type="button" className="text-button" disabled={offline || checks.busy} onClick={onSchedulesReload}>최신 일정 불러오기</button></p>}
    {view === 'preparations' && <div className="overview-preparation-filter"><label><input type="checkbox" checked={remainingOnly} onChange={event => setRemainingOnly(event.target.checked)} />남은 준비만 보기</label><span>표시된 날짜의 회차에 기록돼요.</span></div>}
    {view === 'notifications' && <p className="overview-help">아래 숫자는 저장한 알림 시점의 수예요. 실제 발송 여부와 다음 예약은 각 일정에서 확인해 주세요.</p>}
    {!visible.length ? <div className="overview-empty"><AppIcon name="sun" size={32} /><h3>{view === 'preparations' ? '표시할 준비 항목이 없어요' : view === 'notifications' ? '등록된 일정이 없어요' : todayGroups.completed.length ? '오늘 일정은 모두 완료했어요' : '오늘 등록된 일정이 없어요'}</h3><p>{view === 'preparations' ? '필요할 때 캘린더에서 일정을 열어 ‘준비 항목 사용’을 켤 수 있어요.' : view === 'today' && todayGroups.completed.length ? '실천한 기록은 아래에서 다시 확인할 수 있어요.' : '새로운 계획을 하나 담아 보세요.'}</p>{view !== 'preparations' && <button type="button" className="text-button" onClick={onCreate}><AppIcon name="plus" size={17} />일정 추가</button>}</div> : <div className="overview-list">{visible.map((row) => {
      const done = completedEvents.some((entry) => entry.eventId === row.item.storageId && entry.date === row.originalDate);
      return <article key={`${row.item.id}:${row.originalDate}`} className={`overview-event ${row.item.id === selectedId ? 'is-selected' : ''}`}>
        <button type="button" className="overview-event-open" onClick={() => (view === 'preparations' ? openPreparations : onSelect)(row.item.id, row.originalDate)}>
          <span className="overview-date"><small>{Number(row.date.slice(5, 7))}월</small><strong>{Number(row.date.slice(8))}</strong></span>
          <span className="overview-event-info"><span className="overview-category" style={{ color: row.item.text ?? row.item.accent, borderLeft: `3px solid ${row.item.accent}`, paddingLeft: 6 }}>{row.item.category}{row.item.isSample ? ' · 예시' : ''}</span><strong>{row.item.title}{done && <span className="completion-badge">완료</span>}</strong><span>{formatEventRange(row.item, row.date)}</span>{view === 'today' && row.item.location && <span>{row.item.location}</span>}</span>
          {view === 'today' && row.status === 'past' ? <span className="overview-dday">시간 지남</span> : <DayBadge row={row} today={today} />}<AppIcon name="right" size={18} />
        </button>
        {view === 'today' && quickEvent(row)}
        {view === 'preparations' && (() => {
          const state = row.item.storageId ? checks.values[occurrenceCheckKey(row.item.storageId, row.originalDate)] : undefined;
          const completeIds = state?.completedPreparationIds ?? [];
          const pending = row.item.preparations.filter(prep => !prep.id || !completeIds.includes(prep.id));
          const shown = remainingOnly ? pending : row.item.preparations;
          return <div className="overview-preparations">
            {!!row.item.preparations.length && <p className="overview-preparation-count">{state ? `${row.item.preparations.length - pending.length}/${row.item.preparations.length} 완료` : checks.loading ? '완료 상태 확인 중…' : '상세에서 완료 상태를 확인해 주세요.'}</p>}
            {shown.map((prep, index) => <label className={`overview-prep-check ${prep.id && completeIds.includes(prep.id) ? 'is-complete' : ''}`} key={prep.id ?? index}>
              <input type="checkbox" checked={!!prep.id && completeIds.includes(prep.id)} disabled={offline || checks.busy || checks.loading || !state || !prep.id || (!completeIds.includes(prep.id) && !state.canCompletePreparation)}
                aria-label={`${row.item.title} ${row.date} 회차 ${prep.label}`}
                onChange={event => void checks.toggle(row.item.storageId!, row.originalDate, 'preparation', prep.id!, event.target.checked)} />
              <span>{prep.label}<small>{prep.meta}</small></span>
            </label>)}
            {!!row.item.preparations.length && !shown.length && <p className="overview-help">이 회차의 준비를 모두 마쳤어요.</p>}
            {!row.item.preparations.length && <button type="button" onClick={() => openPreparations(row.item.id, row.originalDate)}><AppIcon name="plus" size={17} />준비 항목 추가하기</button>}
          </div>;
        })()}
        {view === 'notifications' && <button type="button" className="overview-reminders" onClick={() => onSelect(row.item.id, row.originalDate)}><AppIcon name="bell" size={17} /><span>{row.item.reminders.length ? row.item.reminders.join(' · ') : '저장된 알림 없음'}</span><b>{row.item.reminders.length}개</b></button>}
      </article>;
    })}</div>}
    {view === 'today' && preparationRows.length > 0 && <section className="today-preparations" aria-label="다가오는 일정의 준비">
      <div className="section-heading"><h2>미리 챙길 준비</h2><span>내가 담은 항목</span></div>
      <p className="overview-help">준비 시점은 메모예요. 실제 알림은 일정의 ‘알림’에서 따로 설정해요.</p>
      {preparationRows.map((row) => <button type="button" key={`${row.item.id}:${row.originalDate}`} className="today-preparation-row" onClick={() => openPreparations(row.item.id, row.originalDate)}>
        <AppIcon name="list" size={20} /><span><strong>{row.item.title}</strong><small>{row.item.preparations.slice(0, 2).map((item) => item.label).join(' · ')}</small></span><span>준비 {row.item.preparations.length}개</span><AppIcon name="right" size={17} />
      </button>)}
    </section>}
    {view === 'today' && todayGroups.completed.length > 0 && <section className="today-completed" aria-label="오늘 일정 중 완료">
      <div className="section-heading"><h2>오늘 일정 중 완료</h2><span aria-live="polite">{todayGroups.completed.length}개</span></div>
      <div className="overview-list">{todayGroups.completed.map((row) => <article key={`${row.item.id}:${row.originalDate}`} className="overview-event">
        <button type="button" className="overview-event-open" onClick={() => onSelect(row.item.id, row.originalDate)}>
          <AppIcon name="check" size={22} />
          <span className="overview-event-info"><strong>{row.item.title}<span className="completion-badge">완료</span></strong><span>{formatEventRange(row.item, row.date)}</span></span>
          <AppIcon name="right" size={18} />
        </button>
        {quickEvent(row)}
      </article>)}</div>
    </section>}
  </section>;
}
