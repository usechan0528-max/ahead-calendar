import { createSchedulerHeaders, SCHEDULER_PATH } from '../../lib/scheduler-auth';

interface SchedulerEnv {
  SCHEDULER_SECRET: string;
  SITES_BEARER_TOKEN: string;
}

const SITE_ORIGIN = 'https://ahead-calendar-kr-prototype.dldydcks0528.chatgpt.site';

export default {
  fetch() {
    return new Response('Not found', { status: 404 });
  },
  async scheduled(_controller, env) {
    if (!env.SCHEDULER_SECRET || !env.SITES_BEARER_TOKEN) throw new Error('Scheduler secrets are not configured.');
    let stage = 'signing';
    let status = 0;
    try {
      const signedHeaders = await createSchedulerHeaders(env.SCHEDULER_SECRET);
      stage = 'request';
      const response = await fetch(`${SITE_ORIGIN}${SCHEDULER_PATH}`, {
        method: 'POST',
        headers: {
          ...signedHeaders,
          'OAI-Sites-Authorization': `Bearer ${env.SITES_BEARER_TOKEN}`,
          accept: 'application/json',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(25_000),
      });
      status = response.status;
      stage = 'response';
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
        throw new Error(`Scheduler endpoint returned HTTP ${response.status}.`);
      }
      stage = 'payload';
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) {
        throw new Error('Scheduler endpoint did not confirm completion.');
      }
      console.log(JSON.stringify({ event: 'ahead.cron.completed' }));
    } catch {
      // Never log headers, tokens, signed requests, or endpoint response bodies.
      console.error(JSON.stringify({ event: 'ahead.cron.failed', stage, status }));
      throw new Error('Scheduled notification dispatch failed.');
    }
  },
} satisfies ExportedHandler<SchedulerEnv>;
