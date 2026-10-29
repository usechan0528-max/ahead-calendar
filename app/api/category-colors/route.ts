import { getOwnerId } from '@/app/api/owner';
import { readJsonObject } from '@/app/api/input';
import { readCategoryColors, saveCategoryColor } from '@/db/category-colors';
import { parseEventCategory } from '@/lib/event-category';
import { parseCategoryColor } from '@/lib/design-tokens';

export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'no-store' };
export async function GET() {
  const owner = await getOwnerId();
  if (!owner) return Response.json({ error: '로그인이 필요해요.' }, { status: 401, headers });
  try { return Response.json({ colors: await readCategoryColors(owner) }, { headers }); }
  catch { console.error('category_colors.read_failed'); return Response.json({ error: '색상 설정을 불러오지 못했어요. 다시 시도해 주세요.' }, { status: 503, headers }); }
}
export async function PATCH(request: Request) {
  const owner = await getOwnerId();
  if (!owner) return Response.json({ error: '로그인이 필요해요.' }, { status: 401, headers });
  const body = await readJsonObject(request);
  const category = parseEventCategory(body?.category);
  const color = body?.color === null ? null : parseCategoryColor(body?.color);
  if (!category || (body?.color !== null && !color)) return Response.json({ error: '종류 이름과 색상을 확인해 주세요.' }, { status: 400, headers });
  try {
    await saveCategoryColor(owner, category, color);
    return Response.json({ category, color }, { headers });
  } catch { console.error('category_colors.save_failed'); return Response.json({ error: '색상을 저장하지 못했어요. 다시 시도해 주세요.' }, { status: 503, headers }); }
}
