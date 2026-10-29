import { getOwnerId } from '@/app/api/owner';
import { parsePositiveId, readJsonObject } from '@/app/api/input';
import { setPreparationsEnabled } from '@/db/events';

export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getOwnerId();
  if (!ownerId) return json({ error: '로그인이 필요해요.' }, 401);
  const id = parsePositiveId((await params).id);
  const body = await readJsonObject(request);
  if (!id || !body || typeof body.enabled !== 'boolean') return json({ error: '준비 항목 설정을 확인해 주세요.' }, 400);
  try {
    if (!await setPreparationsEnabled(ownerId, id, body.enabled)) return json({ error: '일정을 찾지 못했어요.' }, 404);
    return json({ enabled: body.enabled });
  } catch (error) {
    console.error({ event: 'preparations.settings_failed', errorType: error instanceof Error ? error.name : 'UnknownError' });
    return json({ error: '설정을 저장하지 못했어요. 다시 시도해 주세요.' }, 503);
  }
}
