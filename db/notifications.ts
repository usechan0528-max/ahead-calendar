import {
  buildPushPayload,
  type PushMessage,
  type PushSubscription,
} from '@block65/webcrypto-web-push';
import { env as runtimeEnv } from 'cloudflare:workers';
import { ensureEventSchema } from './events';
import { cancelObsoleteReminders, currentReminderSql, materializeReminders, REMINDER_MAX_LATENESS_MS } from './reminder-planner';
import { attemptHistorySql } from './notification-history';
import { isSnoozeMinutes, notificationDestination, type SnoozeMinutes } from '../lib/user-journey';

const MAX_DELIVERY_ATTEMPTS = 3;
const MAX_CLAIM_BATCH = 20;
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;
const PUSH_FETCH_TIMEOUT_MS = 15 * 1000;
const RETRY_DELAYS_MS = [5 * 60 * 1000, 15 * 60 * 1000] as const;
const MAX_ERROR_LENGTH = 500;
const ACTION_TOKEN_VERSION = 'v1';
const ACTION_TOKEN_CONTEXT = 'ahead-notification-action';

export type NotificationJobStatus =
  | 'scheduled'
  | 'processing'
  | 'sent'
  | 'failed'
  | 'unconfirmed'
  | 'cancelled'
  | 'acked';

export type PushSubscriptionInput = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export type StoredPushSubscription = {
  id: number;
  endpoint: string;
  expiration_time: number | null;
  created_at: string;
  updated_at: string;
  last_success_at: string | null;
  failure_count: number;
  disabled_at: string | null;
  reminders_enabled_at: string | null;
};

export type StoredNotificationJob = {
  id: number;
  event_id: number;
  subscription_id: number;
  kind: string;
  title: string;
  body: string;
  scheduled_for: string;
  status: NotificationJobStatus;
  attempt_count: number;
  sent_at: string | null;
  acked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  original_occurrence_date?: string | null;
  reminder_offset_minutes?: number | null;
};

type ClaimedNotificationJob = StoredNotificationJob & {
  original_occurrence_date: string | null;
  owner_id: string;
  claimed_at: string;
  endpoint: string;
  expiration_time: number | null;
  p256dh: string;
  auth: string;
  preparations_enabled?: number;
  event_location?: string;
};

export type ScheduleTestResult =
  | { ok: true; job: StoredNotificationJob }
  | {
      ok: false;
      reason: 'event_not_found' | 'subscription_not_found' | 'idempotency_conflict';
    };

export type JobActionResult =
  | { ok: true; job: StoredNotificationJob }
  | { ok: false; reason: 'not_found' | 'not_actionable' };

export type NotificationProcessingSummary = {
  due: number;
  accepted: number;
  retried: number;
  failed: number;
};

// Production schema is applied by the checked-in Drizzle migrations.
export async function ensureNotificationSchema(d1: D1Database = runtimeEnv.DB) {
  if (!d1) throw new Error('The notification database is unavailable.');
}

export async function getSchedulerHealth(d1: D1Database = runtimeEnv.DB) {
  const state = await d1.prepare(
    "SELECT last_completed_at FROM notification_scheduler_state WHERE id = 1",
  ).first<{ last_completed_at: string }>();
  const age = state ? Date.now() - Date.parse(state.last_completed_at) : Infinity;
  return { ready: age >= 0 && age < 180_000, lastCompletedAt: state?.last_completed_at ?? null };
}

export async function recordSchedulerHeartbeat(d1: D1Database) {
  await d1.prepare(
    "INSERT INTO notification_scheduler_state (id, last_completed_at) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET last_completed_at = excluded.last_completed_at",
  ).bind(new Date().toISOString()).run();
}

