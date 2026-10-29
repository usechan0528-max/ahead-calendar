import { getOwnerId } from '@/app/api/owner';
import { parsePositiveId, readJsonObject } from '@/app/api/input';
import { getRecommendations, changeRecommendation, type RecommendationAction } from '@/db/recommendations';
import { isRecommendationProfile } from '@/lib/preparation-recommendations';

export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  const owner = await getOwnerId();
  if (!owner) return json({ error: '로그인이 필요해요.' }, 401);
  const id = parsePositiveId((await params).id);
  if (!id) return json({ error: '일정을 확인해 주세요.' }, 400);
  try {
    const snapshot = await getRecommendations(owner, id);
    return snapshot ? json({ snapshot }) : json({ error: '일정을 찾지 못했어요.' }, 404);
  } catch (error) {
    console.error({ event: 'recommendations.read_failed', errorType: error instanceof Error ? error.name : 'UnknownError' });
    return json({ error: '추천을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' }, 503);
  }
}
export async function POST(request: Request, { params }: Context) {
  const owner = await getOwnerId();
  if (!owner) return json({ error: '로그인이 필요해요.' }, 401);
  const id = parsePositiveId((await params).id);
  const body = await readJsonObject(request);
  if (!id || !body || typeof body.token !== 'string' || body.token.length > 120) return json({ error: '추천 정보를 다시 확인해 주세요.' }, 400);
  if ('timing' in body && (body.action !== 'adopt' || typeof body.timing !== 'string' || body.timing.trim().length < 1 || body.timing.trim().length > 60)) return json({ error: '준비 시점 메모는 1~60자로 입력해 주세요.' }, 400);
  let action: RecommendationAction;
  if (body.action === 'profile' && isRecommendationProfile(body.profile)) action = { action: 'profile', profile: body.profile, token: body.token };
  else if (body.action === 'restore') action = { action: 'restore', token: body.token };
  else if ((body.action === 'adopt' || body.action === 'dismiss') && typeof body.ruleId === 'string' && /^[a-z-]{1,60}$/.test(body.ruleId)) action = { action: body.action, ruleId: body.ruleId, token: body.token, ...(typeof body.timing === 'string' ? { timing: body.timing.trim() } : {}) };
  else return json({ error: '지원하지 않는 추천 설정이에요.' }, 400);
  try {
    const result = await changeRecommendation(owner, id, action);
    if (result.status === 'not_found') return json({ error: '일정을 찾지 못했어요.' }, 404);
    if (result.status === 'invalid') return json({ error: '이 일정에 없는 추천이에요.' }, 400);
    if (result.status === 'disabled') return json({ error: '준비 항목이 꺼진 일정이에요. 필요하면 일정에서 다시 켜 주세요.', snapshot: result.snapshot }, 409);
    if (result.status === 'stale') return json({ error: '일정이나 추천 설정이 바뀌었어요. 새로 불러온 뒤 다시 선택해 주세요.', snapshot: result.snapshot }, 409);
    if (result.status === 'unavailable') return json({ error: '숨기거나 삭제한 추천이에요. 추천을 새로 불러와 주세요.', snapshot: result.snapshot }, 409);
    return json(result);
  } catch (error) {
    console.error({ event: 'recommendations.write_failed', errorType: error instanceof Error ? error.name : 'UnknownError' });
    return json({ error: '변경 결과를 확인하지 못했어요. 새로 불러온 뒤 다시 시도해 주세요.' }, 503);
  }
}
