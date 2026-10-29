'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StoredEvent } from '@/db/events';
import { BULK_EVENT_LIMIT, type BulkAction, type BulkRequest, type BulkResult } from '@/lib/bulk-events';
import { getSeoulDate, isValidEventDate, occurrenceInstant } from '@/lib/recurrence';
import { relevantResolvedOccurrence, resolveOccurrence } from '@/lib/occurrences';
import { formatEventRange, shiftEventDate } from '@/lib/event-duration';
import { eventCategoryOptions, parseEventCategory } from '@/lib/event-category';
import { getCategoryTheme } from '@/lib/design-tokens';
import { EventCategoryField } from './event-category-field';

type Snapshot = { events: StoredEvent[]; completedEvents: Array<{ eventId: number; date: string }>; scope: string; shiftBlockedIds: number[] };
const labels: Record<BulkAction, string> = { complete: '완료 처리', pending: '완료 해제', category: '종류 변경', shift: '날짜 이동', delete: '삭제' };
const descriptions: Record<BulkAction, string> = {
  complete: '표시된 회차만 완료해요. 시작 전 일정은 제외돼요.',
  pending: '표시된 회차의 완료만 해제해요. 이미 받은 경험치는 유지돼요.',
  category: '반복 일정은 모든 회차의 종류와 색상이 바뀌어요. 준비 항목은 유지돼요.',
  shift: '실천 기록이 없는 일반 일정만 이동해요. 시간과 일정 길이는 유지돼요.',
  delete: '반복 일정은 모든 회차가 삭제돼요. 준비 항목과 알림도 함께 삭제되며 되돌릴 수 없어요.',
};

