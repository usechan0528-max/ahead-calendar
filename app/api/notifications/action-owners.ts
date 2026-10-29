import { getOwnerId } from '@/app/api/owner';
import { verifyNotificationActionToken } from '@/db/notifications';
import { env } from 'cloudflare:workers';

export async function getNotificationActionOwners(request: Request, jobId: number) {
  const owners: string[] = [];
  const signedInOwner = await getOwnerId();
  if (signedInOwner) owners.push(signedInOwner);

  let token: string | null = null;
  try {
    const body: unknown = await request.json();
    if (typeof body === 'object' && body !== null && 'token' in body) {
      const candidate = (body as { token?: unknown }).token;
      if (typeof candidate === 'string') token = candidate;
    }
  } catch {
    // Signed-in actions remain valid without a capability token.
  }

  if (token) {
    const capabilityOwner = await verifyNotificationActionToken(
      env.NOTIFICATION_ACTION_SECRET,
      jobId,
      token,
    );
    if (capabilityOwner && !owners.includes(capabilityOwner)) owners.push(capabilityOwner);
  }
  return owners;
}
