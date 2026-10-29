import { verifySchedulerRequest } from '../lib/scheduler-auth';
import { processDueNotificationJobs, recordSchedulerHeartbeat } from './notifications';

const headers = { 'Cache-Control': 'no-store' };

export async function runScheduledNotifications(request: Request, env: Cloudflare.Env) {
  if (!env.SCHEDULER_SECRET) return Response.json({ error: 'Scheduler is not configured.' }, { status: 503, headers });
  const now = Date.now();
  const nonce = await verifySchedulerRequest(request, env.SCHEDULER_SECRET, now);
  if (!nonce) return Response.json({ error: 'Invalid scheduler authorization.' }, { status: 401, headers });

  try {
    // Retain nonces beyond the complete past/future signature validity window.
    await env.DB.prepare('DELETE FROM notification_scheduler_nonces WHERE received_at < ?').bind(now - 300_000).run();
    const claim = await env.DB.prepare(
      'INSERT OR IGNORE INTO notification_scheduler_nonces (nonce, received_at) VALUES (?, ?)',
    ).bind(nonce, now).run();
    if (Number(claim.meta.changes) !== 1) {
      return Response.json({ error: 'Scheduler request already received.' }, { status: 409, headers });
    }
    const summary = await processDueNotificationJobs(env);
    await recordSchedulerHeartbeat(env.DB);
    const completedAt = new Date().toISOString();
    console.log(JSON.stringify({ event: 'ahead.scheduler.remote.completed', completedAt, ...summary }));
    return Response.json({ ok: true, completedAt, ...summary }, { headers });
  } catch {
    console.error(JSON.stringify({ event: 'ahead.scheduler.remote.failed' }));
    return Response.json({ error: 'Scheduler processing failed.' }, { status: 503, headers });
  }
}
