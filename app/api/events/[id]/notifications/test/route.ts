import { getOwnerId } from '@/app/api/owner';
import { recordTestDelivery } from '@/db/events';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getOwnerId();
  if (!ownerId) return Response.json({ error: 'Sign-in required.' }, { status: 401 });

  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isInteger(eventId) || eventId < 1) {
    return Response.json({ error: 'Invalid event.' }, { status: 400 });
  }

  const delivery = await recordTestDelivery(ownerId, eventId);
  if (!delivery) return Response.json({ error: 'Event not found.' }, { status: 404 });

  return Response.json({ delivery }, { status: 201 });
}
