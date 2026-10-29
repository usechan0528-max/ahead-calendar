import { env } from 'cloudflare:workers';
import { getOwnerId } from '@/app/api/owner';
import { parsePositiveId, readJsonObject } from '@/app/api/input';
import { ProgressError, readOccurrenceCompletion, setOccurrenceCompletion } from '@/db/progress';
import { eventAccountScope } from '@/lib/event-save';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
function failure(error: unknown) {
  if (!(error instanceof ProgressError)) console.error('toj.completion.storage.failed');
  return Response.json({ error: error instanceof ProgressError ? error.message : '완료 기록을 저장하거나 불러오지 못했어요. 다시 시도해 주세요.' }, { status: error instanceof ProgressError ? error.status : 503 });
}
export async function GET(request: Request, { params }: Context) {
  const owner = await getOwnerId();
  if (!owner) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
  const id = parsePositiveId((await params).id);
  if (!id) return Response.json({ error: 'Invalid event.' }, { status: 400 });
  try { return Response.json(await readOccurrenceCompletion(env.DB, owner, id, new URL(request.url).searchParams.get('date') ?? '')); }
  catch (error) { return failure(error); }
}
export async function PATCH(request: Request, { params }: Context) {
  const owner = await getOwnerId();
  if (!owner) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
  const id = parsePositiveId((await params).id);
  const body = await readJsonObject(request);
  if (request.headers.has('x-toj-list-checks')) {
    if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('x-toj-list-checks') !== '1'
      || request.headers.get('sec-fetch-site') === 'cross-site') return Response.json({ error: '허용되지 않은 요청이에요.' }, { status: 403 });
    if (request.headers.get('x-toj-event-account') !== await eventAccountScope(owner)) return Response.json({ error: '계정이 바뀌었어요. 새로고침해 주세요.' }, { status: 409 });
    if (!Number.isSafeInteger(body?.revision) || Number(body?.revision) < 0) return Response.json({ error: '최신 일정을 먼저 불러와 주세요.' }, { status: 428 });
  }
  if (!id || !body || typeof body.date !== 'string' || typeof body.complete !== 'boolean'
    || (body.kind !== 'event' && body.kind !== 'preparation') || (body.kind === 'preparation' && typeof body.itemId !== 'number')) {
    return Response.json({ error: '완료 항목과 날짜를 확인해 주세요.' }, { status: 400 });
  }
  try { return Response.json(await setOccurrenceCompletion(env.DB, owner, id, body.date, body.kind, body.kind === 'event' ? 0 : body.itemId as number, body.complete, new Date(), request.headers.has('x-toj-list-checks') ? body.revision as number : undefined)); }
  catch (error) { return failure(error); }
}
