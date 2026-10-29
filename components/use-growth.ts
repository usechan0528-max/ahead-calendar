'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CompletionKind, OccurrenceCompletion, ProgressSummary } from '@/lib/progression';

async function readJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? '기록을 불러오지 못했어요. 다시 시도해 주세요.');
  return body as T;
}

export function useGrowth(eventId: number | undefined, date: string, now: number) {
  const [progress, setProgress] = useState<ProgressSummary | null>(null);
  const [scoped, setScoped] = useState<{ key: string; value: OccurrenceCompletion } | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const key = `${eventId ?? 'sample'}:${date}`;
  const minute = Math.floor(now / 60_000);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    const options = { signal: controller.signal };
    Promise.all([
      readJson<ProgressSummary>('/api/progress', options),
      eventId ? readJson<OccurrenceCompletion>(`/api/events/${eventId}/completion?date=${date}`, options) : Promise.resolve(null),
    ]).then(([summary, occurrence]) => {
      if (current !== generation.current || controller.signal.aborted) return;
      setProgress(summary); setScoped(occurrence ? { key, value: occurrence } : null); setError(null);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted && current === generation.current) setError(reason instanceof Error ? reason.message : '기록을 불러오지 못했어요.');
    });
    return () => controller.abort();
  }, [eventId, date, key, minute, revision]);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);

  async function complete(kind: CompletionKind, itemId: number, value: boolean) {
    if (!eventId || busyRef.current) return null;
    busyRef.current = true; setBusy(true); ++generation.current;
    try {
      const result = await readJson<{ progress: ProgressSummary; occurrence: OccurrenceCompletion; awardedXp: number }>(`/api/events/${eventId}/completion`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date, kind, itemId, complete: value }),
      });
      setProgress(result.progress); setScoped((previous) => previous?.key === key ? { key, value: result.occurrence } : previous); setError(null);
      return result;
    } catch (reason) { setError(reason instanceof Error ? reason.message : '저장하지 못했어요.'); return null; }
    finally { busyRef.current = false; setBusy(false); refresh(); }
  }
  async function setGoal(target: number) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); ++generation.current;
    try {
      setProgress(await readJson<ProgressSummary>('/api/progress', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target }) }));
      setError(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '목표를 저장하지 못했어요.'); }
    finally { busyRef.current = false; setBusy(false); refresh(); }
  }
  return { progress, occurrence: scoped?.key === key ? scoped.value : null, error, busy, refresh, complete, setGoal, revision };
}
