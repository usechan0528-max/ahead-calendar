import { getNotificationActionOwners } from '@/app/api/notifications/action-owners';
import { acknowledgeNotificationJob } from '@/db/notifications';

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

  const owners = await getNotificationActionOwners(request, jobId);
  if (owners.length === 0) {
    return Response.json({ error: 'Sign-in or a valid action token is required.' }, { status: 401 });
  }

  let result = await acknowledgeNotificationJob(owners[0], jobId);
  if (!result.ok && result.reason === 'not_found' && owners[1]) {
    result = await acknowledgeNotificationJob(owners[1], jobId);
  }
  if (!result.ok) {
    return Response.json(
      {
        error:
          result.reason === 'not_found'
            ? 'Notification job not found.'
            : 'Notification job cannot be acknowledged in its current state.',
      },
      { status: result.reason === 'not_found' ? 404 : 409 },
    );
  }

  return Response.json({ job: result.job }, { headers: { 'Cache-Control': 'no-store' } });
}
