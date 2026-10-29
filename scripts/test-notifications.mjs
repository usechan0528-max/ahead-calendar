// Runs the production Worker with isolated, in-memory D1 and mocked push services.
// Build first. No production data, credentials, or browser subscriptions are used.
import { withCurrentEventRevision } from './current-event-revision.mjs';
import assert from 'node:assert/strict';
import { createECDH, randomBytes, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve('wrangler/package.json'));
const { Miniflare, createFetchMock } = wranglerRequire('miniflare');
const vapid = createECDH('prime256v1');
vapid.generateKeys();
const device = createECDH('prime256v1');
device.generateKeys();
const actionSecret = randomBytes(32).toString('base64url');
const schedulerSecret = randomBytes(32).toString('base64url');
const mock = createFetchMock();
mock.disableNetConnect();
const push = mock.get('https://fcm.googleapis.com');
const calls = new Map();
function intercept(name, code = 201) {
  push.intercept({ path: `/fcm/send/${name}`, method: 'POST' }).reply(() => {
    calls.set(name, (calls.get(name) || 0) + 1);
    return { statusCode: code, data: '' };
  }).persist();
}
const serverFiles = await readdir('dist/server', { recursive: true });
const modulePaths = ['index.js', ...serverFiles.filter((name) => /\.m?js$/.test(name) && name !== 'index.js')];
const mf = new Miniflare({
  modules: modulePaths.map((name) => ({ type: 'ESModule', path: path.resolve('dist/server', name) })),
  modulesRoot: path.resolve('dist/server'),
  compatibilityDate: '2026-05-15',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'],
  bindings: {
    VAPID_PUBLIC_KEY: vapid.getPublicKey().toString('base64url'),
    VAPID_PRIVATE_KEY: vapid.getPrivateKey().toString('base64url'),
    VAPID_SUBJECT: 'https://ahead.example',
    NOTIFICATION_ACTION_SECRET: actionSecret,
    SCHEDULER_SECRET: schedulerSecret,
  },
  fetchMock: mock,
});

