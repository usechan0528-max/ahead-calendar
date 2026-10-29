import { env } from 'cloudflare:workers';
import { getOwnerId } from '@/app/api/owner';
import { readJsonObject } from '@/app/api/input';
import { ProgressError, readProgress, setDailyGoal } from '@/db/progress';
export const dynamic = 'force-dynamic';

export async function GET() {
  const owner = await getOwnerId();
  if (!owner) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
  try { return Response.json(await readProgress(env.DB, owner)); }
  catch { console.error('toj.progress.read.failed'); return Response.json({ error: '성장 기록을 불러오지 못했어요.' }, { status: 503 }); }
}
export async function PATCH(request: Request) {
  const owner = await getOwnerId();
  if (!owner) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
  const body = await readJsonObject(request);
  if (!body || typeof body.target !== 'number') return Response.json({ error: '목표를 확인해 주세요.' }, { status: 400 });
  try { return Response.json(await setDailyGoal(env.DB, owner, body.target)); }
  catch (error) { return Response.json({ error: error instanceof ProgressError ? error.message : '목표를 저장하지 못했어요.' }, { status: error instanceof ProgressError ? error.status : 503 }); }
}