export async function upsertPushSubscription(
  ownerId: string,
  input: PushSubscriptionInput,
  userAgent: string,
): Promise<StoredPushSubscription> {
  await ensureEventSchema();
  await ensureNotificationSchema();

  const now = new Date().toISOString();
  const existing = await runtimeEnv.DB.prepare(
    `SELECT id, owner_id
     FROM push_subscriptions
     WHERE endpoint = ?`,
  )
    .bind(input.endpoint)
    .first<{ id: number; owner_id: string }>();

  if (existing && existing.owner_id !== ownerId) {
    await runtimeEnv.DB.prepare(
      `UPDATE notification_jobs
       SET lifetime_attempt_count = ${attemptHistorySql()}, status = 'failed',
           claimed_at = NULL,
           last_error = 'Push subscription moved to another account.',
           updated_at = ?
       WHERE subscription_id = ?
         AND owner_id = ?
         AND status IN ('scheduled', 'processing')`,
    )
      .bind(now, existing.id, existing.owner_id)
      .run();
  }

  await runtimeEnv.DB.prepare(
    `INSERT INTO push_subscriptions (
       owner_id, endpoint, expiration_time, p256dh, auth, user_agent,
       created_at, updated_at, failure_count, disabled_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
     ON CONFLICT(endpoint) DO UPDATE SET
       owner_id = excluded.owner_id,
       expiration_time = excluded.expiration_time,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       reminders_enabled_at = CASE WHEN push_subscriptions.owner_id = excluded.owner_id
         AND push_subscriptions.disabled_at IS NULL THEN push_subscriptions.reminders_enabled_at ELSE NULL END,
       user_agent = excluded.user_agent,
       updated_at = excluded.updated_at,
       failure_count = 0,
       disabled_at = NULL`,
  )
    .bind(
      ownerId,
      input.endpoint,
      input.expirationTime,
      input.keys.p256dh,
      input.keys.auth,
      userAgent.slice(0, 500),
      now,
      now,
    )
    .run();

  const subscription = await runtimeEnv.DB.prepare(
    `SELECT id, endpoint, expiration_time, created_at, updated_at,
            last_success_at, failure_count, disabled_at, reminders_enabled_at
     FROM push_subscriptions
     WHERE endpoint = ? AND owner_id = ?`,
  )
    .bind(input.endpoint, ownerId)
    .first<StoredPushSubscription>();

  if (!subscription) throw new Error('The push subscription could not be saved.');
  return subscription;
}

export async function listPushDevices(ownerId: string) {
  const result = await runtimeEnv.DB.prepare(`SELECT id, endpoint, reminders_enabled_at, disabled_at
    FROM push_subscriptions WHERE owner_id = ? ORDER BY updated_at DESC, id DESC LIMIT 100`)
    .bind(ownerId).all<Pick<StoredPushSubscription, 'id' | 'endpoint' | 'reminders_enabled_at' | 'disabled_at'>>();
  return result.results;
}

export async function setDeviceReminders(ownerId: string, subscriptionId: number, enabled: boolean) {
  const now = new Date();
  const result = await runtimeEnv.DB.batch([
    runtimeEnv.DB.prepare(`UPDATE push_subscriptions SET reminders_enabled_at =
      CASE WHEN ? = 1 THEN COALESCE(reminders_enabled_at, ?) ELSE NULL END, updated_at = ?
      WHERE id = ? AND owner_id = ? AND disabled_at IS NULL
        AND (expiration_time IS NULL OR expiration_time > ?)`)
      .bind(Number(enabled), now.toISOString(), now.toISOString(), subscriptionId, ownerId, now.getTime()),
    runtimeEnv.DB.prepare(`UPDATE notification_jobs SET lifetime_attempt_count = ${attemptHistorySql()}, status = 'cancelled', claimed_at = NULL,
      updated_at = ?, last_error = 'Automatic reminders disabled on this device.'
      WHERE subscription_id = ? AND owner_id = ? AND kind = 'reminder'
        AND status IN ('scheduled', 'processing') AND ? = 0`)
      .bind(now.toISOString(), subscriptionId, ownerId, Number(enabled)),
  ]);
  if (Number(result[0].meta.changes) !== 1) return null;
  if (enabled) {
    try { await materializeReminders(runtimeEnv.DB, now, { ownerId }); }
    catch { console.error(JSON.stringify({ event: 'ahead.reminder.planning.deferred' })); }
  }
  return (await listPushDevices(ownerId)).find((device) => device.id === subscriptionId) ?? null;
}

