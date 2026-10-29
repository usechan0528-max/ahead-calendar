import { env } from 'cloudflare:workers';
import { getOwnerId } from '@/app/api/owner';
import { parsePositiveId, readJsonObject } from '@/app/api/input';
import { readStoredPlace } from '@/lib/kakao-place';
import { readTravelPlan, travelModes, travelPlanFingerprint, type TravelMode } from '@/lib/travel-plan';
import { getKakaoRoute, RouteProviderError } from '@/lib/kakao-routing';
import { getSeoulDate } from '@/lib/recurrence';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
function error(message: string, status: number, code: string) { return Response.json({ error: message, code }, { status, headers }); }

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getOwnerId();
  if (!ownerId) return error('로그인이 필요해요.', 401, 'unauthorized');
  const id = parsePositiveId((await params).id), body = await readJsonObject(request);
  if (!id || !body || !travelModes.includes(body.mode as TravelMode)) return error('이동수단을 확인해 주세요.', 400, 'invalid_input');
  const event = await env.DB.prepare('SELECT location, place_json, travel_plan_json FROM events WHERE id = ? AND owner_id = ?')
    .bind(id, ownerId).first<{ location: string; place_json: string | null; travel_plan_json: string | null }>();
  if (!event) return error('일정을 찾을 수 없어요.', 404, 'not_found');
  const destination = readStoredPlace(event.place_json, event.location);
  const plan = readTravelPlan(event.travel_plan_json, destination);
  if (!destination || !plan) return error('일정 수정에서 출발지와 도착지를 먼저 선택해 주세요.', 400, 'needs_plan');
  if (typeof body.planFingerprint !== 'string' || body.planFingerprint.length > 6000) return error('경로 정보가 올바르지 않아요.', 400, 'invalid_input');
  if (body.planFingerprint !== travelPlanFingerprint(plan, destination)) return error('다른 곳에서 일정 장소가 변경됐어요. 새로고침한 뒤 다시 조회해 주세요.', 409, 'plan_changed');
  const key = env.KAKAO_REST_API_KEY?.trim();
  if (!key) return error('경로 API 연결 준비 중이에요. 카카오맵 길찾기는 바로 사용할 수 있어요.', 503, 'not_configured');
  // Durable, atomic quota guard: at most 30 calculations per owner/KST day, 10 seconds apart.
  // Each calculation uses at most six external requests, with no automatic retries.
  const now = Date.now(), day = getSeoulDate(new Date(now));
  const reserved = await env.DB.prepare(`INSERT INTO route_request_limits (owner_id, request_day, request_count, last_request_at)
    VALUES (?, ?, 1, ?) ON CONFLICT(owner_id) DO UPDATE SET request_day = excluded.request_day,
    request_count = CASE WHEN route_request_limits.request_day = excluded.request_day THEN route_request_limits.request_count + 1 ELSE 1 END,
    last_request_at = excluded.last_request_at
    WHERE (route_request_limits.request_day != excluded.request_day OR route_request_limits.request_count < 30)
      AND route_request_limits.last_request_at <= ? RETURNING request_count`).bind(ownerId, day, now, now - 10000).first();
  if (!reserved) return error('10초 뒤 다시 시도해 주세요. 경로 조회는 하루 30회까지 가능해요.', 429, 'rate_limited');
  try {
    const route = await getKakaoRoute(plan, destination, body.mode as TravelMode, key, request.signal);
    return Response.json({ route }, { headers });
  } catch (reason) {
    const code = reason instanceof RouteProviderError ? reason.code : 'unavailable';
    const messages = {
      denied: '카카오 경로 API 권한을 확인해야 해요. 지금은 아래 카카오맵 길찾기를 이용해 주세요.',
      quota: '카카오 경로 조회 한도에 도달했어요. 아래 카카오맵에서 확인해 주세요.',
      no_route: '선택한 이동수단으로 연결되는 경로를 찾지 못했어요. 장소나 이동수단을 바꿔 보세요.',
      unavailable: '경로를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
      invalid_response: '완전한 경로 정보를 받지 못했어요. 아래 카카오맵에서 확인해 주세요.',
    };
    return error(messages[code], code === 'no_route' ? 422 : 502, code);
  }
}
