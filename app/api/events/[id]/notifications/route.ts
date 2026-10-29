import { getOwnerId } from '@/app/api/owner';
import { env } from 'cloudflare:workers';
import { currentReminderSql } from '@/db/reminder-planner';

export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getOwnerId();
  if (!ownerId) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
  const { id } = await params;
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) {
    return Response.json({ error: 'Invalid event.' }, { status: 400 });
  }
  const deviceValue = new URL(request.url).searchParams.get('subscriptionId');
  const device = deviceValue === null ? null : Number(deviceValue);
  if (device !== null && (!Number.isSafeInteger(device) || device < 1)) return Response.json({ error: 'Invalid device.' }, { status: 400 });
  const job = await env.DB.prepare(
    `SELECT id, event_id, kind, status, scheduled_for, sent_at, acked_at, last_error FROM notification_jobs
      WHERE owner_id = ? AND event_id = ? AND (kind = 'test' OR status IN ('sent', 'acked', 'unconfirmed', 'failed'))
      ORDER BY id DESC LIMIT 1`,
  ).bind(ownerId, Number(id)).first();
  const nextReminder = await env.DB.prepare(`SELECT id, scheduled_for FROM notification_jobs
    WHERE owner_id = ? AND event_id = ? AND kind = 'reminder' AND status = 'scheduled'
      AND (? IS NULL OR subscription_id = ?) AND expires_at > ? AND ${currentReminderSql()}
    ORDER BY scheduled_for, id LIMIT 1`).bind(ownerId, Number(id), device, device, new Date().toISOString()).first();
  return Response.json({ job, nextReminder }, { headers: { 'Cache-Control': 'no-store' } });
}
