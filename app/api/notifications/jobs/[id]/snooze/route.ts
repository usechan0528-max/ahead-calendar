import { getNotificationActionOwners } from '@/app/api/notifications/action-owners';
import { snoozeNotificationJob, getSchedulerHealth } from '@/db/notifications';
import { parseSnoozeBody } from '@/lib/user-journey';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId < 1) {
    return Response.json({ error: 'Invalid notification job.' }, { status: 400 });
  }

  const bodyText = await request.clone().text();
  const owners = await getNotificationActionOwners(request, jobId);
  if (owners.length === 0) {
    return Response.json({ error: 'Sign-in or a valid action token is required.' }, { status: 401 });
  }
  const minutes = parseSnoozeBody(bodyText);
  if (minutes === null) return Response.json({ error: '다시 알릴 시간은 10·30·60분 중 선택해 주세요.' }, { status: 400 });
  if (!(await getSchedulerHealth()).ready) {
    return Response.json({ error: '예약 알림 연결이 필요해요.' }, { status: 503 });
  }

  let result = await snoozeNotificationJob(owners[0], jobId, new Date(), minutes);
  if (!result.ok && result.reason === 'not_found' && owners[1]) {
    result = await snoozeNotificationJob(owners[1], jobId, new Date(), minutes);
  }
  if (!result.ok) {
    return Response.json(
      {
        error:
          result.reason === 'not_found'
            ? 'Notification job not found.'
            : 'Notification job cannot be snoozed in its current state.',
      },
      { status: result.reason === 'not_found' ? 404 : 409 },
    );
  }

  return Response.json({ job: result.job }, { headers: { 'Cache-Control': 'no-store' } });
}
