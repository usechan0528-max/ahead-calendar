import { getOwnerId } from '@/app/api/owner';
import {
  isSupportedPushEndpoint,
  type PushSubscriptionInput,
  upsertPushSubscription,
  listPushDevices,
  setDeviceReminders,
} from '@/db/notifications';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
  return Response.json({ subscriptions: await listPushDevices(ownerId) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request: Request) {
  const ownerId = await getOwnerId();
  if (!ownerId) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || !Number.isSafeInteger(body.subscriptionId) || Number(body.subscriptionId) < 1 || typeof body.enabled !== 'boolean') {
    return Response.json({ error: 'Invalid device preference.' }, { status: 400 });
  }
  const subscription = await setDeviceReminders(ownerId, Number(body.subscriptionId), body.enabled);
  if (!subscription) return Response.json({ error: 'Active device not found.' }, { status: 404 });
  return Response.json({ subscription }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const ownerId = await getOwnerId();
  if (!ownerId) return Response.json({ error: 'Sign-in required.' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid push subscription.' }, { status: 400 });
  }

  const subscription = parsePushSubscription(body);
  if (!subscription) {
    return Response.json({ error: 'Invalid or unsupported push subscription.' }, { status: 400 });
  }

  const saved = await upsertPushSubscription(
    ownerId,
    subscription,
    request.headers.get('user-agent') ?? '',
  );
  return Response.json(
    { subscription: saved },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}

function parsePushSubscription(value: unknown): PushSubscriptionInput | null {
  if (!isRecord(value) || !isRecord(value.keys)) return null;

  const endpoint = typeof value.endpoint === 'string' ? value.endpoint.trim() : '';
  const p256dh = typeof value.keys.p256dh === 'string' ? value.keys.p256dh : '';
  const auth = typeof value.keys.auth === 'string' ? value.keys.auth : '';
  const expirationTime = value.expirationTime;

  if (
    endpoint.length < 1 ||
    endpoint.length > 4096 ||
    !isSupportedPushEndpoint(endpoint) ||
    decodedBase64UrlLength(p256dh) !== 65 ||
    decodedBase64UrlLength(auth) !== 16 ||
    !(
      expirationTime === null ||
      (typeof expirationTime === 'number' &&
        Number.isSafeInteger(expirationTime) &&
        expirationTime > 0)
    )
  ) {
    return null;
  }

  return { endpoint, expirationTime, keys: { p256dh, auth } };
}

function decodedBase64UrlLength(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return -1;
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  try {
    return atob(padded).length;
  } catch {
    return -1;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
