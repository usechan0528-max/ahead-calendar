export type PushDevice = { id: number; enabled: boolean };
export type CheckState = 'checking' | 'ready' | 'error';
export type ServerCheck = 'checking' | 'ready' | 'delayed' | 'unconfigured' | 'signed-out' | 'error';
export type BrowserInfo = {
  platform: 'ios' | 'android' | 'desktop'; standalone: boolean;
  secure: boolean; online: boolean; supported: boolean;
};
export type NotificationChecks = {
  browser: BrowserInfo | null; permission: NotificationPermission;
  device: PushDevice | null; deviceState: CheckState; server: ServerCheck;
};

export function browserPlatform(userAgent: string, maxTouchPoints = 0): BrowserInfo['platform'] {
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) return 'ios';
  return /Android/i.test(userAgent) ? 'android' : 'desktop';
}

export function notificationDiagnosis(checks: NotificationChecks) {
  const { browser, permission, device, deviceState, server } = checks;
  if (!browser) return { tone: 'neutral', title: '이 기기를 확인하고 있어요', detail: '알림 권한을 자동으로 요청하지 않아요.', action: 'none' } as const;
  if (!browser.secure) return { tone: 'warning', title: '안전한 주소에서 열어 주세요', detail: '알림은 HTTPS 주소에서 사용할 수 있어요.', action: 'none' } as const;
  if (!browser.online) return { tone: 'warning', title: '인터넷 연결을 확인해 주세요', detail: '연결이 끊겨 최신 수신 설정과 서버 상태를 확인할 수 없어요.', action: 'retry' } as const;
  if (browser.platform === 'ios' && !browser.standalone) return { tone: 'warning', title: '홈 화면에서 열면 알림을 설정할 수 있어요', detail: 'iPhone·iPad는 홈 화면에 추가한 웹 앱에서 수신을 설정해 주세요.', action: 'install' } as const;
  if (!browser.supported) return { tone: 'warning', title: '이 환경에서는 웹 알림을 지원하지 않아요', detail: '최신 브라우저로 열어 주세요. 앱 안의 브라우저라면 Safari 또는 Chrome으로 다시 열어 주세요.', action: 'help' } as const;
  if (permission === 'denied') return { tone: 'warning', title: '알림 권한이 차단되어 있어요', detail: '기기·브라우저 설정에서 허용한 뒤 다시 점검해 주세요. 여기서 차단을 직접 해제할 수는 없어요.', action: 'help' } as const;
  if (server === 'signed-out') return { tone: 'warning', title: '로그인 상태를 확인해 주세요', detail: '페이지를 새로고침해 로그인한 뒤 다시 점검해 주세요.', action: 'retry' } as const;
  if (deviceState === 'error' || server === 'error') return { tone: 'warning', title: '일부 상태를 확인하지 못했어요', detail: '수신이 꺼졌다는 뜻은 아니에요. 연결을 확인하고 다시 점검해 주세요.', action: 'retry' } as const;
  if (deviceState === 'checking' || server === 'checking') return { tone: 'neutral', title: '연결 상태를 확인하고 있어요', detail: '현재 기기의 수신 설정과 자동 발송 상태를 확인해요.', action: 'none' } as const;
  if (server === 'unconfigured') return { tone: 'warning', title: '알림 서버를 준비하고 있어요', detail: '지금은 알림을 연결할 수 없어요. 잠시 후 다시 점검해 주세요.', action: 'retry' } as const;
  if (permission !== 'granted' || !device?.enabled) return { tone: 'neutral', title: '원할 때 일정 알림을 켜 주세요', detail: '이 기기에서 내 일정에 저장된 알림을 받아요. 다른 기기의 설정은 바꾸지 않아요.', action: 'enable' } as const;
  if (server === 'delayed') return { tone: 'warning', title: '자동 발송 연결을 확인해야 해요', detail: '이 기기의 설정은 켜져 있지만 예약 알림이 늦어질 수 있어요. 잠시 후 다시 점검해 주세요.', action: 'retry' } as const;
  return { tone: 'good', title: '알림을 받을 설정이 갖춰졌어요', detail: '실제 도착 여부는 테스트 알림으로 확인해 주세요. 기기의 집중 모드와 네트워크에 따라 도착이 늦어질 수 있어요.', action: 'test' } as const;
}

// A browser subscription alone does not prove that this account enabled reminders.
export function matchingPushDevice(payload: unknown, endpoint: string): PushDevice | null {
  if (!payload || typeof payload !== 'object' || !('subscriptions' in payload) || !Array.isArray(payload.subscriptions)) throw new Error('Invalid device response');
  const device = payload.subscriptions.find((row: unknown) => row && typeof row === 'object' && 'endpoint' in row && row.endpoint === endpoint && 'disabled_at' in row && !row.disabled_at);
  if (!device) return null;
  if (!Number.isSafeInteger(device.id) || device.id < 1) throw new Error('Invalid device');
  return { id: device.id, enabled: !!device.reminders_enabled_at };
}

export function serverCheck(status: number, payload: unknown): ServerCheck {
  if (status === 401) return 'signed-out';
  if (status === 503) return 'unconfigured';
  if (status !== 200 || !payload || typeof payload !== 'object' || !('scheduler' in payload) || !payload.scheduler || typeof payload.scheduler !== 'object' || !('ready' in payload.scheduler) || typeof payload.scheduler.ready !== 'boolean') return 'error';
  return payload.scheduler.ready ? 'ready' : 'delayed';
}

export async function withPushTimeout<T>(promise: Promise<T>, milliseconds = 12_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('알림 연결이 오래 걸리고 있어요. 네트워크를 확인한 뒤 다시 시도해 주세요.')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
