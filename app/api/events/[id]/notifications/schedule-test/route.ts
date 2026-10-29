import { getOwnerId } from '@/app/api/owner';
import { scheduleTestNotification, getSchedulerHealth, processDueNotificationJobs, getNotificationJob } from '@/db/notifications';
import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getOwnerId();
  if (!ownerId) return Response.json({ error: 'Sign-in required.' }, { status: 401 });

  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isInteger(eventId) || eventId < 1) {
    return Response.json({ error: 'Invalid event.' }, { status: 400 });
  }

  const requestedIdempotencyKey = request.headers.get('idempotency-key');
  if (
    requestedIdempotencyKey !== null &&
    !/^[A-Za-z0-9._~:-]{8,128}$/.test(requestedIdempotencyKey)
  ) {
    return Response.json({ error: 'Invalid Idempotency-Key.' }, { status: 400 });
  }
  const idempotencyKey = requestedIdempotencyKey ?? crypto.randomUUID();

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // A subscription id is optional; the newest active subscription is the default.
  }
  const subscriptionId =
    body.subscriptionId === undefined ? undefined : Number(body.subscriptionId);
  if (
    subscriptionId !== undefined &&
    (!Number.isInteger(subscriptionId) || subscriptionId < 1)
  ) {
    return Response.json({ error: 'Invalid push subscription.' }, { status: 400 });
  }

  const immediate = body.mode === 'immediate';
  if (!immediate && !(await getSchedulerHealth()).ready) {
    return Response.json({ error: '예약 알림 연결이 아직 완료되지 않았어요. 지금 테스트는 사용할 수 있어요.', code: 'scheduler_unavailable' }, { status: 503 });
  }
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY || !env.NOTIFICATION_ACTION_SECRET) {
    return Response.json({ error: '알림 서버 설정이 필요해요.' }, { status: 503 });
  }
  const result = await scheduleTestNotification(
    ownerId,
    eventId,
    subscriptionId,
    idempotencyKey,
    new Date(),
    immediate ? 0 : 120_000,
  );
  if (!result.ok) {
    if (result.reason === 'event_not_found') {
      return Response.json({ error: 'Event not found.' }, { status: 404 });
    }
    if (result.reason === 'idempotency_conflict') {
      return Response.json(
        { error: 'Idempotency-Key is already in use for another request.' },
        { status: 409 },
      );
    }
    return Response.json({ error: 'An active push subscription is required.' }, { status: 409 });
  }

  if (immediate) {
    await processDueNotificationJobs(env, new Date(), { ownerId, jobId: result.job.id });
  }
  return Response.json(
    { job: immediate ? await getNotificationJob(ownerId, result.job.id) : result.job },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}
