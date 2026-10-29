'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isAccountProfileSnapshot, type AccountProfileSnapshot } from '@/lib/account-profile';

export function useAccountProfile(refreshOnFocus = false) {
  const [snapshot, setSnapshot] = useState<AccountProfileSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [version, setVersion] = useState(0);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setLoading(true); setError(null);
    try {
      const response = await fetch('/api/profile', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      if (request.current !== controller) return false;
      if (response.status === 401) { setUnauthorized(true); setSnapshot(null); return false; }
      const data = await response.json();
      if (request.current !== controller) return false;
      if (!response.ok || !isAccountProfileSnapshot(data)) throw new Error('Profile unavailable');
      setSnapshot(data); setUnauthorized(false); setVersion(value => value + 1);
      return true;
    } catch {
      if (request.current === controller) setError('프로필을 불러오지 못했어요. 다시 시도해 주세요.');
      return false;
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) { request.current = null; setLoading(false); }
    }
  }, []);
  useEffect(() => {
    void refresh();
    const focus = () => { void refresh(); };
    if (refreshOnFocus) window.addEventListener('focus', focus);
    return () => { window.removeEventListener('focus', focus); request.current?.abort(); request.current = null; };
  }, [refresh, refreshOnFocus]);
  const accept = (data: AccountProfileSnapshot) => { setSnapshot(data); setVersion(value => value + 1); setError(null); };
  return { snapshot, loading, error, unauthorized, version, refresh, accept };
}