export async function scheduleTestNotification(
  ownerId: string,
  eventId: number,
  subscriptionId?: number,
  idempotencyKey = crypto.randomUUID(),
  now = new Date(),
  delayMs = 120_000,
): Promise<ScheduleTestResult> {
  await ensureEventSchema();
  await ensureNotificationSchema();
  // A client-controlled key must never occupy another owner's or a reminder's identity.
  const keyBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
    JSON.stringify(['test', ownerId, eventId, idempotencyKey]),
  ));
  idempotencyKey = 'test:' + Array.from(new Uint8Array(keyBytes), (byte) => byte.toString(16).padStart(2, '0')).join('');

  const event = await runtimeEnv.DB.prepare(
    `SELECT id, title
     FROM events
     WHERE id = ? AND owner_id = ?`,
  )
    .bind(eventId, ownerId)
    .first<{ id: number; title: string }>();
  if (!event) return { ok: false, reason: 'event_not_found' };

  const existingJob = await getNotificationJobByIdempotencyKey(
    ownerId,
    eventId,
    idempotencyKey,
  );
  if (existingJob) return { ok: true, job: existingJob };

  const subscription = subscriptionId
    ? await runtimeEnv.DB.prepare(
        `SELECT id, expiration_time
         FROM push_subscriptions
         WHERE id = ? AND owner_id = ? AND disabled_at IS NULL`,
      )
        .bind(subscriptionId, ownerId)
        .first<{ id: number; expiration_time: number | null }>()
    : await runtimeEnv.DB.prepare(
        `SELECT id, expiration_time
         FROM push_subscriptions
         WHERE owner_id = ? AND disabled_at IS NULL
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
      )
        .bind(ownerId)
        .first<{ id: number; expiration_time: number | null }>();

  if (!subscription || isExpired(subscription.expiration_time, now)) {
    if (subscription) {
      await disableSubscription(
        runtimeEnv.DB,
        ownerId,
        subscription.id,
        now.toISOString(),
        'Push subscription expired.',
      );
    }
    return { ok: false, reason: 'subscription_not_found' };
  }

  const scheduledFor = new Date(now.getTime() + delayMs).toISOString();
  const createdAt = now.toISOString();
  const insert = await runtimeEnv.DB.prepare(
    `INSERT OR IGNORE INTO notification_jobs (
       owner_id, event_id, subscription_id, kind, title, body, scheduled_for,
       status, attempt_count, idempotency_key, created_at, updated_at
     ) VALUES (?, ?, ?, 'test', ?, ?, ?, 'scheduled', 0, ?, ?, ?)`,
  )
    .bind(
      ownerId,
      event.id,
      subscription.id,
      'Ahead 테스트 알림',
      `“${event.title}” 일정의 예약 알림이 정상적으로 도착했어요.`,
      scheduledFor,
      idempotencyKey,
      createdAt,
      createdAt,
    )
    .run();

  const job =
    Number(insert.meta.changes) === 1
      ? await getNotificationJob(ownerId, Number(insert.meta.last_row_id))
      : await getNotificationJobByIdempotencyKey(ownerId, eventId, idempotencyKey);
  if (!job) return { ok: false, reason: 'idempotency_conflict' };
  return { ok: true, job };
}

async function getNotificationJobByIdempotencyKey(
  ownerId: string,
  eventId: number,
  idempotencyKey: string,
) {
  return runtimeEnv.DB.prepare(
    `SELECT id, event_id, subscription_id, kind, title, body, scheduled_for,
            status, attempt_count, sent_at, acked_at, last_error, created_at, updated_at
     FROM notification_jobs
     WHERE owner_id = ? AND event_id = ? AND idempotency_key = ?`,
  )
    .bind(ownerId, eventId, idempotencyKey)
    .first<StoredNotificationJob>();
}

export async function getNotificationJob(
  ownerId: string,
  jobId: number,
): Promise<StoredNotificationJob | null> {
  await ensureNotificationSchema();
  return runtimeEnv.DB.prepare(
    `SELECT id, event_id, subscription_id, kind, title, body, scheduled_for,
            status, attempt_count, sent_at, acked_at, last_error, created_at, updated_at,
            COALESCE(original_occurrence_date, date(occurrence_at, '+9 hours')) AS original_occurrence_date, reminder_offset_minutes
     FROM notification_jobs
     WHERE id = ? AND owner_id = ?`,
  )
    .bind(jobId, ownerId)
    .first<StoredNotificationJob>();
}

export async function acknowledgeNotificationJob(
  ownerId: string,
  jobId: number,
  now = new Date(),
): Promise<JobActionResult> {
  await ensureNotificationSchema();
  const current = await getNotificationJob(ownerId, jobId);
  if (!current) return { ok: false, reason: 'not_found' };
  if (current.status === 'acked') return { ok: true, job: current };
  if (current.status !== 'sent' && current.status !== 'unconfirmed') return { ok: false, reason: 'not_actionable' };

  const timestamp = now.toISOString();
  const update = await runtimeEnv.DB.prepare(
    `UPDATE notification_jobs
     SET lifetime_attempt_count = ${attemptHistorySql()}, status = 'acked', acked_at = ?, updated_at = ?
     WHERE id = ? AND owner_id = ? AND status IN ('sent', 'unconfirmed')`,
  )
    .bind(timestamp, timestamp, jobId, ownerId)
    .run();
  if (Number(update.meta.changes) !== 1) {
    const latest = await getNotificationJob(ownerId, jobId);
    return latest?.status === 'acked'
      ? { ok: true, job: latest }
      : { ok: false, reason: latest ? 'not_actionable' : 'not_found' };
  }

  const job = await getNotificationJob(ownerId, jobId);
  if (!job) return { ok: false, reason: 'not_found' };
  return { ok: true, job };
}

export async function snoozeNotificationJob(
  ownerId: string,
  jobId: number,
  now = new Date(),
  minutes: SnoozeMinutes = 10,
): Promise<JobActionResult> {
  if (!isSnoozeMinutes(minutes)) return { ok: false, reason: 'not_actionable' };
  await ensureNotificationSchema();
  const current = await getNotificationJob(ownerId, jobId);
  if (!current) return { ok: false, reason: 'not_found' };
  if (current.status !== 'sent' && current.status !== 'unconfirmed') return { ok: false, reason: 'not_actionable' };

  const timestamp = now.toISOString();
  const scheduledFor = new Date(now.getTime() + minutes * 60 * 1000).toISOString();
  const update = await runtimeEnv.DB.prepare(
    `UPDATE notification_jobs
     SET status = 'scheduled',
         scheduled_for = ?,
         expires_at = CASE WHEN kind = 'reminder' THEN ? ELSE expires_at END,
         lifetime_attempt_count = MAX(1, ${attemptHistorySql()}),
         attempt_count = 0,
         claimed_at = NULL,
         sent_at = NULL,
         acked_at = NULL,
         last_error = NULL,
         updated_at = ?
     WHERE id = ? AND owner_id = ? AND status IN ('sent', 'unconfirmed')
       AND ${currentReminderSql()}`,
  )
    .bind(scheduledFor, new Date(Date.parse(scheduledFor) + REMINDER_MAX_LATENESS_MS).toISOString(), timestamp, jobId, ownerId)
    .run();
  if (Number(update.meta.changes) !== 1) {
    const latest = await getNotificationJob(ownerId, jobId);
    return { ok: false, reason: latest ? 'not_actionable' : 'not_found' };
  }

  const job = await getNotificationJob(ownerId, jobId);
  if (!job) return { ok: false, reason: 'not_found' };
  return { ok: true, job };
}

export async function processDueNotificationJobs(
  workerEnv: Cloudflare.Env,
  now = new Date(),
  onlyJob?: { ownerId: string; jobId: number },
): Promise<NotificationProcessingSummary> {
  assertVapidConfiguration(workerEnv);
  await cancelObsoleteReminders(workerEnv.DB, now);
  if (!onlyJob) await materializeReminders(workerEnv.DB, now);
  const jobs = await claimDueNotificationJobs(workerEnv.DB, now, onlyJob);
  const summary: NotificationProcessingSummary = {
    due: jobs.length,
    accepted: 0,
    retried: 0,
    failed: 0,
  };

  const results = await Promise.all(
    jobs.map((job) => deliverNotificationJob(workerEnv, job, now)),
  );
  for (const result of results) summary[result] += 1;
  return summary;
}

async function claimDueNotificationJobs(
  d1: D1Database,
  now: Date,
  onlyJob?: { ownerId: string; jobId: number },
): Promise<ClaimedNotificationJob[]> {
  await ensureNotificationSchema(d1);
  const nowIso = now.toISOString();
  await recoverStaleClaims(d1, now);
  await disableExpiredSubscriptions(d1, now);

  const candidates = await d1.prepare(
    `SELECT jobs.id, jobs.owner_id, jobs.event_id, jobs.subscription_id,
            jobs.kind, jobs.title, jobs.body, jobs.scheduled_for, jobs.status,
            jobs.attempt_count, jobs.sent_at, jobs.acked_at, jobs.last_error,
            jobs.created_at, jobs.updated_at, jobs.original_occurrence_date, subscriptions.endpoint,
            subscriptions.expiration_time, subscriptions.p256dh, subscriptions.auth
     FROM notification_jobs AS jobs
     INNER JOIN push_subscriptions AS subscriptions
       ON subscriptions.id = jobs.subscription_id
      AND subscriptions.owner_id = jobs.owner_id
     WHERE jobs.status = 'scheduled'
       AND (? IS NULL OR (jobs.id = ? AND jobs.owner_id = ?))
       AND jobs.scheduled_for <= ?
       AND ${currentReminderSql('jobs')}
       AND (jobs.kind <> 'reminder' OR jobs.expires_at > ?)
       AND subscriptions.disabled_at IS NULL
       AND (subscriptions.expiration_time IS NULL OR subscriptions.expiration_time > ?)
     ORDER BY jobs.scheduled_for ASC, jobs.id ASC
     LIMIT ?`,
  )
    .bind(onlyJob?.jobId ?? null, onlyJob?.jobId ?? null, onlyJob?.ownerId ?? null,
      nowIso, nowIso, now.getTime(), MAX_CLAIM_BATCH)
    .all<ClaimedNotificationJob>();

  const claimed: ClaimedNotificationJob[] = [];
  for (const candidate of candidates.results) {
    const update = await d1.prepare(
      `UPDATE notification_jobs
       SET status = 'processing',
           lifetime_attempt_count = ${attemptHistorySql()} + 1,
           attempt_count = attempt_count + 1,
           claimed_at = ?,
           updated_at = ?
       WHERE id = ?
         AND owner_id = ?
         AND status = 'scheduled'
         AND scheduled_for <= ?
         AND ${currentReminderSql()}
         AND (kind <> 'reminder' OR expires_at > ?)
         AND EXISTS (
           SELECT 1
           FROM push_subscriptions
           WHERE push_subscriptions.id = notification_jobs.subscription_id
             AND push_subscriptions.owner_id = notification_jobs.owner_id
             AND push_subscriptions.disabled_at IS NULL
         )`,
    )
      .bind(nowIso, nowIso, candidate.id, candidate.owner_id, nowIso, nowIso)
      .run();
    if (Number(update.meta.changes) === 1) {
      claimed.push({
        ...candidate,
        status: 'processing',
        attempt_count: candidate.attempt_count + 1,
        claimed_at: nowIso,
      });
    }
  }

  return claimed;
}

async function recoverStaleClaims(d1: D1Database, now: Date) {
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS).toISOString();
  const stale = await d1.prepare(
    `SELECT id, owner_id, attempt_count, claimed_at
     FROM notification_jobs
     WHERE status = 'processing'
       AND (claimed_at IS NULL OR claimed_at <= ?)
     ORDER BY id ASC
     LIMIT ?`,
  )
    .bind(staleBefore, MAX_CLAIM_BATCH)
    .all<{
      id: number;
      owner_id: string;
      attempt_count: number;
      claimed_at: string | null;
    }>();

  for (const job of stale.results) {
    await d1.prepare(
      `UPDATE notification_jobs
       SET lifetime_attempt_count = ${attemptHistorySql()}, status = ?,
           scheduled_for = ?,
           claimed_at = NULL,
           last_error = 'Delivery outcome is unknown after interruption. Not automatically resent.',
           updated_at = ?
       WHERE id = ?
         AND owner_id = ?
         AND status = 'processing'
         AND (
           claimed_at = ?
           OR (claimed_at IS NULL AND ? IS NULL)
         )`,
    )
      .bind(
        'unconfirmed',
        now.toISOString(),
        now.toISOString(),
        job.id,
        job.owner_id,
        job.claimed_at,
        job.claimed_at,
      )
      .run();
  }
}

async function disableExpiredSubscriptions(d1: D1Database, now: Date) {
  const expired = await d1.prepare(
    `SELECT id, owner_id
     FROM push_subscriptions
     WHERE disabled_at IS NULL
       AND expiration_time IS NOT NULL
       AND expiration_time <= ?
     ORDER BY id ASC
     LIMIT ?`,
  )
    .bind(now.getTime(), MAX_CLAIM_BATCH)
    .all<{ id: number; owner_id: string }>();

  for (const subscription of expired.results) {
    await disableSubscription(
      d1,
      subscription.owner_id,
      subscription.id,
      now.toISOString(),
      'Push subscription expired.',
    );
  }
}

async function readCurrentClaim(d1: D1Database, job: ClaimedNotificationJob) {
  return d1.prepare(`SELECT jobs.*, s.endpoint, s.expiration_time, s.p256dh, s.auth, e.preparations_enabled, e.location AS event_location
    FROM notification_jobs jobs
    INNER JOIN push_subscriptions s ON s.id = jobs.subscription_id AND s.owner_id = jobs.owner_id
    INNER JOIN events e ON e.id = jobs.event_id AND e.owner_id = jobs.owner_id
    WHERE jobs.id = ? AND jobs.owner_id = ? AND jobs.status = 'processing' AND jobs.claimed_at = ?
      AND s.disabled_at IS NULL AND (s.expiration_time IS NULL OR s.expiration_time > ?)
      AND ${currentReminderSql('jobs')} AND (jobs.kind <> 'reminder' OR jobs.expires_at > ?)`)
    .bind(job.id, job.owner_id, job.claimed_at, Date.now(), new Date().toISOString())
    .first<ClaimedNotificationJob>();
}

async function deliverNotificationJob(
  workerEnv: Cloudflare.Env,
  claimedJob: ClaimedNotificationJob,
  now: Date,
): Promise<'accepted' | 'retried' | 'failed'> {
  const job = await readCurrentClaim(workerEnv.DB, claimedJob);
  if (!job) return 'failed';
  const subscription: PushSubscription = {
    endpoint: job.endpoint,
    expirationTime: job.expiration_time,
    keys: { p256dh: job.p256dh, auth: job.auth },
  };

  let transportStarted = false;
  let transportAccepted = false;
  try {
    const actionToken = await createNotificationActionToken(
      workerEnv.NOTIFICATION_ACTION_SECRET!,
      job.id,
      job.owner_id,
    );
    const message: PushMessage = {
      data: {
        title: job.title,
        body: job.body,
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        tag: `ahead-job-${job.id}`,
        renotify: true,
        data: {
          jobId: job.id,
          actionToken,
          url: `/?event=${job.event_id}&notificationJob=${job.id}${job.original_occurrence_date ? `&occurrence=${encodeURIComponent(job.original_occurrence_date)}` : ''}&focus=${notificationDestination({kind: job.kind, offset: job.reminder_offset_minutes ?? null, preparationsEnabled: job.preparations_enabled !== 0, hasLocation: !!job.event_location})}`,
          ackUrl: `/api/notifications/jobs/${job.id}/ack`,
          snoozeUrl: `/api/notifications/jobs/${job.id}/snooze`,
        },
        actions: [
          { action: 'ack', title: '확인' },
          { action: 'snooze-10', title: '10분 미루기' },
        ],
      },
      options: {
        ttl: 10 * 60,
        urgency: 'high',
        topic: `ahead-${job.id}`,
      },
    };
    const payload = await buildPushPayload(message, subscription, {
      subject: workerEnv.VAPID_SUBJECT,
      publicKey: workerEnv.VAPID_PUBLIC_KEY,
      privateKey: workerEnv.VAPID_PRIVATE_KEY,
    });
    // The last pre-transport check closes the edit/disable window during signing.
    // A request already handed to a push service cannot be recalled.
    const latest = await readCurrentClaim(workerEnv.DB, job);
    if (!latest || latest.endpoint !== job.endpoint || latest.p256dh !== job.p256dh || latest.auth !== job.auth) return 'failed';
    transportStarted = true;
    const response = await fetch(subscription.endpoint, {
      ...payload,
      redirect: 'manual',
      signal: AbortSignal.timeout(PUSH_FETCH_TIMEOUT_MS),
    });

    if (response.ok) {
      transportAccepted = true;
      const accepted = await markNotificationJobAccepted(workerEnv.DB, job, now);
      return accepted ? 'accepted' : 'failed';
    }

    const error = `Push service rejected the request with HTTP ${response.status}.`;
    if (response.status === 404 || response.status === 410) {
      await markNotificationJobFailed(workerEnv.DB, job, now, error, true);
      return 'failed';
    }
    if (response.status === 429 || response.status >= 500) {
      return retryNotificationJob(workerEnv.DB, job, now, error);
    }

    await markNotificationJobFailed(workerEnv.DB, job, now, error, false);
    return 'failed';
  } catch (error) {
    if (transportStarted) {
      // A missing response or failed acceptance write is ambiguous: never resend blindly.
      await workerEnv.DB.prepare(
        `UPDATE notification_jobs SET lifetime_attempt_count = ${attemptHistorySql()}, status = 'unconfirmed', claimed_at = NULL, last_error = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND status = 'processing' AND claimed_at = ?`,
      ).bind(
        transportAccepted ? 'Push accepted; delivery record could not be completed.' : 'Push outcome unknown; not automatically resent.',
        new Date().toISOString(), job.id, job.owner_id, job.claimed_at,
      ).run();
      return transportAccepted ? 'accepted' : 'failed';
    }
    return retryNotificationJob(
      workerEnv.DB,
      job,
      now,
      error instanceof Error ? error.message : 'Unknown push delivery error.',
    );
  }
}

async function markNotificationJobAccepted(
  d1: D1Database,
  job: ClaimedNotificationJob,
  now: Date,
) {
  const timestamp = now.toISOString();
  const jobUpdate = await d1.prepare(
    `UPDATE notification_jobs
     SET lifetime_attempt_count = ${attemptHistorySql()}, status = 'sent', sent_at = ?, claimed_at = NULL, last_error = NULL, updated_at = ?
     WHERE id = ?
       AND owner_id = ?
       AND status = 'processing'
       AND claimed_at = ?`,
  )
    .bind(timestamp, timestamp, job.id, job.owner_id, job.claimed_at)
    .run();
  if (Number(jobUpdate.meta.changes) !== 1) return false;

  await d1.batch([
    d1.prepare(
      `UPDATE push_subscriptions
       SET last_success_at = ?, failure_count = 0, updated_at = ?
       WHERE id = ? AND owner_id = ?`,
    ).bind(timestamp, timestamp, job.subscription_id, job.owner_id),
    d1.prepare(
      `INSERT INTO notification_deliveries (
         owner_id, event_id, channel, kind, status, sent_at
       )
       SELECT ?, event_id, 'web-push', kind, 'accepted', ?
       FROM notification_jobs
       WHERE id = ? AND owner_id = ? AND status = 'sent'`,
    ).bind(job.owner_id, timestamp, job.id, job.owner_id),
  ]);
  return true;
}

async function retryNotificationJob(
  d1: D1Database,
  job: ClaimedNotificationJob,
  now: Date,
  error: string,
): Promise<'retried' | 'failed'> {
  const safeError = truncateError(error);
  const timestamp = now.toISOString();
  if (job.attempt_count >= MAX_DELIVERY_ATTEMPTS) {
    await markNotificationJobFailed(d1, job, now, safeError, false);
    return 'failed';
  }

  const delay = RETRY_DELAYS_MS[Math.min(job.attempt_count - 1, RETRY_DELAYS_MS.length - 1)];
  const retryAt = new Date(now.getTime() + delay).toISOString();
  const jobUpdate = await d1.prepare(
    `UPDATE notification_jobs
     SET lifetime_attempt_count = ${attemptHistorySql()}, status = 'scheduled', scheduled_for = ?, claimed_at = NULL,
         last_error = ?, updated_at = ?
     WHERE id = ?
       AND owner_id = ?
       AND status = 'processing'
       AND claimed_at = ?`,
  )
    .bind(retryAt, safeError, timestamp, job.id, job.owner_id, job.claimed_at)
    .run();
  if (Number(jobUpdate.meta.changes) !== 1) return 'failed';

  await d1.prepare(
    `UPDATE push_subscriptions
     SET failure_count = failure_count + 1, updated_at = ?
     WHERE id = ? AND owner_id = ?`,
  )
    .bind(timestamp, job.subscription_id, job.owner_id)
    .run();
  return 'retried';
}

async function markNotificationJobFailed(
  d1: D1Database,
  job: ClaimedNotificationJob,
  now: Date,
  error: string,
  shouldDisableSubscription: boolean,
) {
  const timestamp = now.toISOString();
  const safeError = truncateError(error);
  const jobUpdate = await d1.prepare(
    `UPDATE notification_jobs
     SET lifetime_attempt_count = ${attemptHistorySql()}, status = 'failed', claimed_at = NULL, last_error = ?, updated_at = ?
     WHERE id = ?
       AND owner_id = ?
       AND status = 'processing'
       AND claimed_at = ?`,
  )
    .bind(safeError, timestamp, job.id, job.owner_id, job.claimed_at)
    .run();
  if (Number(jobUpdate.meta.changes) !== 1) return false;

  await d1.prepare(
    `UPDATE push_subscriptions
     SET failure_count = failure_count + 1, updated_at = ?
     WHERE id = ? AND owner_id = ?`,
  )
    .bind(timestamp, job.subscription_id, job.owner_id)
    .run();

  if (shouldDisableSubscription) {
    await disableSubscription(
      d1,
      job.owner_id,
      job.subscription_id,
      timestamp,
      safeError,
    );
  }
  return true;
}

async function disableSubscription(
  d1: D1Database,
  ownerId: string,
  subscriptionId: number,
  timestamp: string,
  reason: string,
) {
  const safeReason = truncateError(reason);
  await d1.batch([
    d1.prepare(
      `UPDATE push_subscriptions
       SET disabled_at = ?, updated_at = ?
       WHERE id = ? AND owner_id = ? AND disabled_at IS NULL`,
    ).bind(timestamp, timestamp, subscriptionId, ownerId),
    d1.prepare(
      `UPDATE notification_jobs
       SET lifetime_attempt_count = ${attemptHistorySql()}, status = 'failed', claimed_at = NULL, last_error = ?, updated_at = ?
       WHERE subscription_id = ?
         AND owner_id = ?
         AND status IN ('scheduled', 'processing')`,
    ).bind(safeReason, timestamp, subscriptionId, ownerId),
  ]);
}

function assertVapidConfiguration(workerEnv: Cloudflare.Env): asserts workerEnv is Cloudflare.Env & {
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  NOTIFICATION_ACTION_SECRET: string;
} {
  if (
    !workerEnv.VAPID_PUBLIC_KEY ||
    !workerEnv.VAPID_PRIVATE_KEY ||
    !workerEnv.VAPID_SUBJECT ||
    !workerEnv.NOTIFICATION_ACTION_SECRET ||
    workerEnv.NOTIFICATION_ACTION_SECRET.length < 32
  ) {
    throw new Error('Web Push is not configured.');
  }
}

async function createNotificationActionToken(
  secret: string,
  jobId: number,
  ownerId: string,
) {
  const ownerPart = encodeBase64Url(new TextEncoder().encode(ownerId));
  const unsigned = `${ACTION_TOKEN_VERSION}.${jobId}.${ownerPart}`;
  const key = await importActionKey(secret, ['sign']);
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${ACTION_TOKEN_CONTEXT}:${unsigned}`),
  );
  return `${unsigned}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyNotificationActionToken(
  secret: string | undefined,
  expectedJobId: number,
  token: string,
): Promise<string | null> {
  if (!secret || secret.length < 32 || token.length > 1024) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== ACTION_TOKEN_VERSION) return null;
  if (parts[1] !== String(expectedJobId)) return null;

  try {
    const ownerBytes = decodeBase64Url(parts[2]);
    const signature = decodeBase64Url(parts[3]);
    if (ownerBytes.length < 1 || ownerBytes.length > 512 || signature.length !== 32) return null;
    const unsigned = `${parts[0]}.${parts[1]}.${parts[2]}`;
    const key = await importActionKey(secret, ['verify']);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      new TextEncoder().encode(`${ACTION_TOKEN_CONTEXT}:${unsigned}`),
    );
    if (!valid) return null;
    return new TextDecoder('utf-8', { fatal: true }).decode(ownerBytes);
  } catch {
    return null;
  }
}

function importActionKey(secret: string, usages: KeyUsage[]) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  );
}

function encodeBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url.');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function isExpired(expirationTime: number | null, now: Date) {
  return expirationTime !== null && expirationTime <= now.getTime();
}

function truncateError(error: string) {
  return error.trim().slice(0, MAX_ERROR_LENGTH) || 'Unknown push delivery error.';
}

export function isSupportedPushEndpoint(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;

  const hostname = url.hostname.toLowerCase();
  return (
    hostname === 'fcm.googleapis.com' ||
    hostname === 'updates.push.services.mozilla.com' ||
    hostname === 'web.push.apple.com' ||
    hostname.endsWith('.notify.windows.com')
  );
}
