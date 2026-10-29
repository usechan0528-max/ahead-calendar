import { env } from 'cloudflare:workers';
import { getOwnerId } from '@/app/api/owner';
import { readJsonObject } from '@/app/api/input';
import { eventAccountScope } from '@/lib/event-save';
import { isValidEventDate } from '@/lib/recurrence';
import { readOccurrenceCompletion, ProgressError } from '@/db/progress';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, oai-authenticated-user-id' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
/** A bounded, read-only query for the visible list. Never changes completions or XP. */
export async function POST(request: Request) {
  const owner = await getOwnerId();
  if (!owner) return json({ error: '로그인이 필요해요.' }, 401);
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('x-toj-list-checks') !== '1'
    || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: '허용되지 않은 요청이에요.' }, 403);
  const scope = await eventAccountScope(owner);
  if (request.headers.get('x-toj-event-account') !== scope) return json({ error: '계정이 바뀌었어요. 새로고침해 주세요.' }, 409);
  const body = await readJsonObject(request, 4096);
  const targets = body?.targets;
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 10 || targets.some(target => !target || typeof target !== 'object'
    || !Number.isSafeInteger(target.eventId) || target.eventId < 1 || !Number.isSafeInteger(target.revision) || target.revision < 0 || typeof target.date !== 'string' || !isValidEventDate(target.date))) return json({ error: '조회할 회차를 확인해 주세요.' }, 400);
  try {
    const results = [];
    for (const target of targets) {
      try {
        const occurrence = await readOccurrenceCompletion(env.DB, owner, target.eventId, target.date);
        results.push(occurrence.revision === target.revision ? { eventId: target.eventId, date: target.date, occurrence }
          : { eventId: target.eventId, date: target.date, stale: true, error: '일정이 변경됐어요. 최신 목록을 불러와 주세요.' });
      } catch (error) { if (!(error instanceof ProgressError)) throw error; results.push({ eventId: target.eventId, date: target.date, stale: true, error: error.message }); }
    }
    return json({ scope, results });
  } catch { return json({ error: '완료 상태를 불러오지 못했어요. 다시 확인해 주세요.' }, 503); }
}