export function BulkEventManager({ offline, colors, onClose, onChanged }: {
  offline: boolean; colors: Record<string, string>; onClose: () => void; onChanged: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [reference, setReference] = useState(getSeoulDate);
  const [action, setAction] = useState<BulkAction>('complete');
  const [category, setCategory] = useState('일정');
  const [days, setDays] = useState('1');
  const [direction, setDirection] = useState(1);
  const [confirmation, setConfirmation] = useState<BulkRequest | null>(null);
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const confirmHeading = useRef<HTMLHeadingElement>(null);
  const actionButton = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);

  const load = useCallback(async (keepIds: number[] = [], expectedScope?: string) => {
    setLoading(true); setError(null);
    try {
      const response = await fetch('/api/events/bulk', { cache: 'no-store' });
      const body = await response.json() as Snapshot & { error?: string };
      if (!response.ok) throw new Error(body.error ?? '일정을 불러오지 못했어요.');
      if (!Array.isArray(body.events) || !Array.isArray(body.completedEvents) || !Array.isArray(body.shiftBlockedIds) || typeof body.scope !== 'string') throw new Error('일정 목록을 확인하지 못했어요.');
      if (alive.current) { setSnapshot(body); setPicked(expectedScope === body.scope ? keepIds.filter(id => body.events.some(event => event.id === id)) : []); setConfirmation(null); setNeedsReload(false); }
    } catch (reason) { if (alive.current) { setError(reason instanceof Error ? reason.message : '일정을 불러오지 못했어요.'); setNeedsReload(true); } }
    finally { if (alive.current) setLoading(false); }
  }, []);
  useEffect(() => { alive.current = true; heading.current?.focus(); void load(); return () => { alive.current = false; }; }, [load]);
  useEffect(() => { if (confirmation) confirmHeading.current?.focus(); }, [confirmation]);
  useEffect(() => {
    const preventLeave = (event: BeforeUnloadEvent) => { if (busyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', preventLeave);
    return () => window.removeEventListener('beforeunload', preventLeave);
  }, []);

  const rows = useMemo(() => (snapshot?.events ?? []).map(event => {
    const master = { eventDate: event.event_date, eventTime: event.event_time, allDay: !!event.all_day,
      allDayReminderTime: event.all_day_reminder_time, endDate: event.end_date, endTime: event.end_time,
      recurrence: event.recurrence, recurrenceInterval: event.recurrence_interval, recurrenceDay: event.recurrence_day,
      recurrenceUntil: event.recurrence_until, occurrenceOverrides: event.occurrenceOverrides, title: event.title };
    const baseDate = isValidEventDate(reference) ? reference : getSeoulDate();
    const occurrence = event.recurrence === 'none' ? resolveOccurrence(master, event.event_date)
      : relevantResolvedOccurrence(master, baseDate, new Date(`${baseDate}T00:00:00+09:00`));
    const complete = !!occurrence && !!snapshot?.completedEvents.some(item => item.eventId === event.id && item.date === occurrence.originalDate);
    const future = !!occurrence && (occurrence.event.allDay ? occurrence.start > getSeoulDate() : occurrenceInstant(occurrence.start, occurrence.event.eventTime).getTime() > Date.now());
    return { event, occurrence, complete, future };
  }).sort((a, b) => (a.occurrence?.start ?? '9999').localeCompare(b.occurrence?.start ?? '9999') || a.event.id - b.event.id), [snapshot, reference]);
  const filtered = rows.filter(row => (!categoryFilter || row.event.category === categoryFilter)
    && `${row.occurrence?.event.title ?? row.event.title} ${row.event.category} ${row.event.location}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    && (statusFilter === 'all' || (statusFilter === 'complete' ? row.complete : !row.complete)));
  const selected = rows.filter(row => picked.includes(row.event.id));
  const categories = eventCategoryOptions(snapshot?.events.map(event => event.category) ?? []);
  const hiddenCount = selected.filter(row => !filtered.some(visible => visible.event.id === row.event.id)).length;
  const totalSuccess = results?.filter(result => result.status === 'success').length ?? 0;
  const unavailable = busy || loading || needsReload || !snapshot;
  const validAction = isValidEventDate(reference) && (action !== 'category' || !!parseEventCategory(category))
    && (action !== 'shift' || (Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 365));
  function exclusion(row: typeof rows[number]) {
    if (action === 'complete' || action === 'pending') {
      if (!row.occurrence) return '기준일 이후 회차 없음';
      if (action === 'complete' && row.future && !row.complete) return '아직 시작 전';
    }
    if (action === 'shift') {
      if (row.event.recurrence !== 'none' || row.event.occurrenceOverrides.length) return '반복·회차 변경 일정';
      if (snapshot?.shiftBlockedIds.includes(row.event.id)) return '실천 기록이 있는 일정';
      if (validAction && (!shiftEventDate(row.event.event_date, direction * Number(days)) || (row.event.end_date && !shiftEventDate(row.event.end_date, direction * Number(days))))) return '지원 날짜 범위를 벗어남';
    }
    return null;
  }
  const excluded = selected.map(row => ({ row, reason: exclusion(row) })).filter(item => item.reason);
  const eligible = selected.filter(row => !exclusion(row));

  function toggle(id: number) {
    setConfirmation(null);
    setPicked(previous => previous.includes(id) ? previous.filter(value => value !== id) : previous.length < BULK_EVENT_LIMIT ? [...previous, id] : previous);
  }
  function review() {
    if (unavailable || offline || !picked.length || !validAction) return;
    const targets = eligible.map(row => ({ id: row.event.id, revision: row.event.notification_revision, date: row.occurrence?.originalDate ?? null }));
    if (!targets.length) return;
    setError(null);
    setConfirmation({ action, targets, ...(action === 'category' ? { category: parseEventCategory(category)! } : {}), ...(action === 'shift' ? { days: direction * Number(days) } : {}) });
  }
  async function apply() {
    if (!confirmation || !snapshot || busyRef.current || offline || needsReload) return;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch('/api/events/bulk', { method: 'POST', headers: { 'content-type': 'application/json', 'x-toj-bulk': '1', 'x-toj-bulk-account': snapshot.scope }, body: JSON.stringify(confirmation) });
      const body = await response.json() as { results?: BulkResult[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? '저장 결과를 확인하지 못했어요.');
      if (!Array.isArray(body.results) || body.results.length !== confirmation.targets.length
        || body.results.some((result, index) => result.id !== confirmation.targets[index].id || !['success', 'failed', 'unknown'].includes(result.status))) throw new Error('저장 결과를 확인하지 못했어요.');
      const outcomes = body.results as BulkResult[];
      if (!alive.current) return;
      setResults(outcomes);
      setNeedsReload(true); setConfirmation(null);
      // Read-only reconciliation: never retry an uncertain relative date move.
      await load(outcomes.filter(result => result.status === 'failed').map(result => result.id), snapshot.scope);
    } catch (reason) {
      if (alive.current) { setError(`${reason instanceof Error ? reason.message : '저장 결과를 확인하지 못했어요.'} 새로 불러와 현재 상태를 확인해 주세요.`); setNeedsReload(true); setConfirmation(null); }
    } finally {
      busyRef.current = false;
      if (alive.current) { setBusy(false); onChanged(); heading.current?.focus(); }
    }
  }
  function cancelConfirmation() { setConfirmation(null); requestAnimationFrame(() => actionButton.current?.focus()); }

  return <section className="bulk-manager calendar-surface" aria-labelledby="bulk-title" aria-busy={busy || loading}>
    <div className="bulk-heading"><div><h2 id="bulk-title" tabIndex={-1} ref={heading}>일괄 관리</h2><p>일정을 선택하고 한 번에 정리하세요.</p></div><button type="button" className="text-button" disabled={busy} onClick={onClose}>닫기</button></div>
    {offline && <p className="bulk-notice" role="status">인터넷에 연결한 뒤 변경할 수 있어요.</p>}
    {error && <p className="bulk-error" role="alert">{error}</p>}
    {results && <div className="bulk-results" role="status"><strong>{totalSuccess}개 처리 · {results.length - totalSuccess}개 확인 필요</strong>
      <p>{loading ? '최신 상태를 불러오고 있어요.' : needsReload ? '목록을 다시 불러와 현재 상태를 확인해 주세요.' : '최신 상태로 갱신했어요. 다음 작업을 이어가세요.'}</p>
      {results.some(result => result.status !== 'success') && <ul>{results.filter(result => result.status !== 'success').map(result => <li key={result.id}><strong>{snapshot?.events.find(event => event.id === result.id)?.title ?? '일정'}</strong> — {result.message}</li>)}</ul>}
    </div>}
    {(needsReload || !snapshot) && !loading && <button type="button" className="primary-button" disabled={busy || offline} onClick={() => { setResults(null); void load(); }}>최신 일정 불러오기</button>}
    {loading && <p role="status">일정을 불러오고 있어요…</p>}
    {snapshot && <>
      <fieldset className="bulk-filters" disabled={busy || loading || !!confirmation}>
        <label><span>검색</span><input type="search" value={query} placeholder="제목, 종류, 장소" onChange={event => setQuery(event.target.value)} /></label>
        <label><span>종류</span><select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="">전체 종류</option>{categories.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
        <label><span>완료 상태</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">전체 상태</option><option value="pending">미완료</option><option value="complete">완료</option></select></label>
        <label><span>반복 회차 기준일</span><input type="date" min="1900-01-01" max="9999-12-31" value={reference} aria-invalid={!isValidEventDate(reference)} onChange={event => { setReference(event.target.value); setPicked([]); }} /></label>
      </fieldset>
      {!isValidEventDate(reference) && <p className="bulk-error" role="alert">올바른 기준일을 입력해 주세요.</p>}
      <p className="bulk-hint">반복 일정은 기준일에 진행 중이거나 다음에 오는 회차 1개를 표시해요.</p>
      <div className="bulk-selection"><strong aria-live="polite">{picked.length}개 선택{hiddenCount > 0 ? ` · 필터 밖 ${hiddenCount}개 포함` : ''}</strong>
        <div><button type="button" className="text-button" disabled={unavailable || !!confirmation || !filtered.length} onClick={() => setPicked(filtered.slice(0, BULK_EVENT_LIMIT).map(row => row.event.id))}>{filtered.length > BULK_EVENT_LIMIT ? '검색 결과 앞 20개 선택' : '검색 결과 전체 선택'}</button><button type="button" className="text-button" disabled={busy || !!confirmation || !picked.length} onClick={() => setPicked([])}>선택 해제</button></div>
      </div>
      <div className="bulk-list">{filtered.length ? filtered.map(row => {
        const theme = getCategoryTheme(row.event.category, colors[row.event.category]);
        return <label key={row.event.id} className={`bulk-row ${picked.includes(row.event.id) ? 'is-picked' : ''}`}>
          <input type="checkbox" checked={picked.includes(row.event.id)} disabled={unavailable || !!confirmation || (!picked.includes(row.event.id) && picked.length >= BULK_EVENT_LIMIT)} onChange={() => toggle(row.event.id)} />
          <span className="bulk-row-content"><strong>{row.occurrence?.event.title ?? row.event.title}</strong><span>{row.occurrence ? formatEventRange(row.occurrence.event, row.occurrence.start) : '기준일 이후 회차 없음'}</span><span className="bulk-row-tags"><span style={{ color: theme.text ?? theme.accent, background: theme.soft, borderLeft: `3px solid ${theme.accent}` }}>{row.event.category}</span>{row.event.recurrence !== 'none' && <span>↻ 반복</span>}<span>{row.complete ? '완료' : row.future ? '시작 전' : '미완료'}</span></span></span>
        </label>;
      }) : <p className="bulk-empty">{snapshot.events.length ? '조건에 맞는 일정이 없어요.' : '등록한 일정이 없어요. 캘린더에서 첫 일정을 추가해 주세요.'}</p>}</div>
      <div className="bulk-actions">
        <fieldset disabled={unavailable || !!confirmation}>
          <label className="bulk-action-choice"><span>선택한 일정에 적용</span><select value={action} onChange={event => { setAction(event.target.value as BulkAction); setError(null); }}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          {action === 'category' && <EventCategoryField value={category} onChange={setCategory} colors={colors} />}
          {action === 'shift' && <div className="bulk-shift"><label><span>이동 간격</span><input type="number" min="1" max="365" step="1" value={days} onChange={event => setDays(event.target.value)} /></label><label><span>이동 방향</span><select value={direction} onChange={event => setDirection(Number(event.target.value))}><option value="1">일 뒤로</option><option value="-1">일 앞으로</option></select></label></div>}
        </fieldset>
        <p className="bulk-hint">{descriptions[action]}</p>
        {!!picked.length && <div className="bulk-preflight" aria-live="polite"><strong>처리 가능 {eligible.length}개 · 제외 {excluded.length}개</strong>{excluded.length > 0 && <ul>{excluded.map(({ row, reason }) => <li key={row.event.id}>{row.event.title} — {reason}</li>)}</ul>}</div>}
        {!confirmation && <button type="button" ref={actionButton} className={`primary-button ${action === 'delete' ? 'bulk-danger' : ''}`} disabled={unavailable || offline || !eligible.length || !validAction} onClick={review}>{eligible.length ? `${eligible.length}개 ` : ''}{labels[action]} 검토</button>}
        {confirmation && <section className="bulk-confirm" aria-labelledby="bulk-confirm-title">
          <h3 id="bulk-confirm-title" tabIndex={-1} ref={confirmHeading}>{confirmation.targets.length}개 일정을 {labels[confirmation.action]}할까요?</h3>
          <p>{descriptions[confirmation.action]}</p>
          <ul>{selected.filter(row => confirmation.targets.some(target => target.id === row.event.id)).map(row => <li key={row.event.id}><strong>{row.occurrence?.event.title ?? row.event.title}</strong><span>{confirmation.action === 'delete' || confirmation.action === 'category' ? (row.event.recurrence === 'none' ? '일반 일정' : '반복 전체') : row.occurrence ? formatEventRange(row.occurrence.event, row.occurrence.start) : '회차 없음'}{confirmation.action === 'category' ? ` → ${confirmation.category}` : confirmation.action === 'shift' ? ` → ${shiftEventDate(row.event.event_date, confirmation.days!) ?? '지원 범위 밖'}` : ''}</span></li>)}</ul>
          <div><button type="button" className="text-button" disabled={busy} onClick={cancelConfirmation}>돌아가기</button><button type="button" className={`primary-button ${confirmation.action === 'delete' ? 'bulk-danger' : ''}`} disabled={busy || offline} onClick={() => void apply()}>{busy ? '처리 중…' : `${confirmation.targets.length}개 ${labels[confirmation.action]}`}</button></div>
        </section>}
      </div>
      <details className="bulk-policy"><summary>일괄 관리 안내</summary><p>한 번에 최대 20개를 처리해요. 검색 조건을 바꿔도 선택은 유지되며, 기준일을 바꾸거나 최신 목록을 불러오면 선택이 해제돼요.</p><p>처리할 수 없는 일정은 이유를 따로 표시해요. 완료 경험치의 하루 상한과 중복 지급 방지 규칙은 그대로 적용돼요.</p><p>날짜 이동은 반복 일정이나 실천 기록이 있는 일정에 적용되지 않아요. 반복 일정은 상세 화면에서 필요한 회차의 날짜를 바꿔 주세요.</p></details>
    </>}
  </section>;
}
