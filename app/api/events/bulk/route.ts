import { env } from 'cloudflare:workers';
import { getOwnerId } from '@/app/api/owner';
import { listEvents } from '@/db/events';
import { changeBulkCategory, deleteBulkEvent, shiftBulkEvent, readBulkShiftBlockedIds } from '@/db/bulk-events';
import { readOccurrenceCompletion, readProgress, setOccurrenceCompletion, ProgressError } from '@/db/progress';
import { parseBulkRequest, type BulkResult } from '@/lib/bulk-events';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, oai-authenticated-user-id' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
async function accountScope(owner: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`to-j-bulk-v1\u0000${owner}`));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function GET() {
  const owner = await getOwnerId();
  if (!owner) return json({ error: '로그인이 필요해요.' }, 401);
  try {
    const [events, progress, scope, shiftBlockedIds] = await Promise.all([listEvents(owner), readProgress(env.DB, owner), accountScope(owner), readBulkShiftBlockedIds(owner)]);
    return json({ events, completedEvents: progress.completedEvents, scope, shiftBlockedIds });
  } catch { console.error('bulk.read_failed'); return json({ error: '일정을 불러오지 못했어요. 다시 시도해 주세요.' }, 503); }
}

export async function POST(request: Request) {
  const owner = await getOwnerId();
  if (!owner) return json({ error: '로그인이 필요해요.' }, 401);
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('x-toj-bulk') !== '1'
    || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: '허용되지 않은 요청이에요.' }, 403);
  if (request.headers.get('x-toj-bulk-account') !== await accountScope(owner)) return json({ error: '로그인 계정이 바뀌었어요. 일정을 새로 불러와 주세요.' }, 409);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'JSON 형식으로 요청해 주세요.' }, 415);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: '일정을 선택해 주세요.' }, 400);
  let raw: unknown;
  try {
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return json({ error: '한 번에 최대 20개를 선택해 주세요.' }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { return json({ error: '입력 내용을 확인해 주세요.' }, 400); }
  finally { reader.releaseLock(); }
  const input = parseBulkRequest(raw);
  if (!input) return json({ error: '선택한 일정과 변경 내용을 확인해 주세요. 한 번에 최대 20개까지 가능해요.' }, 400);
  let events;
  try { events = await listEvents(owner); }
  catch { return json({ error: '일정을 확인하지 못했어요. 변경하지 않았어요.' }, 503); }
  const results: BulkResult[] = [];
  // Per-event transactions permit useful partial success. Always report each target;
  // never retry ambiguous writes or claim a cross-event all-or-nothing transaction.
  for (const target of input.targets) {
    const event = events.find(item => item.id === target.id);
    const fail = (message: string) => results.push({ id: target.id, status: 'failed', message });
    if (!event) { fail('삭제되었거나 접근할 수 없는 일정이에요.'); continue; }
    if (event.notification_revision !== target.revision) { fail('일정이 변경됐어요. 새로 불러온 뒤 다시 선택해 주세요.'); continue; }
    if (input.action === 'complete' || input.action === 'pending') {
      try {
        const occurrence = await readOccurrenceCompletion(env.DB, owner, event.id, target.date!);
        if (occurrence.complete === (input.action === 'complete')) {
          results.push({ id: target.id, status: 'success' }); continue;
        }
        if (input.action === 'complete' && !occurrence.canCompleteEvent) { fail('시작 전 일정은 아직 완료할 수 없어요.'); continue; }
      } catch (error) { fail(error instanceof ProgressError ? error.message : '완료 상태를 확인하지 못했어요.'); continue; }
    }
    try {
      if (input.action === 'complete' || input.action === 'pending') {
        await setOccurrenceCompletion(env.DB, owner, event.id, target.date!, 'event', 0, input.action === 'complete', new Date(), target.revision);
      } else if (input.action === 'shift') {
        const result = await shiftBulkEvent(owner, event, input.days!);
        if (result !== 'success') {
          fail(result === 'repeating' ? '반복 일정은 상세 화면에서 회차별 날짜를 변경해 주세요.' : result === 'range'
            ? '이동할 날짜가 지원 범위를 벗어나요.' : '실천 기록이 있거나 일정이 변경됐어요. 날짜는 이동하지 않았어요.'); continue;
        }
      } else {
        const changed = input.action === 'delete' ? await deleteBulkEvent(owner, event) : await changeBulkCategory(owner, event, input.category!);
        if (!changed) { fail('일정이 변경됐어요. 새로 불러온 뒤 다시 선택해 주세요.'); continue; }
      }
      results.push({ id: target.id, status: 'success' });
    } catch {
      console.error('bulk.item_outcome_unknown');
      results.push({ id: target.id, status: 'unknown', message: '저장 결과를 확인하지 못했어요. 새로 불러와 확인해 주세요.' });
    }
  }
  return json({ results });
}
