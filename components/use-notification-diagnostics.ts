'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { browserPlatform, matchingPushDevice, serverCheck, type BrowserInfo, type CheckState, type PushDevice, type ServerCheck } from '@/lib/notification-diagnostics';

export function useNotificationDiagnostics(busy: boolean) {
  const [browser, setBrowser] = useState<BrowserInfo | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [device, setDevice] = useState<PushDevice | null>(null);
  const [deviceState, setDeviceState] = useState<CheckState>('checking');
  const [server, setServer] = useState<ServerCheck>('checking');
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (busy) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = () => !controller.signal.aborted && request.current === controller;
    const info: BrowserInfo = {
      platform: browserPlatform(navigator.userAgent, navigator.maxTouchPoints),
      standalone: window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
      secure: window.isSecureContext, online: navigator.onLine,
      supported: 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window,
    };
    setBrowser(info);
    setPermission('Notification' in window ? Notification.permission : 'default');
    setRefreshing(true);
    // Keep the last result visible during refreshes; only the initial read starts
    // in "checking". New failures still replace the result when they arrive.
    const timeout = window.setTimeout(() => {
      if (current()) { controller.abort(); setDeviceState('error'); setServer('error'); setRefreshing(false); }
    }, 10_000);
    try {
      if (!info.online) throw new Error('Offline');
      await Promise.all([
        (async () => {
          try {
            const registration = info.supported ? await navigator.serviceWorker.getRegistration('/') : undefined;
            const candidate = await registration?.pushManager.getSubscription();
            const local = candidate && (candidate.expirationTime === null || candidate.expirationTime > Date.now()) ? candidate : null;
            let nextDevice: PushDevice | null = null;
            if (local) {
              const response = await fetch('/api/push/subscriptions', { cache: 'no-store', signal: controller.signal });
              if (!response.ok) throw new Error('Device check failed');
              nextDevice = matchingPushDevice(await response.json(), local.endpoint);
            }
            if (current()) { setDevice(nextDevice); setDeviceState('ready'); }
          } catch { if (current()) setDeviceState('error'); }
        })(),
        (async () => {
          try {
            const response = await fetch('/api/push/public-key', { cache: 'no-store', signal: controller.signal });
            const nextServer = serverCheck(response.status, await response.json().catch(() => null));
            if (current()) setServer(nextServer);
          } catch { if (current()) setServer('error'); }
        })(),
      ]);
      if (current()) setCheckedAt(Date.now());
    } catch { if (current()) { setDeviceState('error'); setServer('error'); } }
    finally { window.clearTimeout(timeout); if (current()) setRefreshing(false); }
  }, [busy]);

  useEffect(() => {
    // Cancel reads before any consent/device mutation; stale responses cannot undo it.
    request.current?.abort();
    if (busy) return;
    const frame = window.requestAnimationFrame(() => { void refresh(); });
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const displayMode = window.matchMedia('(display-mode: standalone)');
    const interval = window.setInterval(onVisible, 30_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    document.addEventListener('visibilitychange', onVisible);
    displayMode.addEventListener('change', refresh);
    return () => {
      request.current?.abort(); window.cancelAnimationFrame(frame); window.clearInterval(interval);
      window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); window.removeEventListener('offline', refresh);
      document.removeEventListener('visibilitychange', onVisible); displayMode.removeEventListener('change', refresh);
    };
  }, [busy, refresh]);

  const cancelReads = () => { request.current?.abort(); };
  return { browser, permission, setPermission, device, setDevice, deviceState, setDeviceState, server, setServer, checkedAt, refreshing, refresh, cancelReads };
}
