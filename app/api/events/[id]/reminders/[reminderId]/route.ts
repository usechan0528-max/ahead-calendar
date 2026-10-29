import { getOwnerId } from '@/app/api/owner';
import { isValidReminderOffset, parsePositiveId, readJsonObject } from '@/app/api/input';
import { changeReminderRule } from '@/db/customization';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string; reminderId: string }> };

async function change(request: Request, context: Context, remove: boolean) {
  const ownerId = await getOwnerId();
  if (!ownerId) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
  const params = await context.params;
  const eventId = parsePositiveId(params.id);
  const reminderId = parsePositiveId(params.reminderId);
  const body = remove ? null : await readJsonObject(request);
  if (!eventId || !reminderId || (!remove && !isValidReminderOffset(body?.offsetMinutes))) {
    return Response.json({ error: 'Invalid reminder data.' }, { status: 400 });
  }
  const result = await changeReminderRule(ownerId, eventId, reminderId, remove ? null : body!.offsetMinutes as number);
  if (result.status === 'not_found') return Response.json({ error: 'Reminder not found.' }, { status: 404 });
  if (result.status === 'duplicate') return Response.json({ error: 'This reminder time already exists.' }, { status: 409 });
  return Response.json({ reminders: result.reminders });
}

export const PATCH = (request: Request, context: Context) => change(request, context, false);
export const DELETE = (request: Request, context: Context) => change(request, context, true);
