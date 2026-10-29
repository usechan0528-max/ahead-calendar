import { getOwnerId } from '@/app/api/owner';
import { deleteEvent, listEvents, updateEvent } from '@/db/events';
import { parsePositiveId, readJsonObject } from '@/app/api/input';
import { parseEventInput } from '@/lib/event-input';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getOwnerId();
  if (!ownerId) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
  const eventId = parsePositiveId((await params).id);
  const body = await readJsonObject(request);
  if (!eventId || !body) return Response.json({ error: 'Invalid event data.' }, { status: 400 });
  const existing = (await listEvents(ownerId)).find((event) => event.id === eventId);
  if (!existing) return Response.json({ error: 'Event not found.' }, { status: 404 });
  if (body.revision === undefined) return Response.json({ error: '새로고침한 뒤 일정을 다시 열어 주세요. 이전 화면의 변경은 저장하지 않았어요.' }, { status: 428 });
  if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0) return Response.json({ error: 'Invalid revision.' }, { status: 400 });
  if (body.revision !== existing.notification_revision) return Response.json({ error: '다른 화면에서 일정이 변경되었어요. 입력한 내용을 확인한 뒤 편집창을 닫고 새로고침해 주세요. 기존 변경은 덮어쓰지 않았어요.' }, { status: 409 });
  // Older clients do not know duration fields; keep them unless explicitly changed.
  const input = parseEventInput(body, existing);
  if (!input) return Response.json({ error: 'Invalid event data.' }, { status: 400 });
  if (existing.occurrenceOverrides.length && (input.eventDate !== existing.event_date || input.recurrence !== existing.recurrence
    || input.recurrenceInterval !== existing.recurrence_interval || input.recurrenceDay !== existing.recurrence_day)) {
    return Response.json({ error: '회차별 변경이 있는 일정은 시작일과 반복 규칙을 바꿀 수 없어요. 종료일은 변경할 수 있어요.' }, { status: 409 });
  }
  if (!await updateEvent(ownerId, eventId, input, body.revision as number)) return Response.json({ error: '일정이 변경되었어요. 새로고침 후 다시 시도해 주세요.' }, { status: 409 });
  return Response.json({ event: (await listEvents(ownerId)).find((event) => event.id === eventId) });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getOwnerId();
  if (!ownerId) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
  const eventId = parsePositiveId((await params).id);
  if (!eventId) return Response.json({ error: 'Invalid event.' }, { status: 400 });
  if (!await deleteEvent(ownerId, eventId)) return Response.json({ error: 'Event not found.' }, { status: 404 });
  return new Response(null, { status: 204 });
}
