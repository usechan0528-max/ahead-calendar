'use client';
import { useEffect, useRef, useState } from 'react';
import type { CompletionKind, OccurrenceCompletion } from '@/lib/progression';

export const occurrenceCheckKey = (eventId: number, date: string) => `${eventId}:${date}`;
export function useOverviewChecks(targets: Array<{ eventId: number; date: string; revision: number }>, scope: string, minute: number, version: number, onChanged?: () => void) {
  const key = JSON.stringify(targets);
  const [snapshot, setSnapshot] = useState<{ scope: string; key: string; values: Record<string, OccurrenceCompletion> }>({ scope: '', key: '', values: {} });
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const generation = useRef(0);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const focusId = useRef<string | null>(null);
  useEffect(() => {
    const controller = new AbortController(); const current = ++generation.current;
    queueMicrotask(() => { if (!controller.signal.aborted) { setLoading(true); setError(''); setStale(false); } });
    async function load() {
      const requested = JSON.parse(key) as typeof targets;
      const values: Record<string, OccurrenceCompletion> = {};
      if (!scope || !requested.length) return values;
      for (let index = 0; index < requested.length; index += 10) {
        const response = await fetch('/api/completions', { method: 'POST', cache: 'no-store', signal: controller.signal,
          headers: { 'content-type': 'application/json', 'x-toj-list-checks': '1', 'x-toj-event-account': scope }, body: JSON.stringify({ targets: requested.slice(index, index + 10) }) });
        const body = await response.json() as { scope?: string; error?: string; results?: Array<{ eventId: number; date: string; occurrence?: OccurrenceCompletion; stale?: boolean }> };
        if (!response.ok || body.scope !== scope || !Array.isArray(body.results)) throw new Error(body.error ?? '완료 상태를 확인하지 못했어요.');
        if (!controller.signal.aborted && current === generation.current && body.results.some(result => result.stale)) setStale(true);
        for (const result of body.results) if (result.occurrence) values[occurrenceCheckKey(result.eventId, result.date)] = result.occurrence;
      }
      return values;
    }
    load().then(values => { if (!controller.signal.aborted && current === generation.current) setSnapshot({ scope, key, values }); })
      .catch(reason => { if (!controller.signal.aborted && current === generation.current) { setSnapshot({ scope, key, values: {} }); setError(reason instanceof Error ? reason.message : '완료 상태를 불러오지 못했어요.'); } })
      .finally(() => { if (!controller.signal.aborted && current === generation.current) setLoading(false); });
    return () => controller.abort();
  }, [key, scope, minute, version, refresh]);
  useEffect(() => {
    if (focusId.current) { document.getElementById(focusId.current)?.focus({ preventScroll: true }); focusId.current = null; }
  }, [key, version]);
  async function toggle(eventId: number, date: string, kind: CompletionKind, itemId: number, complete: boolean) {
    const occurrence = snapshot.scope === scope && snapshot.key === key ? snapshot.values[occurrenceCheckKey(eventId, date)] : null;
    if (locked.current || loading || !occurrence || !scope || !navigator.onLine) return;
    locked.current = true; setBusy(true); setError(''); setNotice(''); ++generation.current;
    try {
      const response = await fetch(`/api/events/${eventId}/completion`, { method: 'PATCH', headers: {
        'content-type': 'application/json', 'x-toj-list-checks': '1', 'x-toj-event-account': scope,
      }, body: JSON.stringify({ date, kind, itemId, complete, revision: occurrence.revision }) });
      const body = await response.json() as { error?: string; occurrence?: OccurrenceCompletion; awardedXp?: number };
      if (!response.ok || !body.occurrence) throw new Error(body.error ?? '저장 결과를 확인하지 못했어요.');
      const saved = body.occurrence;
      setSnapshot(previous => previous.scope === scope ? { ...previous, values: { ...previous.values, [occurrenceCheckKey(eventId, date)]: saved } } : previous);
      setNotice(complete ? `완료했어요.${(body.awardedXp ?? 0) > 0 ? ` +${body.awardedXp} XP` : ''}` : '완료를 해제했어요. 획득한 경험치는 유지돼요.');
      if (kind === 'event') focusId.current = `quick-event-${eventId}-${date}`;
    } catch (reason) { setNotice(`${reason instanceof Error ? reason.message : '저장 결과를 확인하지 못했어요.'} 현재 상태를 다시 불러올게요.`); }
    finally { locked.current = false; setBusy(false); setRefresh(value => value + 1); onChanged?.(); }
  }
  return { values: snapshot.scope === scope && snapshot.key === key ? snapshot.values : {}, busy, loading, error, notice, stale, toggle, retry: () => setRefresh(value => value + 1) };
}
