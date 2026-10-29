import { getOwnerId } from '@/app/api/owner';
import { getNotificationJob } from '@/db/notifications';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getOwnerId();
  if (!ownerId) return Response.json({ error: 'Sign-in required.' }, { status: 401 });

  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId < 1) {
    return Response.json({ error: 'Invalid notification job.' }, { status: 400 });
  }

  const job = await getNotificationJob(ownerId, jobId);
  if (!job) return Response.json({ error: 'Notification job not found.' }, { status: 404 });
  return Response.json({ job }, { headers: { 'Cache-Control': 'no-store' } });
}
