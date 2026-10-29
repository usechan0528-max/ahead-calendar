import app from 'vinext/server/app-router-entry';
import { processDueNotificationJobs, recordSchedulerHeartbeat } from './db/notifications';
import { runScheduledNotifications } from './db/scheduler';
import { SCHEDULER_PATH } from './lib/scheduler-auth';

type WorkerEnv = Cloudflare.Env & {
  ASSETS?: Fetcher;
};

export default {
  fetch(request, env, context) {
    if (new URL(request.url).pathname === SCHEDULER_PATH) {
      const pending = runScheduledNotifications(request, env);
      context.waitUntil(pending);
      return pending;
    }
    return app.fetch(request, env, context);
  },
  scheduled(controller, env, context) {
    console.log(
      JSON.stringify({
        event: 'ahead.scheduler.started',
        scheduledTime: controller.scheduledTime,
      }),
    );

    context.waitUntil(
      processDueNotificationJobs(env)
        .then(async (summary) => {
          await recordSchedulerHeartbeat(env.DB);
          console.log(
            JSON.stringify({
              event: 'ahead.scheduler.completed',
              scheduledTime: controller.scheduledTime,
              ...summary,
            }),
          );
        })
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({
              event: 'ahead.scheduler.failed',
              scheduledTime: controller.scheduledTime,
              error: error instanceof Error ? error.message : 'Unknown scheduler error.',
            }),
          );
          throw error;
        }),
    );
  },
} satisfies ExportedHandler<WorkerEnv>;
