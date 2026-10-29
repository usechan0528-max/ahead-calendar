import { getOwnerId } from '@/app/api/owner';
import { parsePositiveId, preparationInput, readJsonObject } from '@/app/api/input';
import { createPreparation } from '@/db/customization';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getOwnerId();
  if (!ownerId) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
  const id = parsePositiveId((await params).id);
  const input = preparationInput(await readJsonObject(request));
  if (!id || !input) return Response.json({ error: 'Invalid preparation data.' }, { status: 400 });
  const preparation = await createPreparation(ownerId, id, input);
  if (!preparation) return Response.json({ error: 'Event not found.' }, { status: 404 });
  return Response.json({ preparation }, { status: 201 });
}
