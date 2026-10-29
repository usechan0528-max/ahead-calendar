import { getOwnerId } from '@/app/api/owner';
import { addCustomReminder, ReminderPreset, updateReminderPreset } from '@/db/events';
import { isValidReminderOffset, parsePositiveId, readJsonObject } from '@/app/api/input';

export const dynamic = 'force-dynamic';

const allowedPresets = new Set<ReminderPreset>(['minimal', 'standard', 'thorough']);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getOwnerId();
  if (!ownerId) return Response.json({ error: 'Sign-in required.' }, { status: 401 });

  const { id } = await params;
  const eventId = parsePositiveId(id);
  const body = await readJsonObject(request);
  const preset = body?.preset as ReminderPreset;

  if (!eventId || !allowedPresets.has(preset)) {
    return Response.json({ error: 'Invalid reminder data.' }, { status: 400 });
  }

  const reminders = await updateReminderPreset(ownerId, eventId, preset);
  if (!reminders) return Response.json({ error: 'Event not found.' }, { status: 404 });

  return Response.json({ reminders });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getOwnerId();
  if (!ownerId) return Response.json({ error: 'Sign-in required.' }, { status: 401 });

  const { id } = await params;
  const eventId = parsePositiveId(id);
  const body = await readJsonObject(request);
  const offsetMinutes = body?.offsetMinutes;

  if (
    !eventId || !isValidReminderOffset(offsetMinutes)
  ) {
    return Response.json({ error: 'Invalid reminder data.' }, { status: 400 });
  }

  const reminders = await addCustomReminder(ownerId, eventId, offsetMinutes);
  if (!reminders) return Response.json({ error: 'Event not found.' }, { status: 404 });
  return Response.json({ reminders }, { status: 201 });
}
