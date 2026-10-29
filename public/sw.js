const DEFAULT_URL = '/';
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function getPayload(event) {
  if (!event.data) return {};

  try {
    const payload = event.data.json();
    return payload && typeof payload === 'object' ? payload : {};
  } catch {
    return { body: event.data.text() };
  }
}

function getNotificationData(payload) {
  const nestedData = payload.data && typeof payload.data === 'object' ? payload.data : {};

  return {
    ...nestedData,
    jobId: payload.jobId ?? payload.job_id ?? nestedData.jobId ?? nestedData.job_id,
    url: payload.url ?? nestedData.url ?? DEFAULT_URL,
  };
}

self.addEventListener('push', (event) => {
  const payload = getPayload(event);
  const data = getNotificationData(payload);
  const options = {
    body: payload.body || '다가오는 일정을 확인해 주세요.',
    icon: payload.icon || '/favicon.svg',
    badge: payload.badge || '/favicon.svg',
    tag: payload.tag || (data.jobId ? `ahead-job-${data.jobId}` : 'ahead-reminder'),
    data,
    timestamp: payload.timestamp || Date.now(),
    renotify: true,
    actions: Array.isArray(payload.actions)
      ? payload.actions
      : [
          { action: 'ack', title: '확인' },
          { action: 'snooze-10', title: '10분 미루기' },
        ],
  };

  event.waitUntil(self.registration.showNotification(payload.title || 'J에게 (To J)', options));
});

async function focusOrOpenApp(rawUrl) {
  let targetUrl = new URL(DEFAULT_URL, self.location.origin);

  try {
    const requestedUrl = new URL(rawUrl || DEFAULT_URL, self.location.origin);
    if (requestedUrl.origin === self.location.origin) targetUrl = requestedUrl;
  } catch {
    // 잘못된 URL은 앱 홈으로 안전하게 대체합니다.
  }

  const windowClients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  const appClient = windowClients.find((client) => new URL(client.url).origin === self.location.origin);

  if (appClient) {
    if (appClient.url !== targetUrl.href) await appClient.navigate(targetUrl.href);
    await appClient.focus();
    return;
  }

  await self.clients.openWindow(targetUrl.href);
}

async function updateNotificationJob(jobId, actionToken, shouldSnooze, attempt = 0) {
  if (!jobId || typeof actionToken !== 'string' || actionToken.length === 0) {
    console.warn('ahead: 알림 상태를 갱신할 정보가 부족합니다.');
    return;
  }

  try {
    const response = await fetch(
      `/api/notifications/jobs/${encodeURIComponent(String(jobId))}/${shouldSnooze ? 'snooze' : 'ack'}`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: actionToken }),
        signal: AbortSignal.timeout(8_000),
      },
    );

    if (!response.ok) {
      if (response.status === 409 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
        return updateNotificationJob(jobId, actionToken, shouldSnooze, attempt + 1);
      }
      console.warn(`ahead: 알림 상태 갱신에 실패했습니다 (${response.status}).`);
      return false;
    }

    const result = await response.json();
    if (!result || typeof result !== 'object' || !result.job) {
      console.warn('ahead: 알림 상태 응답을 확인할 수 없습니다.');
      return;
    }

    const windowClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    for (const client of windowClients) {
      if (new URL(client.url).origin === self.location.origin) {
        client.postMessage({ type: 'ahead:notification-job-updated', job: result.job });
      }
    }
    return true;
  } catch {
    console.warn('ahead: 알림 상태 갱신 요청을 완료하지 못했습니다.');
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const jobId = data.jobId ?? data.job_id;
  const actionToken = data.actionToken ?? data.action_token;
  const shouldSnooze = event.action === 'snooze-10';
  // Opening the notification leaves explicit confirm/snooze choices available in the app.
  const shouldAcknowledge = event.action === 'ack';

  event.waitUntil(
    (async () => {
      const ok = shouldSnooze || shouldAcknowledge
        ? await updateNotificationJob(jobId, actionToken, shouldSnooze) : true;
      const target = new URL(data.url || DEFAULT_URL, self.location.origin);
      if (!ok) target.searchParams.set('pushActionFailed', '1');
      await focusOrOpenApp(target.href);
    })(),
  );
});
