'use client';

import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange); window.addEventListener('offline', onChange);
  return () => { window.removeEventListener('online', onChange); window.removeEventListener('offline', onChange); };
}
// This is the device's connection hint, not proof that the server is reachable.
export function useConnectionStatus() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
