import { getOwnerId } from '@/app/api/owner';
import { createEvent, listEvents, readCreationReceipt, CreationConflict } from '@/db/events';
import { readJsonObject } from '@/app/api/input';
import { parseEventInput } from '@/lib/event-input';
import { parseInitialReminderOffsets } from '@/lib/reminder-settings';
import { eventAccountScope, eventPayloadHash, isCreationRequestId } from '@/lib/event-save';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, oai-authenticated-user-id' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

export async function GET(request: Request) {
  const ownerId = await getOwnerId();
  if (!ownerId) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
  try {
    const scope = await eventAccountScope(ownerId);
    const requestId = new URL(request.url).searchParams.get('requestId');
    if (requestId !== null) {
      if (!isCreationRequestId(requestId)) return json({ error: '잘못된 저장 요청이에요.' }, 400);
      if (request.headers.get('x-toj-event-account') !== scope) return json({ error: '계정이 바뀌었어요. 새로고침 후 다시 확인해 주세요.', code: 'account_changed' }, 409);
      const receipt = await readCreationReceipt(ownerId, requestId);
      if (!receipt) return json({ state: 'missing' });
      if (!receipt.live_id) return json({ state: 'deleted', error: '이미 저장한 뒤 삭제된 일정이에요.' }, 410);
      const event = (await listEvents(ownerId)).find(item => item.id === receipt.event_id);
      if (!event) return json({ error: '저장 상태를 다시 확인해 주세요.' }, 503);
      return json({ state: 'saved', event, payloadHash: receipt.payload_hash });
    }
    return json({ events: await listEvents(ownerId), accountScope: scope });
  } catch { console.error('events.read_failed'); return json({ error: '일정을 불러오지 못했어요.' }, 503); }
}

export async function POST(request: Request) {
  const ownerId = await getOwnerId();
  if (!ownerId) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
  const body = await readJsonObject(request);
  const requestId = body?.requestId;
  if (requestId !== undefined) {
    if (!isCreationRequestId(requestId)) return json({ error: '잘못된 저장 요청이에요.' }, 400);
    if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('x-toj-event-save') !== '1'
      || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: '허용되지 않은 요청이에요.' }, 403);
    if (request.headers.get('x-toj-event-account') !== await eventAccountScope(ownerId)) return json({ error: '계정이 바뀌었어요. 새로고침 후 다시 확인해 주세요.', code: 'account_changed' }, 409);
  }
  const input = parseEventInput(body);
  if (!input) return Response.json({ error: 'Invalid event data.' }, { status: 400 });
  const offsets = body?.initialReminderOffsets === undefined ? undefined : parseInitialReminderOffsets(body.initialReminderOffsets);
  if (offsets === null) return Response.json({ error: 'Invalid initial reminders.' }, { status: 400 });
  if (body?.seedPreparations !== undefined && typeof body.seedPreparations !== 'boolean') return Response.json({ error: 'Invalid preparation choice.' }, { status: 400 });
  try {
    const seed = body?.seedPreparations === undefined ? true : body.seedPreparations as boolean;
    const receipt = typeof requestId === 'string' ? { requestId, payloadHash: await eventPayloadHash({ input, offsets: offsets ?? null, seed }) } : undefined;
    const id = await createEvent(ownerId, input, offsets, seed, receipt);
    const event = (await listEvents(ownerId)).find(item => item.id === id);
    if (!event) return json({ error: '저장 결과를 확인하지 못했어요.', code: 'save_unknown' }, 503);
    return json({ event }, 201);
  } catch (error) {
    if (error instanceof CreationConflict) return json({ error: error.message, code: error.code }, error.status);
    console.error('events.create_outcome_unknown');
    return json({ error: '저장 결과를 확인하지 못했어요. 같은 요청으로 안전하게 다시 확인할 수 있어요.', code: 'save_unknown' }, 503);
  }
}
