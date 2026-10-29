'use client';

import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { getSeoulDate, isValidEventDate } from '@/lib/recurrence';
import { formatEventRange, occurrenceDayStatus } from '@/lib/event-duration';
import { resolvedOccurrencesInRange, relevantResolvedOccurrence, type OccurrenceOverride } from '@/lib/occurrences';
import type { RecurrenceRule } from '@/lib/recurrence';
import { calendarDateLabel, getMonthDays, shiftCalendarMonth } from '@/lib/calendar-view';
import { getCategoryTheme } from '@/lib/design-tokens';
import { eventCategoryOptions } from '@/lib/event-category';
import { CategoryColorSettings, type ColorSettings } from '@/components/category-color-settings';
import { BulkEventManager } from '@/components/bulk-event-manager';

export type CalendarSchedule = RecurrenceRule & {
  id: number; storageId?: number; title: string; eventTime: string; time: string;
  allDay?: boolean; allDayReminderTime?: string; endDate?: string | null; endTime?: string | null;
  category: string;
  accent: string; soft: string; text?: string; isSample?: boolean; location?: string; reminders: string[];
  occurrenceOverrides?: OccurrenceOverride[];
  revision?: number;
};

export function AppIcon({ name, size = 20 }: { name: 'calendar' | 'list' | 'search' | 'bell' | 'plus' | 'left' | 'right' | 'check' | 'arrow' | 'sun' | 'leaf' | 'mail' | 'person'; size?: number }) {
  const paths = {
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18M7 15h2m6 0h2m-10 3h2" /></>,
    list: <><path d="M9 6h12M9 12h12M9 18h12" /><path d="M3 6h.01M3 12h.01M3 18h.01" strokeWidth="3" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    left: <path d="m14 6-6 6 6 6" />,
    right: <path d="m10 6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
    leaf: <><path d="M20 3C9 1 2 8 5 15c3 6 16 5 15-12ZM5 21c1-6 5-10 10-13" /></>,
    mail: <><rect x="2" y="5" width="20" height="15" rx="2" /><path d="m2 6 10 8L22 6" /></>,
    person: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function CalendarWorkspace({ schedules, selectedId, selectedDate, reveal, now, isSampleMode, onSelect, onCreate, completedEvents = [], colorSettings, isOffline = false, onBulkChanged }: {
  schedules: CalendarSchedule[];
  selectedId: number;
  selectedDate: string;
  reveal?: { date: string } | null;
  now: number;
  isSampleMode: boolean;
  onSelect: (id: number, date: string) => void;
  onCreate: (date?: string) => void;
  completedEvents?: Array<{ eventId: number; date: string }>;
  colorSettings?: ColorSettings;
  isOffline?: boolean;
  onBulkChanged?: () => void;
}) {
  const [bulkOpen, setBulkOpen] = useState(false);
  const today = getSeoulDate(new Date(now));
  const isComplete = (item: CalendarSchedule, date: string) => completedEvents.some((entry) => entry.eventId === item.storageId && entry.date === date);
  const initialDate = reveal && isValidEventDate(reveal.date) ? reveal.date : today;
  const [month, setMonth] = useState(() => initialDate.slice(0, 7));
  const [day, setDay] = useState(initialDate);
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [category, setCategory] = useState<string | null>(null);
  const categories = useMemo(() => eventCategoryOptions(schedules.map(item => item.category)), [schedules]);
  const activeCategory = category !== null && categories.includes(category) ? category : null;
  const [query, setQuery] = useState('');
  const days = useMemo(() => getMonthDays(month), [month]);
  const filtered = useMemo(() => schedules.filter((item) =>
    (activeCategory === null || item.category === activeCategory) &&
    `${item.title} ${item.category} ${item.location ?? ''} ${(item.occurrenceOverrides ?? []).filter((o) => !o.cancelled).map((o) => o.changes?.title ?? '').join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  ), [activeCategory, query, schedules]);
  const byDate = useMemo(() => {
    const map = new Map(days.map((date) => [date, [] as Array<{ item: CalendarSchedule; start: string; originalDate: string }> ]));
    const validDays = days.filter(isValidEventDate);
    for (const item of filtered) {
      for (const occurrence of resolvedOccurrencesInRange(item, validDays[0], validDays[validDays.length - 1])) {
        for (const date of validDays) {
          if (occurrence.start <= date && date <= occurrence.lastCovered) map.get(date)!.push({ item: occurrence.event, start: occurrence.start, originalDate: occurrence.originalDate });
        }
      }
    }
    for (const entries of map.values()) entries.sort((a, b) => Number(!!b.item.allDay) - Number(!!a.item.allDay) || a.start.localeCompare(b.start) || a.item.eventTime.localeCompare(b.item.eventTime) || a.item.id - b.item.id);
    return map;
  }, [days, filtered]);
  const rows = useMemo(() => view === 'calendar'
    ? (byDate.get(day) ?? []).map(({ item, start, originalDate }) => ({ item, date: start, originalDate, ended: false }))
    : filtered.flatMap((item) => {
      const row = relevantResolvedOccurrence(item, today, new Date(now));
      const result = row ? { item: row.event, date: row.start, originalDate: row.originalDate, ended: false }
        : { item, date: item.eventDate, originalDate: item.eventDate, ended: true };
      if (!query.trim()) return [result];
      const matching = (item.occurrenceOverrides ?? []).filter((o) => !o.cancelled && o.changes?.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
        .flatMap((o) => resolvedOccurrencesInRange(item, o.changes!.eventDate, o.changes!.eventDate).filter((r) => r.originalDate === o.originalDate)
          .map((r) => ({ item: r.event, date: r.start, originalDate: r.originalDate, ended: false })));
      return [...matching, ...(matching.some((r) => r.originalDate === result.originalDate) ? [] : [result])].filter((r) => `${r.item.title} ${r.item.category} ${r.item.location ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    })
      .sort((a, b) => Number(occurrenceDayStatus(a.item, a.date, today, new Date(now)) === 'past') - Number(occurrenceDayStatus(b.item, b.date, today, new Date(now)) === 'past') || a.date.localeCompare(b.date) || a.item.eventTime.localeCompare(b.item.eventTime)),
  [view, byDate, day, filtered, today, now, query]);
  const monthCount = new Set(days.filter((date) => date.startsWith(month)).flatMap((date) => (byDate.get(date) ?? []).map(({ item, originalDate }) => `${item.id}:${originalDate}`))).size;
  const monthLabel = `${Number(month.slice(0, 4))}년 ${Number(month.slice(5))}월`;

  function moveMonth(offset: number) {
    const next = shiftCalendarMonth(month, offset);
    setMonth(next);
    setDay(next === today.slice(0, 7) ? today : `${next}-01`);
  }

  function selectDay(date: string) {
    setDay(date);
    setMonth(date.slice(0, 7));
    if (window.matchMedia('(max-width: 639px)').matches) {
      window.requestAnimationFrame(() => document.getElementById('calendar-agenda')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  if (bulkOpen) return <BulkEventManager offline={isOffline} colors={colorSettings?.colors ?? {}} onClose={() => { setBulkOpen(false); requestAnimationFrame(() => document.getElementById('bulk-open')?.focus()); }} onChanged={() => onBulkChanged?.()} />;

  return <section id="calendar-workspace" className="calendar-workspace" aria-label="내 캘린더">
    {isSampleMode && <div className="sample-notice"><span>지금은 예시를 보고 있어요. 첫 일정을 추가해 시작하세요.</span><button type="button" onClick={() => onCreate()}>시작하기 <AppIcon name="arrow" size={16} /></button></div>}

    <div className="calendar-surface">
      <div className="calendar-toolbar">
        <div className="month-navigation">
          <h2>{view === 'calendar' ? monthLabel : '모든 일정'}</h2>
          {view === 'calendar' && <div className="month-controls">
            <button type="button" className="icon-button" aria-label="이전 달" disabled={month <= '1900-01'} onClick={() => moveMonth(-1)}><AppIcon name="left" size={18} /></button>
            <button type="button" className="icon-button" aria-label="다음 달" disabled={month >= '9999-12'} onClick={() => moveMonth(1)}><AppIcon name="right" size={18} /></button>
            <button type="button" className="today-button" onClick={() => { setMonth(today.slice(0, 7)); setDay(today); }}>오늘</button>
          </div>}
        </div>
        <div className="view-switch" aria-label="보기 방식">
          <button type="button" aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}><AppIcon name="calendar" size={17} /><span>월간</span></button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}><AppIcon name="list" size={17} /><span>목록</span></button>
        </div>
        <button type="button" id="bulk-open" className="text-button" onClick={() => setBulkOpen(true)}>일괄 관리</button>
      </div>
      <div className="calendar-filters">
        <div className="category-filters" aria-label="일정 종류 필터"><button type="button" aria-label="모든 일정 종류 보기" aria-pressed={activeCategory === null} onClick={() => setCategory(null)}>전체</button>{categories.map(name => <button type="button" key={name} aria-label={`${name} 종류만 보기`} aria-pressed={activeCategory === name} onClick={() => setCategory(name)}><span style={{ background: getCategoryTheme(name, colorSettings?.colors[name]).accent }} />{name === '전체' ? '전체 (종류)' : name}</button>)}</div>
        <div className="schedule-search"><AppIcon name="search" size={17} /><input type="search" value={query} aria-label="일정 제목, 종류 또는 장소 검색" placeholder="일정 검색" onChange={(event) => { setQuery(event.target.value); if (event.target.value) setView('list'); }} /></div>
      </div>

      {colorSettings && <CategoryColorSettings categories={categories} settings={colorSettings} offline={isOffline} />}

      {view === 'calendar' && <>
        <div className="calendar-weekdays" aria-hidden="true">{['월', '화', '수', '목', '금', '토', '일'].map((label) => <span key={label}>{label}</span>)}</div>
        <div className="month-grid" aria-label={`${monthLabel} 월간 캘린더`}>
          {days.map((date, index) => {
            if (!isValidEventDate(date)) return <div key={`padding-${index}`} className="calendar-cell outside-month" aria-hidden="true" />;
            const events = byDate.get(date) ?? [];
            return <div key={date} className={`calendar-cell ${date.startsWith(month) ? '' : 'outside-month'} ${day === date ? 'selected-day' : ''}`}>
              <button type="button" className={`day-number ${date === today ? 'is-today' : ''}`} aria-pressed={day === date} aria-current={date === today ? 'date' : undefined} aria-label={`${calendarDateLabel(date)}, 일정 ${events.length}개`} onClick={() => selectDay(date)}>{Number(date.slice(8))}</button>
              <div className="calendar-cell-events">{events.slice(0, 2).map(({ item, start, originalDate }) => <button type="button" key={`${item.id}:${originalDate}`} title={`${item.category} · ${formatEventRange(item, start)} · ${item.title}`} aria-label={`${calendarDateLabel(date)} ${item.category} ${item.title} 상세 보기`} aria-pressed={selectedId === item.id && selectedDate === originalDate} style={{ '--event-color': item.accent, '--event-soft': item.soft, '--event-text': item.text ?? item.accent } as CSSProperties} onClick={() => { setDay(date); onSelect(item.id, originalDate); }}><span className="calendar-event-time">{date > start ? '→' : item.allDay ? '종일' : item.eventTime}</span><span className="truncate">{isComplete(item, originalDate) ? '✓ ' : date > start ? '↳ ' : ''}{item.title}</span></button>)}</div>
              {events.length > 2 && <button type="button" className="more-events" onClick={() => selectDay(date)}>+{events.length - 2}개 더</button>}
              {events.length > 0 && <button type="button" className="mobile-day-events" aria-label={`${calendarDateLabel(date)} 일정 ${events.length}개 보기`} onClick={() => selectDay(date)}>{events.slice(0, 3).map(({ item, originalDate }) => <span key={`${item.id}:${originalDate}`} style={{ background: item.accent }} />)}<span className="sr-only">{events.length}개</span></button>}
            </div>;
          })}
        </div>
        <div className="calendar-caption"><span>날짜를 선택하면 그날의 일정이 보여요.</span><span>이번 달 {monthCount}건{isSampleMode ? ' · 예시' : ''}</span></div>
      </>}

      <section id="calendar-agenda" className="agenda" aria-label={view === 'calendar' ? '선택한 날짜의 일정' : '전체 일정 목록'}>
        <div className="agenda-heading"><div><h3>{view === 'calendar' ? calendarDateLabel(day) : query ? '검색 결과' : '다가오는 일정과 지난 기록'}</h3><span aria-live="polite">{rows.length}개{view === 'list' ? ' · 반복 일정은 진행 중 또는 다음 회차' : ''}</span></div><button type="button" className="text-button" onClick={() => onCreate(view === 'calendar' ? day : undefined)}><AppIcon name="plus" size={16} />{view === 'calendar' ? '이날 추가' : '일정 추가'}</button></div>
        {rows.length === 0 ? <div className="calendar-empty"><div className="empty-icon"><AppIcon name={query ? 'search' : 'calendar'} size={26} /></div><h4>{query ? '일치하는 일정이 없어요' : '등록된 일정이 없어요'}</h4><p>{query || activeCategory !== null ? '검색어나 일정 종류를 바꿔 보세요.' : '기억하고 싶은 일정을 여기에 담아 보세요.'}</p>{(query || activeCategory !== null) && <button type="button" className="text-button" onClick={() => { setQuery(''); setCategory(null); }}>필터 초기화</button>}</div>
          : <div className="agenda-list">{rows.map(({ item, date, originalDate, ended }) => <button type="button" key={`${item.id}:${originalDate}`} className={`agenda-row ${selectedId === item.id && selectedDate === originalDate ? 'is-selected' : ''}`} aria-pressed={selectedId === item.id && selectedDate === originalDate} onClick={() => onSelect(item.id, originalDate)}>
            <span className="agenda-date" style={{ background: item.soft, color: item.text ?? item.accent }}><span>{Number(date.slice(5, 7))}월</span><strong>{Number(date.slice(8))}</strong></span>
            <span className="agenda-info"><span className="agenda-title">{item.title}{!ended && isComplete(item, originalDate) && <span className="completion-badge">완료</span>}{item.isSample && <span className="sample-tag">예시</span>}</span><span className="agenda-meta"><span>{ended ? '다가오는 회차 없음 · 전체 일정 관리' : formatEventRange(item, date)}</span><span className="agenda-category" style={{ color: item.text ?? item.accent, background: item.soft, borderLeft: `3px solid ${item.accent}` }}>{item.category}</span>{schedules.find((s) => s.id === item.id)?.recurrence !== 'none' && <span>↻ 반복</span>}{occurrenceDayStatus(item, date, today, new Date(now)) === 'ongoing' && <span className="ongoing-badge">진행 중</span>}{occurrenceDayStatus(item, date, today, new Date(now)) === 'past' && <span>지난 일정</span>}</span></span>
            <span className="agenda-reminders"><AppIcon name="bell" size={15} /><span>{item.reminders.length}</span></span><span className="agenda-arrow"><AppIcon name="right" size={18} /></span>
          </button>)}</div>}
      </section>
    </div>
    <p className="timezone-note">모든 일정과 알림은 한국 시간(KST) 기준이에요.</p>
  </section>;
}
