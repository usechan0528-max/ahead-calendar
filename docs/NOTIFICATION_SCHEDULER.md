# Scheduled notification test

The existing private Sites application owns schedules, subscriptions, jobs and delivery records. A separate Cloudflare Worker, `ahead-notification-clock`, requests due-job processing once per minute. It has no public route and does not store event data or Web Push keys.

## Authentication

- The relay holds `SITES_BEARER_TOKEN` to enter the existing private Sites gate without a browser session.
- Both deployments hold a separate `SCHEDULER_SECRET` (at least 32 random bytes, encoded for storage).
- A body-less POST to `/api/internal/notifications/run-due` is signed with HMAC-SHA256. Method, path, timestamp and nonce are authenticated. Queries and bodies are rejected.
- Timestamps must be within 90 seconds; D1 deduplicates UUID nonces for five minutes. The platform token alone does not authorize this endpoint or impersonate an application user.
- Secrets belong in provider-managed secret storage, never source, URLs, browser code, logs or local committed files. Rotating the Sites machine token also requires updating the relay secret.

## Current scope

Saved calendar reminder rules now create real Web Push jobs, in addition to explicit tests and ten-minute snoozes. Each device must explicitly enable calendar reminders; existing test registrations remain off after migration. Turning it off cancels that device's pending calendar jobs, without changing other devices or deleting delivery history.

All event dates/times use Asia/Seoul. The screen and server share recurrence calculations: selected weekday, selected day of month (clamped to month end), and year intervals (February 29 clamps to February 28 in non-leap years). An offset may range from the start time through 365 days before an occurrence. Each configured offset is sent once; `repeat_until_ack` is legacy metadata and does not trigger automatic repeated nudges. Users can explicitly snooze received reminders.

The planner materializes a rolling 24-hour **delivery-time** window, shifting it by each rule's offset so long advance reminders on frequently recurring events are not lost. It scans 50 events per run using a saved cursor, with targeted refresh on event edits. Catch-up and queued reminder expiry are limited to 30 minutes. Nothing before device enablement or the latest event/reminder edit is backfilled.

The stable deduplication key uses event, occurrence instant, offset and device; the event revision is a separate validity fence. Edits/preset changes cancel pending reminders transactionally and refresh future jobs. Already-sent or ambiguous jobs are not revived by regeneration. Insert, claim and pre-transport checks validate current ownership, consent and revision. An external push request already in flight cannot be recalled by an edit or deletion.

All-day events use a separate `all_day_reminder_time` (09:00 by default), preserving the original timed `event_time` for switching back. Multi-day events appear on every covered calendar date, but reminders are generated only from each recurrence start plus its alarm base time, never once per covered date. All-day end dates are inclusive; timed midnight ends exclude the following date from display. Duration changes retain existing revision, cancellation and consent fences.

The UI enables delayed tests only while a successful processor heartbeat is less than three minutes old. A heartbeat proves server execution, not receipt on a device. Push-service acceptance is also not proof of device display. Interrupted/ambiguous sends are not blindly retried.

To J completion is separate from notification acknowledgement. Completing an event occurrence cancels that occurrence's queued reminder jobs; planner insertion and pre-transport fences reject completed occurrences. Other repeats, preparation checks, device consent and sent history remain unchanged. Undo can restore eligibility within the original timing/deduplication limits. XP never comes from push acknowledgement.

## Validation and release

1. Generate and inspect D1 migrations, then build the Sites app.
2. Run `node scripts/test-notifications.mjs` against the built Worker and isolated D1.
   Run `node --experimental-strip-types scripts/test-reminder-dates.mjs` for recurrence/date boundary cases.
   Run `node --experimental-strip-types scripts/test-event-duration.mjs` for all-day/range boundaries, migration preservation, duration CRUD and single-start alarm planning.
3. Build the relay with `wrangler deploy --config infra/scheduler/wrangler.jsonc --dry-run --outdir ../../outputs/scheduler-build` and run `node scripts/test-scheduler-relay.mjs`. All external calls in these tests are mocked.
4. Configure provider-managed secrets; publish the Sites app privately before deploying the relay. Do not change Site access or recreate D1.
5. Verify the live access boundaries and observe at least two advancing heartbeats from actual Cron invocations. A manual POST alone is not evidence that Cron is connected.
6. In Chrome, create a two-minute test, close the page, and verify arrival and acknowledgement. Then verify ten-minute snooze separately.

Cloudflare Cron configuration may take up to 15 minutes to propagate. During an outage, delayed tests and snooze are disabled and existing jobs remain visible. Calendar settings can still be saved; reminders more than 30 minutes late are skipped. Stop dispatch by removing this relay's Cron trigger, not by deleting user schedules or subscriptions.

References: [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) and [secret management](https://developers.cloudflare.com/workers/configuration/secrets/).