try {
  const db = await mf.getD1Database('DB');
  for (const file of (await readdir('drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
    for (const sql of (await readFile(path.join('drizzle', file), 'utf8')).split('--> statement-breakpoint')) {
      if (sql.trim()) await db.prepare(sql).run();
    }
  }
  const sql = (statement, ...values) => db.prepare(statement).bind(...values).run();
  const row = (id) => db.prepare('SELECT * FROM notification_jobs WHERE id = ?').bind(id).first();
  await sql("INSERT INTO events (id, owner_id, title, category, event_date, event_time) VALUES (1, 'owner-a', '테스트 일정', '기념일', '2026-12-01', '09:00'), (2, 'owner-b', '다른 계정', '기념일', '2026-12-01', '09:00')");
  async function subscription(id, name, expires = null) {
    await sql('INSERT INTO push_subscriptions (id, owner_id, endpoint, p256dh, auth, expiration_time) VALUES (?, ?, ?, ?, ?, ?)', id, 'owner-a', `https://fcm.googleapis.com/fcm/send/${name}`, device.getPublicKey().toString('base64url'), randomBytes(16).toString('base64url'), expires);
  }
  async function job(id, sub, delay = -1000, state = 'scheduled') {
    await sql('INSERT INTO notification_jobs (id, owner_id, event_id, subscription_id, title, body, scheduled_for, status, idempotency_key, claimed_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)', id, 'owner-a', sub, '테스트', '테스트 알림', new Date(Date.now() + delay).toISOString(), state, `test-key-${id}`, state === 'processing' ? new Date(Date.now() - 600000).toISOString() : null);
  }
  const worker = await mf.getWorker();
  const tick = () => worker.scheduled({ cron: '* * * * *' });
  async function api(url, { method = 'GET', owner = 'owner-a', body, key } = {}) {
    body = await withCurrentEventRevision(db, url, method, owner, body);
    const headers = {};
    if (owner) Object.assign(headers, { 'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': `${owner}@example.test` });
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (key) headers['idempotency-key'] = key;
    return mf.dispatchFetch(`http://localhost${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  assert.equal((await api('/api/push/public-key', { owner: null })).status, 401);
  assert.equal((await api('/api/events/1/notifications/schedule-test', { method: 'POST', body: { mode: 'scheduled' } })).status, 503);
  console.log('PASS: sign-in required; delayed scheduling fails closed without heartbeat');

  const schedulerPath = '/api/internal/notifications/run-due';
  function signedRequest({ time = Date.now(), nonce = crypto.randomUUID(), secret = schedulerSecret, method = 'POST', query = '', body } = {}) {
    const timestamp = String(time);
    const signature = createHmac('sha256', secret).update(`ahead-scheduler-v1\nPOST\n${schedulerPath}\n${timestamp}\n${nonce}`).digest('hex');
    return new Request(`http://localhost${schedulerPath}${query}`, {
      method, body,
      headers: { 'x-ahead-timestamp': timestamp, 'x-ahead-nonce': nonce, 'x-ahead-signature': signature },
    });
  }
  const internal = (request) => mf.dispatchFetch(request.url, { method: request.method, headers: request.headers, body: request.body, duplex: 'half' });
  for (const request of [
    new Request(`http://localhost${schedulerPath}`, { method: 'POST', headers: { 'oai-authenticated-user-id': 'owner-a', 'oai-authenticated-user-email': 'owner-a@example.test' } }),
    signedRequest({ secret: 'not-the-secret' }), signedRequest({ time: Date.now() - 91000 }),
    signedRequest({ time: Date.now() + 91000 }), signedRequest({ nonce: 'invalid' }),
    signedRequest({ method: 'GET' }), signedRequest({ query: '?extra=1' }), signedRequest({ body: '{}' }),
  ]) assert.equal((await internal(request)).status, 401);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM notification_scheduler_nonces').first()).n, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM notification_scheduler_state').first()).n, 0);
  console.log('PASS: unsigned, tampered, expired, future, malformed and non-empty scheduler calls cannot mutate data');

  const nonce = crypto.randomUUID();
  const replay = await Promise.all([internal(signedRequest({ nonce })), internal(signedRequest({ nonce }))]);
  assert.deepEqual(replay.map((response) => response.status).sort(), [200, 409]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM notification_scheduler_nonces').first()).n, 1);
  console.log('PASS: signed scheduler call succeeds exactly once under concurrent replay');

  intercept('accepted');
  await subscription(1, 'accepted');
  await job(1, 1);
  await job(2, 1, 3600000);
  const remoteTicks = await Promise.all([internal(signedRequest()), internal(signedRequest())]);
  assert.ok(remoteTicks.every((response) => response.status === 200));
  assert.equal((await row(1)).status, 'sent');
  assert.equal((await row(2)).status, 'scheduled');
  assert.equal(calls.get('accepted'), 1);
  const health = await (await api('/api/push/public-key')).json();
  assert.equal(health.scheduler.ready, true);
  console.log('PASS: due job sent once under concurrent ticks; future job untouched; heartbeat recorded');

  assert.equal((await api('/api/notifications/jobs/1', { owner: 'owner-b' })).status, 404);
  assert.equal((await api('/api/notifications/jobs/1/ack', { method: 'POST', owner: 'owner-b' })).status, 404);
  const latest = await (await api('/api/events/1/notifications')).json();
  assert.equal(latest.job.id, 2);
  const unsigned = `v1.1.${Buffer.from('owner-a').toString('base64url')}`;
  const token = `${unsigned}.${createHmac('sha256', actionSecret).update(`ahead-notification-action:${unsigned}`).digest('base64url')}`;
  assert.equal((await api('/api/notifications/jobs/1/ack', { method: 'POST', owner: null, body: { token: token + 'invalid' } })).status, 401);
  for (let i = 0; i < 2; i++) assert.equal((await api('/api/notifications/jobs/1/ack', { method: 'POST', owner: null, body: { token } })).status, 200);
  assert.equal((await row(1)).status, 'acked');
  console.log('PASS: owner isolation, latest job restoration, signed and idempotent acknowledgement');

  const options = { method: 'POST', key: 'immediate-test-key', body: { mode: 'immediate', subscriptionId: 1 } };
  const firstResponse = await api('/api/events/1/notifications/schedule-test', options);
  assert.equal(firstResponse.status, 201);
  const first = await firstResponse.json();
  const second = await (await api('/api/events/1/notifications/schedule-test', options)).json();
  assert.equal(first.job.id, second.job.id);
  assert.equal(first.job.status, 'sent');
  assert.equal(calls.get('accepted'), 2);
  assert.equal((await api(`/api/notifications/jobs/${first.job.id}/snooze`, { method: 'POST' })).status, 200);
  assert.equal((await api(`/api/notifications/jobs/${first.job.id}/snooze`, { method: 'POST' })).status, 409);
  const snoozed = await row(first.job.id);
  assert.equal(snoozed.status, 'scheduled');
  assert.ok(Date.parse(snoozed.scheduled_for) > Date.now() + 590000);
  console.log('PASS: immediate server push, exact device, idempotent request and ten-minute snooze');

  intercept('gone', 410);
  await subscription(3, 'gone');
  await job(30, 3);
  await tick();
  assert.equal((await row(30)).status, 'failed');
  assert.ok((await db.prepare('SELECT disabled_at FROM push_subscriptions WHERE id = 3').first()).disabled_at);
  await tick();
  assert.equal(calls.get('gone'), 1);
  console.log('PASS: expired endpoint disabled without repeated sends');

  intercept('retry', 503);
  await subscription(4, 'retry');
  await job(40, 4);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await tick();
    const retryJob = await row(40);
    assert.equal(retryJob.attempt_count, attempt);
    assert.equal(retryJob.status, attempt === 3 ? 'failed' : 'scheduled');
    if (attempt < 3) await sql('UPDATE notification_jobs SET scheduled_for = ? WHERE id = 40', new Date(Date.now() - 1000).toISOString());
  }
  assert.equal(calls.get('retry'), 3);
  console.log('PASS: explicit service rejection retries no more than three times');

  intercept('uncertain');
  await subscription(5, 'uncertain');
  await job(50, 5);
  await sql("CREATE TRIGGER fail_acceptance BEFORE UPDATE ON notification_jobs WHEN NEW.id = 50 AND NEW.status = 'sent' BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END");
  await tick();
  assert.equal((await row(50)).status, 'unconfirmed');
  await tick();
  assert.equal(calls.get('uncertain'), 1);
  await job(51, 5, -1000, 'processing');
  await tick();
  assert.equal((await row(51)).status, 'unconfirmed');
  assert.equal(calls.get('uncertain'), 1);
  console.log('PASS: ambiguous acceptance and interrupted claims are never blindly resent');
  assert.equal((await api('/api/notifications/jobs/50/ack', { method: 'POST' })).status, 200);
  assert.equal((await row(50)).status, 'acked');
  assert.equal((await api('/api/notifications/jobs/51/snooze', { method: 'POST' })).status, 200);
  assert.equal((await row(51)).status, 'scheduled');
  console.log('PASS: uncertain jobs recover only after explicit acknowledgement or snooze');

  await subscription(6, 'already-expired', Date.now() - 1000);
  await job(60, 6);
  await tick();
  assert.equal((await row(60)).status, 'failed');
  console.log('PASS: expired subscription fails before network access');

  // Real reminder generation is exercised entirely inside isolated D1 and mocked push.
  intercept('automatic');
  await subscription(100, 'automatic');
  const seoulParts = (instant) => new Date(instant + 9 * 3600000).toISOString();
  const pastEvent = seoulParts(Date.now() - 60000);
  const futureEvent = seoulParts(Date.now() + 6 * 3600000);
  const insertEvent = (id, parts) => sql(`INSERT INTO events
    (id, owner_id, title, category, event_date, event_time) VALUES (?, 'owner-a', '실제 일정', '일정', ?, ?)`,
    id, parts.slice(0, 10), parts.slice(11, 16));
  await insertEvent(100, pastEvent);
  await sql('INSERT INTO reminder_rules (event_id, offset_minutes) VALUES (100, 0)');
  await tick();
  const reminders = () => db.prepare("SELECT * FROM notification_jobs WHERE kind = 'reminder' ORDER BY id").all();
  assert.equal((await reminders()).results.length, 0, 'Test registrations must not automatically opt in.');
  assert.equal((await api('/api/push/subscriptions', { method: 'PATCH', owner: 'owner-b', body: { subscriptionId: 100, enabled: true } })).status, 404);
  assert.equal((await api('/api/push/subscriptions', { method: 'PATCH', body: { subscriptionId: 100, enabled: true } })).status, 200);
  await tick();
  assert.equal((await reminders()).results.length, 0, 'Enabling must not backfill past reminder times.');
  await sql('UPDATE push_subscriptions SET reminders_enabled_at = ? WHERE id = 100', new Date(Date.now() - 5 * 60000).toISOString());
  await Promise.all([internal(signedRequest()), internal(signedRequest())]);
  const delivered = (await reminders()).results;
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].status, 'sent');
  assert.equal(calls.get('automatic'), 1);
  await tick();
  assert.equal(calls.get('automatic'), 1);
  console.log('PASS: explicit device consent, no historical burst, concurrent actual reminder delivery exactly once');

  await insertEvent(101, futureEvent);
  await sql('INSERT INTO reminder_rules (event_id, offset_minutes) VALUES (101, 60)');
  const reservedKey = `reminder:101:${futureEvent.slice(0, 10)}:60:100`;
  await subscription(105, 'attacker-test');
  await sql("UPDATE push_subscriptions SET owner_id = 'owner-b' WHERE id = 105");
  assert.equal((await api('/api/events/2/notifications/schedule-test', {
    method: 'POST', owner: 'owner-b', key: reservedKey, body: { subscriptionId: 105, mode: 'scheduled' },
  })).status, 201);
  await tick();
  let futureJob = (await reminders()).results.find((job) => job.event_id === 101);
  assert.equal(futureJob.status, 'scheduled');
  const futureId = futureJob.id;
  assert.equal(futureJob.owner_id, 'owner-a');
  assert.equal(futureJob.idempotency_key, reservedKey);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM notification_jobs WHERE idempotency_key = ?').bind(reservedKey).first()).n, 1);
  const edited = { title: '수정한 일정', category: '일정', eventDate: futureEvent.slice(0, 10), eventTime: futureEvent.slice(11, 16), recurrence: 'none' };
  assert.equal((await api('/api/events/101', { method: 'PATCH', body: edited })).status, 200);
  futureJob = await row(futureId);
  assert.equal(futureJob.title, '수정한 일정');
  assert.equal(futureJob.status, 'scheduled');
  assert.equal(futureJob.event_revision, 1);
  assert.equal((await api('/api/events/101/reminders', { method: 'PATCH', body: { preset: 'minimal' } })).status, 200);
  assert.equal((await row(futureId)).status, 'cancelled');
  assert.equal((await api('/api/events/101/reminders', { method: 'PATCH', body: { preset: 'thorough' } })).status, 200);
  assert.equal((await row(futureId)).status, 'scheduled');
  assert.equal((await reminders()).results.filter((job) => job.event_id === 101 && job.reminder_offset_minutes === 60).length, 1);
  const next = await (await api('/api/events/101/notifications?subscriptionId=100')).json();
  assert.ok(next.nextReminder);
  assert.equal((await api('/api/events/101', { method: 'PATCH', body: { ...edited, eventDate: '2026-02-31' } })).status, 400);
  assert.equal((await api('/api/events', { method: 'POST', body: { ...edited, eventTime: '99:99' } })).status, 400);
  assert.equal((await api('/api/events/101/reminders', { method: 'POST', body: { offsetMinutes: 0 } })).status, 201);
  console.log('PASS: edits invalidate/refresh future payloads, preset replacement deduplicates, next reminder and input validation');

  assert.equal((await api('/api/push/subscriptions', { method: 'PATCH', body: { subscriptionId: 100, enabled: false } })).status, 200);
  assert.ok((await reminders()).results.filter((job) => job.event_id === 101).every((job) => job.status === 'cancelled'));
  assert.equal((await row(delivered[0].id)).status, 'sent');
  assert.equal((await api(`/api/notifications/jobs/${delivered[0].id}/snooze`, { method: 'POST' })).status, 409);
  for (const minutes of [30,60]) assert.equal((await api(`/api/notifications/jobs/${delivered[0].id}/snooze`, {method:'POST',body:{minutes}})).status,409);
  assert.equal((await api('/api/push/subscriptions', { method: 'PATCH', body: { subscriptionId: 100, enabled: true } })).status, 200);
  assert.equal((await reminders()).results.filter((job) => job.event_id === 100).length, 1, 'Sent identity must not be recreated after re-enable.');
  assert.equal((await api('/api/events/101', { method: 'DELETE' })).status, 204);
  assert.ok((await reminders()).results.every((job) => job.event_id !== 101));
  console.log('PASS: device disable cancels future jobs, stops snooze, preserves history; event deletion removes pending jobs');

  await insertEvent(200, pastEvent);
  await sql('INSERT INTO reminder_rules (event_id, offset_minutes) VALUES (200, 0)');
  await sql('UPDATE push_subscriptions SET reminders_enabled_at = ? WHERE id = 100', new Date(Date.now() - 5 * 60000).toISOString());
  await sql(`CREATE TRIGGER edit_during_claim AFTER UPDATE ON notification_jobs
    WHEN NEW.event_id = 200 AND NEW.status = 'processing'
    BEGIN UPDATE events SET notification_revision = notification_revision + 1 WHERE id = 200; END`);
  await tick();
  assert.equal(calls.get('automatic'), 1, 'A changed revision after claim must stop transport.');
  await tick();
  assert.equal((await reminders()).results.find((job) => job.event_id === 200).status, 'cancelled');
  console.log('PASS: event revision changed during claim prevents stale transport');

  // More rows than one scan must still progress through the stored cursor.
  for (let id = 500; id <= 555; id++) await insertEvent(id, futureEvent);
  await sql('INSERT INTO reminder_rules (event_id, offset_minutes) VALUES (555, 0)');
  for (let round = 0; round < 3; round++) await tick();
  const lastPlanned = (await reminders()).results.find((job) => job.event_id === 555);
  assert.ok(lastPlanned);
  const expiredEvent = seoulParts(Date.now() - 3600000);
  await insertEvent(900, expiredEvent);
  await sql('INSERT INTO reminder_rules (event_id, offset_minutes) VALUES (900, 0)');
  const expiredOccurrence = new Date(`${expiredEvent.slice(0, 10)}T${expiredEvent.slice(11, 16)}:00+09:00`).toISOString();
  await sql(`INSERT INTO notification_jobs (id, owner_id, event_id, subscription_id, kind, title, body,
    scheduled_for, idempotency_key, occurrence_at, reminder_offset_minutes, event_revision, expires_at, created_at)
    VALUES (900, 'owner-a', 900, 100, 'reminder', '만료된 알림', '테스트', ?, 'expired-reminder', ?, 0, 0, ?, ?)`,
    expiredOccurrence, expiredOccurrence, new Date(Date.now() - 1800000).toISOString(), new Date().toISOString());
  await tick();
  assert.equal((await row(900)).status, 'cancelled');
  console.log('PASS: bounded scan cursor advances and stale reminders expire');

  const actionTokenFor=(id)=>{const unsigned=`v1.${id}.${Buffer.from('owner-a').toString('base64url')}`;return `${unsigned}.${createHmac('sha256',actionSecret).update(`ahead-notification-action:${unsigned}`).digest('base64url')}`;};
  const scheduleUnchanged=await db.prepare('SELECT * FROM events WHERE id = 1').first();
  const actionSideEffects=async()=>Promise.all(['reminder_rules','xp_ledger','occurrence_completions'].map(async table=>(await db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results));
  const beforeSnoozeEffects=await actionSideEffects();
  for (const minutes of [10,30,60]) {
    const id=11000+minutes; await job(id,1,-1000,'sent');
    const beforeRequest=Date.now();
    const response=await api(`/api/notifications/jobs/${id}/snooze`,{method:'POST',body:{minutes}});
    const afterRequest=Date.now(); assert.equal(response.status,200);
    const saved=await row(id);
    assert.equal(saved.status,'scheduled'); assert.equal(saved.attempt_count,0); assert.ok(saved.lifetime_attempt_count>=1);
    assert.ok(Date.parse(saved.scheduled_for)>=beforeRequest+minutes*60000&&Date.parse(saved.scheduled_for)<=afterRequest+minutes*60000);
    assert.equal((await api(`/api/notifications/jobs/${id}/snooze`,{method:'POST',body:{minutes:10}})).status,409);
    assert.equal((await row(id)).scheduled_for,saved.scheduled_for);
  }
  await job(11100,1,-1000,'sent');
  const untouched=await row(11100);
  for(const body of [{minutes:0},{minutes:-10},{minutes:20},{minutes:'30'},{minutes:null},[],null]) assert.equal((await api('/api/notifications/jobs/11100/snooze',{method:'POST',body})).status,400);
  assert.equal((await mf.dispatchFetch('http://localhost/api/notifications/jobs/11100/snooze',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':'owner-a','oai-authenticated-user-email':'owner-a@example.test'},body:'{broken'})).status,400);
  assert.equal((await api('/api/notifications/jobs/11100/snooze',{method:'POST',owner:'owner-b',body:{minutes:30}})).status,404);
  assert.equal((await api('/api/notifications/jobs/11100/snooze',{method:'POST',owner:null,body:{token:actionTokenFor(11101),minutes:30}})).status,401);
  assert.deepEqual(await row(11100),untouched);
  const tokenRequestAt=Date.now();
  const tokenResponse=await api('/api/notifications/jobs/11100/snooze',{method:'POST',owner:null,body:{token:actionTokenFor(11100),minutes:30}});
  assert.equal(tokenResponse.status,200);
  assert.ok(Date.parse((await row(11100)).scheduled_for)>=tokenRequestAt+30*60000&&Date.parse((await row(11100)).scheduled_for)<=Date.now()+30*60000);
  await job(11101,1,-1000,'sent');
  const raceStarted=Date.now(); const raceMinutes=[10,60];
  const snoozeRace=await Promise.all(raceMinutes.map(minutes=>api('/api/notifications/jobs/11101/snooze',{method:'POST',body:{minutes}})));
  assert.deepEqual(snoozeRace.map(response=>response.status).sort(),[200,409]);
  const winnerMinutes=raceMinutes[snoozeRace.findIndex(response=>response.status===200)];
  const raceSaved=await row(11101);
  assert.ok(Date.parse(raceSaved.scheduled_for)>=raceStarted+winnerMinutes*60000&&Date.parse(raceSaved.scheduled_for)<=Date.now()+winnerMinutes*60000);
  await job(11102,1,-1000,'sent');
  const ackSnoozeRace=await Promise.all([api('/api/notifications/jobs/11102/ack',{method:'POST'}),api('/api/notifications/jobs/11102/snooze',{method:'POST',body:{minutes:30}})]);
  assert.deepEqual(ackSnoozeRace.map(response=>response.status).sort(),[200,409]);
  assert.equal((await row(11102)).status,ackSnoozeRace[0].status===200?'acked':'scheduled');
  assert.deepEqual(await db.prepare('SELECT * FROM events WHERE id = 1').first(),scheduleUnchanged);
  assert.deepEqual(await actionSideEffects(),beforeSnoozeEffects);
  console.log('PASS: 10/30/60 minute snooze, strict bodies, capability+minutes, ownership, retry/race fencing and unchanged schedule/completion/XP');

  // Current, consented reminder retains original identity while extending only its send window.
  await sql("UPDATE notification_jobs SET status = 'sent' WHERE id = ?",lastPlanned.id);
  const beforeReminderSnooze=await row(lastPlanned.id);
  assert.equal((await api(`/api/notifications/jobs/${lastPlanned.id}/snooze`,{method:'POST',body:{minutes:60}})).status,200);
  const afterReminderSnooze=await row(lastPlanned.id);
  assert.equal(Date.parse(afterReminderSnooze.expires_at)-Date.parse(afterReminderSnooze.scheduled_for),30*60000);
  for(const field of ['original_occurrence_date','occurrence_at','reminder_offset_minutes','event_revision','idempotency_key']) assert.equal(afterReminderSnooze[field],beforeReminderSnooze[field]);
  const reminderDetail=await (await api(`/api/notifications/jobs/${lastPlanned.id}`)).json();
  assert.equal(reminderDetail.job.original_occurrence_date,beforeReminderSnooze.original_occurrence_date);
  assert.equal(reminderDetail.job.reminder_offset_minutes,0);
  await sql('DELETE FROM notification_jobs WHERE id >= 11000 AND id <= 11102');
  console.log('PASS: consent fence for every snooze choice, original reminder identity and bounded new delivery window');

  const priorHeartbeat = await db.prepare('SELECT last_completed_at FROM notification_scheduler_state WHERE id = 1').first();
  await sql("CREATE TRIGGER fail_heartbeat BEFORE UPDATE ON notification_scheduler_state BEGIN SELECT RAISE(ABORT, 'simulated heartbeat failure'); END");
  assert.equal((await internal(signedRequest())).status, 503);
  assert.deepEqual(await db.prepare('SELECT last_completed_at FROM notification_scheduler_state WHERE id = 1').first(), priorHeartbeat);
  console.log('PASS: failed completion cannot refresh scheduler health');
  console.log('All notification integration checks passed. Push delivery was mocked, not a real device receipt.');
} finally {
  await mf.dispose();
  await mock.close();
}
