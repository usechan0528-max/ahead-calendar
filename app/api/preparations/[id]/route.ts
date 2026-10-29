import { getOwnerId } from '@/app/api/owner';
import { updatePreparationStatus } from '@/db/events';
import { deletePreparation, editPreparation } from '@/db/customization';
import { parsePositiveId, preparationInput, readJsonObject } from '@/app/api/input';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getOwnerId();
  if (!ownerId) return Response.json({ error: 'Sign-in required.' }, { status: 401 });

  const { id } = await params;
  const preparationId = parsePositiveId(id);
  const body = await readJsonObject(request);
  if (!preparationId || !body) return Response.json({ error: 'Invalid preparation data.' }, { status: 400 });
  if ('title' in body || 'timing' in body) {
    const input = preparationInput(body);
    if (!input || 'status' in body) return Response.json({ error: 'Invalid preparation data.' }, { status: 400 });
    const preparation = await editPreparation(ownerId, preparationId, input);
    return preparation ? Response.json({ preparation }) : Response.json({ error: 'Preparation not found.' }, { status: 404 });
  }
  const status = body.status === 'complete' ? 'complete' : body.status === 'pending' ? 'pending' : null;

  if (!Number.isInteger(preparationId) || preparationId < 1 || !status) {
    return Response.json({ error: 'Invalid preparation data.' }, { status: 400 });
  }

  const updated = await updatePreparationStatus(ownerId, preparationId, status);
  if (!updated) return Response.json({ error: 'Preparation not found.' }, { status: 404 });

  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getOwnerId();
  if (!ownerId) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
  const id = parsePositiveId((await params).id);
  if (!id) return Response.json({ error: 'Invalid preparation data.' }, { status: 400 });
  return await deletePreparation(ownerId, id)
    ? new Response(null, { status: 204 }) : Response.json({ error: 'Preparation not found.' }, { status: 404 });
}
