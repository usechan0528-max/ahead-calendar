'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseCategoryColor } from '@/lib/design-tokens';

function responseObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('응답을 확인하지 못했어요. 다시 불러와 주세요.');
  return value as Record<string, unknown>;
}

export function useCategoryColors() {
  const [colors, setColors] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const writing = useRef(false);
  const read = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (writing.current) return;
    read.current?.abort();
    const controller = new AbortController(); read.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch('/api/category-colors', { cache: 'no-store', signal: controller.signal });
      const body = responseObject(await response.json());
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : '색상 조회 실패');
      if (!body.colors || typeof body.colors !== 'object' || Array.isArray(body.colors) || Object.values(body.colors).some(value => !parseCategoryColor(value))) throw new Error('Invalid colors');
      if (read.current === controller && !controller.signal.aborted) { setColors(body.colors as Record<string, string>); setReady(true); setError(null); }
    } catch {
      if (read.current === controller) setError('색상 설정을 불러오지 못했어요. 다시 불러와 주세요.');
    } finally { clearTimeout(timeout); }
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => void refresh());
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus); window.addEventListener('online', onFocus);
    return () => { cancelAnimationFrame(frame); read.current?.abort(); read.current = null; window.removeEventListener('focus', onFocus); window.removeEventListener('online', onFocus); };
  }, [refresh]);

  async function save(category: string, color: string | null) {
    if (writing.current || !ready) return false;
    read.current?.abort(); read.current = null;
    writing.current = true; setBusy(true); setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch('/api/category-colors', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category, color }), signal: controller.signal });
      const body = responseObject(await response.json());
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : '색상을 저장하지 못했어요.');
      if (body.category !== category || body.color !== color || (body.color !== null && !parseCategoryColor(body.color))) throw new Error('저장한 색상을 확인하지 못했어요. 다시 불러와 주세요.');
      setColors(previous => {
        const next = { ...previous };
        if (color === null) delete next[category]; else Object.defineProperty(next, category, { value: color, enumerable: true, configurable: true, writable: true });
        return next;
      });
      return true;
    } catch (reason) { setError(reason instanceof Error && reason.name !== 'AbortError' ? reason.message : '저장 여부를 확인하지 못했어요. 다시 불러와 확인해 주세요.'); return false; }
    finally { clearTimeout(timeout); writing.current = false; setBusy(false); }
  }
  return { colors, ready, busy, error, refresh, save };
}
