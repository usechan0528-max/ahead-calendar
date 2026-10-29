import { getOwnerId } from '@/app/api/owner';
import { env } from 'cloudflare:workers';
import { getSchedulerHealth } from '@/db/notifications';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
  if (!env.VAPID_PUBLIC_KEY) {
    return Response.json({ error: 'Web Push is not configured.' }, { status: 503 });
  }

  return Response.json(
    { publicKey: env.VAPID_PUBLIC_KEY, scheduler: await getSchedulerHealth() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
