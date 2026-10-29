// Regression tests for the September site audit. Isolated D1 and mocked providers only.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { createECDH, randomBytes } from 'node:crypto';
import { withCurrentEventRevision } from './current-event-revision.mjs';
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve('wrangler/package.json'));
const { build } = wranglerRequire('esbuild');
const cache = new Map();
async function moduleUrl(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  let source = ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const match of [...source.matchAll(/from ['"](\.[^'"]+)['"]/g)]) source = source.replace(match[0], `from '${await moduleUrl(path.resolve(path.dirname(file), `${match[1]}.ts`))}'`);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  cache.set(file, url); return url;
}
const { resolveOccurrence } = await import(await moduleUrl('lib/occurrences.ts'));
const { materializeReminders, currentReminderSql } = await import(await moduleUrl('db/reminder-planner.ts'));
const { setOccurrenceCompletion, readOccurrenceCompletion } = await import(await moduleUrl('db/progress.ts'));
const overviewBundle = await build({ entryPoints: ['components/workspace-overview.tsx'], bundle: true, platform: 'node', format: 'esm', write: false });
const { UpcomingStrip, overviewRows } = await import(`data:text/javascript;base64,${Buffer.from(overviewBundle.outputFiles[0].text).toString('base64')}`);
const { Miniflare, createFetchMock } = wranglerRequire('miniflare');
const mock = createFetchMock(); mock.disableNetConnect();
const vapid = createECDH('prime256v1'); vapid.generateKeys();
const device = createECDH('prime256v1'); device.generateKeys();
let deliveries = 0;
mock.get('https://fcm.googleapis.com').intercept({path:'/fcm/send/isolated-audit',method:'POST'}).reply(() => { deliveries++; return {statusCode:201,data:''}; }).persist();
const files = await readdir('dist/server', { recursive: true });
const mf = new Miniflare({ modules: ['index.js', ...files.filter((f) => /\.m?js$/.test(f) && f !== 'index.js')].map((f) => ({ type: 'ESModule', path: path.resolve('dist/server', f) })), modulesRoot: path.resolve('dist/server'), compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], bindings: {VAPID_PUBLIC_KEY:vapid.getPublicKey().toString('base64url'),VAPID_PRIVATE_KEY:vapid.getPrivateKey().toString('base64url'),VAPID_SUBJECT:'https://audit.example',NOTIFICATION_ACTION_SECRET:randomBytes(32).toString('base64url')}, fetchMock: mock });
try {
  const db = await mf.getD1Database('DB');
  for (const file of (await readdir('drizzle')).filter((f) => f.endsWith('.sql')).sort()) for (const statement of (await readFile(path.join('drizzle', file), 'utf8')).split('--> statement-breakpoint')) if (statement.trim()) await db.prepare(statement).run();
  const sql = (s, ...v) => db.prepare(s).bind(...v).run();
  await sql('INSERT INTO notification_scheduler_state (id, last_completed_at) VALUES (1, ?)', new Date().toISOString());
  async function api(url, body, method = 'GET', expected = 200) {
    body = await withCurrentEventRevision(db, url, method, 'audit', body);
    const r = await mf.dispatchFetch(`http://localhost${url}`, { method, headers: { 'content-type': 'application/json', 'oai-authenticated-user-id': 'audit', 'oai-authenticated-user-email': 'audit@example.test' }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.equal(r.status, expected, await r.clone().text()); return r.json();
  }
  const input = { title: 'Isolated audit event', category: '일정', eventDate: '2030-01-01', eventTime: '10:00', allDay: false, allDayReminderTime: '09:00', endDate: null, endTime: null, location: '', place: null, travelPlan: null, note: '', preparationsEnabled: false, recurrence: 'monthly', recurrenceInterval: 1, recurrenceDay: 1, recurrenceUntil: '2030-12-01', initialReminderOffsets: [] };

  // Resolved occurrences must never replace the recurring master in a whole-event edit.
  const locationMaster = (await api('/api/events', input, 'POST', 201)).event;
  const resolved = resolveOccurrence(input, '2030-02-01').event;
  assert.equal(resolved.recurrence, 'none');
  const page = await readFile('app/page.tsx','utf8');
  assert.doesNotMatch(page, /openEdit\(selected\)/);
  const altered = (await api(`/api/events/${locationMaster.id}`, { ...input, location: '서울', revision: locationMaster.notification_revision }, 'PATCH')).event;
  assert.equal(altered.recurrence, 'monthly'); assert.equal(altered.event_date, '2030-01-01'); assert.equal(altered.recurrence_until, input.recurrenceUntil);
  console.log('PASS A1: master editing; location-only edit preserves recurrence/date/cutoff.');

  const shared = (await api('/api/events', input, 'POST', 201)).event;
  const shortened = (await api(`/api/events/${shared.id}`, { ...input, recurrenceUntil: '2030-09-01' }, 'PATCH')).event;
  assert.equal(shortened.recurrence_until, '2030-09-01');
  await api(`/api/events/${shared.id}`, { ...input, note: 'Memo from older open form', revision: shared.notification_revision }, 'PATCH', 409);
  assert.equal((await api('/api/events')).events.find(e=>e.id===shared.id).recurrence_until,'2030-09-01');
  const missingRevision = await mf.dispatchFetch(`http://localhost/api/events/${shared.id}`,{method:'PATCH',headers:{'content-type':'application/json','oai-authenticated-user-id':'audit','oai-authenticated-user-email':'audit@example.test'},body:JSON.stringify(input)});
  assert.equal(missingRevision.status,428);
  for(const revision of [-1,'0',null,0.5]) await api(`/api/events/${shared.id}`,{...input,revision},'PATCH',400);
  const race = await Promise.all(['A','B'].map(note=>api(`/api/events/${shared.id}`,{...input,note,revision:shortened.notification_revision},'PATCH',undefined).catch(e=>e)));
  assert.deepEqual(race.map(r=>r.event ? 200 : r.actual).sort(),[200,409]);
  console.log('PASS A3: stale/missing/malformed revision blocked; simultaneous edits cannot both save.');

  const now = Date.now();
  const due = new Date(Math.floor((now - 2 * 60_000) / 60_000) * 60_000);
  const kst = new Date(due.getTime() + 9 * 3600_000).toISOString();
  const enabled = new Date(now - 3600_000).toISOString();
  await sql("INSERT INTO push_subscriptions (id,owner_id,endpoint,p256dh,auth,reminders_enabled_at) VALUES (90,'audit','https://fcm.googleapis.com/fcm/send/isolated-audit',?,?,?)", device.getPublicKey().toString('base64url'),randomBytes(16).toString('base64url'),enabled);
  const alarmInput = { ...input, eventDate: kst.slice(0,10), eventTime: kst.slice(11,16), recurrence: 'none', recurrenceUntil: null, recurrenceDay: null, initialReminderOffsets: [0] };
  async function seedAlarm(overrides = {}) {
    const event = (await api('/api/events', { ...alarmInput, ...overrides }, 'POST', 201)).event;
    await sql('UPDATE events SET reminders_changed_at = ? WHERE id = ?', enabled, event.id);
    await materializeReminders(db, new Date(now), { eventId: event.id });
    const job = await db.prepare('SELECT * FROM notification_jobs WHERE event_id = ?').bind(event.id).first();
    assert.ok(job);
    await sql("UPDATE notification_jobs SET status='sent',attempt_count=1,sent_at=? WHERE id=?", due.toISOString(), job.id);
    return { event, job };
  }
  const memoCase = await seedAlarm();
  const snoozed = await api(`/api/notifications/jobs/${memoCase.job.id}/snooze`, {}, 'POST');
  assert.equal(snoozed.job.status, 'scheduled');
  await api(`/api/events/${memoCase.event.id}`, { ...alarmInput, note: 'Only the memo changed' }, 'PATCH');
  await materializeReminders(db, new Date(), { eventId: memoCase.event.id });
  const missing = await db.prepare('SELECT status,scheduled_for FROM notification_jobs WHERE id=?').bind(memoCase.job.id).first();
  assert.equal(missing.status, 'scheduled'); assert.equal(missing.scheduled_for,snoozed.job.scheduled_for);
  const remaining = await db.prepare("SELECT COUNT(*) n FROM notification_jobs WHERE event_id=? AND status='scheduled'").bind(memoCase.event.id).first();
  assert.equal(remaining.n, 1);
  const preferenceBefore = (await api('/api/events')).events.find(e=>e.id===memoCase.event.id);
  await api(`/api/events/${memoCase.event.id}/preparation-settings`, { enabled: true }, 'PATCH');
  const preferenceAfter = (await api('/api/events')).events.find(e=>e.id===memoCase.event.id);
  assert.equal(preferenceAfter.notification_revision, preferenceBefore.notification_revision + 1);
  assert.equal(preferenceAfter.reminders_changed_at, preferenceBefore.reminders_changed_at);
  await api(`/api/events/${memoCase.event.id}`, { ...alarmInput, revision: preferenceBefore.notification_revision }, 'PATCH', 409);
  assert.deepEqual(await db.prepare('SELECT status,scheduled_for FROM notification_jobs WHERE id=?').bind(memoCase.job.id).first(), missing);
  assert.equal((await db.prepare('SELECT event_revision FROM notification_jobs WHERE id=?').bind(memoCase.job.id).first()).event_revision, preferenceAfter.notification_revision);
  const occurrenceMemo = await seedAlarm({ recurrence: 'daily' });
  const occurrenceSnooze = await api(`/api/notifications/jobs/${occurrenceMemo.job.id}/snooze`, {}, 'POST');
  await api(`/api/events/${occurrenceMemo.event.id}/occurrences`, { action: 'edit', originalDate: alarmInput.eventDate, revision: occurrenceMemo.event.notification_revision,
    changes: { ...alarmInput, title: 'One occurrence renamed', note: 'Memo-only override' } }, 'PATCH');
  const retained = await db.prepare('SELECT * FROM notification_jobs WHERE id=?').bind(occurrenceMemo.job.id).first();
  assert.equal(retained.status, 'scheduled'); assert.equal(retained.scheduled_for, occurrenceSnooze.job.scheduled_for);
  assert.equal(retained.title, 'One occurrence renamed');
  assert.ok((await db.prepare(`SELECT id FROM notification_jobs WHERE id=? AND ${currentReminderSql()}`).bind(retained.id).first()));
  console.log('PASS A2: metadata-only edit preserves the accepted snooze and its exact time.');
  console.log('PASS A2/A3: occurrence memo edits and preparation visibility preserve snooze; preference changes fence stale editors.');

  const legacy = await seedAlarm();
  await sql("UPDATE notification_jobs SET status='cancelled',attempt_count=0,sent_at=NULL,lifetime_attempt_count=0 WHERE id=?", legacy.job.id);
  await sql(`INSERT INTO notification_jobs (owner_id,event_id,subscription_id,kind,title,body,scheduled_for,status,attempt_count,idempotency_key,occurrence_at,reminder_offset_minutes,event_revision,expires_at,created_at,updated_at,original_occurrence_date)
    SELECT owner_id,event_id,subscription_id,kind,title,body,scheduled_for,'sent',1,'audit-legacy-duplicate',occurrence_at,reminder_offset_minutes,event_revision,expires_at,created_at,updated_at,original_occurrence_date FROM notification_jobs WHERE id=?`, legacy.job.id);
  const newer = await db.prepare("SELECT id FROM notification_jobs WHERE idempotency_key='audit-legacy-duplicate'").first();
  const canonical = async () => (await db.prepare(`SELECT id FROM notification_jobs WHERE event_id=? AND ${currentReminderSql()}`).bind(legacy.event.id).all()).results.map(r=>r.id);
  assert.deepEqual(await canonical(), [newer.id]);
  await api(`/api/notifications/jobs/${newer.id}/snooze`, {}, 'POST');
  assert.deepEqual(await canonical(), [newer.id]);
  const validScheduled = (await db.prepare(`SELECT id FROM notification_jobs WHERE event_id=? AND status='scheduled' AND ${currentReminderSql()}`).bind(legacy.event.id).all()).results;
  assert.equal(validScheduled.length, 1);
  assert.ok((await db.prepare('SELECT lifetime_attempt_count n FROM notification_jobs WHERE id=?').bind(newer.id).first()).n>=1);
  const worker = await mf.getWorker();
  await sql("UPDATE notification_jobs SET scheduled_for=? WHERE id=?",new Date(Date.now()-1000).toISOString(),newer.id);
  await worker.scheduled({cron:'* * * * *'}); await worker.scheduled({cron:'* * * * *'});
  assert.equal(deliveries,1); assert.deepEqual(await canonical(),[newer.id]);
  await api(`/api/notifications/jobs/${newer.id}/snooze`,{},'POST');
  assert.deepEqual(await canonical(),[newer.id]);
  console.log('PASS A4: legacy canonical identity survives snooze/claim/delivery/snooze, with no duplicate push.');

  const preMigration = await seedAlarm();
  await sql("UPDATE notification_jobs SET status='failed',attempt_count=3,sent_at=NULL,lifetime_attempt_count=0 WHERE id=?",preMigration.job.id);
  await sql(`INSERT INTO notification_jobs (owner_id,event_id,subscription_id,kind,title,body,scheduled_for,status,attempt_count,idempotency_key,occurrence_at,reminder_offset_minutes,event_revision,expires_at,created_at,updated_at,original_occurrence_date)
    SELECT owner_id,event_id,subscription_id,kind,title,body,?,'scheduled',0,'audit-pre-migration-snooze',occurrence_at,reminder_offset_minutes,event_revision,expires_at,created_at,updated_at,original_occurrence_date FROM notification_jobs WHERE id=?`,new Date(Date.now()-1000).toISOString(),preMigration.job.id);
  const preMigrationSnooze = await db.prepare("SELECT id FROM notification_jobs WHERE idempotency_key='audit-pre-migration-snooze'").first();
  const preMigrationCanonical = async () => (await db.prepare(`SELECT id FROM notification_jobs WHERE event_id=? AND ${currentReminderSql()}`).bind(preMigration.event.id).all()).results.map(r=>r.id);
  assert.deepEqual(await preMigrationCanonical(),[preMigrationSnooze.id]);
  await worker.scheduled({cron:'* * * * *'});
  assert.equal(deliveries,2); assert.deepEqual(await preMigrationCanonical(),[preMigrationSnooze.id]);
  assert.equal((await db.prepare('SELECT lifetime_attempt_count n FROM notification_jobs WHERE id=?').bind(preMigrationSnooze.id).first()).n,5);
  await api(`/api/notifications/jobs/${preMigrationSnooze.id}/snooze`,{},'POST');
  await api(`/api/events/${preMigration.event.id}`,{...alarmInput,eventDate:'2030-01-01'},'PATCH');
  const cancelledHistory = await db.prepare('SELECT status,lifetime_attempt_count n FROM notification_jobs WHERE id=?').bind(preMigrationSnooze.id).first();
  assert.equal(cancelledHistory.status,'cancelled'); assert.ok(cancelledHistory.n>=5);
  console.log('PASS A4: pre-migration zero-attempt snooze outranks failed duplicate and retains history through claim/cancel.');

  // Removed weather feature: stale clients cannot trigger provider requests.
  assert.doesNotMatch(page, /LiveContext|weatherConsent|Open-Meteo|날씨|예보/);
  const retired = await mf.dispatchFetch(`http://localhost/api/events/${locationMaster.id}/context?date=2030-02-01`, {
    headers: { 'oai-authenticated-user-id': 'audit', 'oai-authenticated-user-email': 'audit@example.test' },
  });
  assert.equal(retired.status, 404);
  for (const directory of ['dist/server', 'dist/client']) {
    for (const file of (await readdir(directory, { recursive: true })).filter(f => /\.m?js$/.test(f))) {
      assert.doesNotMatch(await readFile(path.join(directory, file), 'utf8'), /(?:api|geocoding-api)\.open-meteo\.com/, 'No weather provider remains in deployed JavaScript.');
    }
  }
  console.log('PASS: weather UI, endpoint and provider calls removed; stale clients receive 404.');

  const beforeMove = new Date('2030-01-06T03:00:00Z');
  const prepEvent = (await api('/api/events', { ...input, eventDate: '2030-01-07', recurrence: 'weekly', recurrenceDay: 1, preparationsEnabled: true }, 'POST', 201)).event;
  const prepId = prepEvent.preparations[0].id;
  await setOccurrenceCompletion(db, 'audit', prepEvent.id, '2030-01-07', 'preparation', prepId, true, beforeMove);
  await api(`/api/events/${prepEvent.id}/occurrences`, { action: 'edit', originalDate: '2030-01-07', revision: prepEvent.notification_revision, changes: { title: input.title, note: '', eventDate: '2030-01-21', eventTime: '10:00', allDay: false, allDayReminderTime: '09:00', endDate: null, endTime: null } }, 'PATCH');
  const checked = await readOccurrenceCompletion(db, 'audit', prepEvent.id, '2030-01-07', beforeMove);
  assert.ok(checked.completedPreparationIds.includes(prepId)); assert.equal(checked.canCompletePreparation, false);
  await setOccurrenceCompletion(db, 'audit', prepEvent.id, '2030-01-07', 'preparation', prepId, false, beforeMove);
  console.log('PASS A7: moved occurrence preserves completion and permits uncheck (UI controls covered by usability tests).');

  const daily = { ...input, id: 50, storageId: 50, allDay: true, recurrence: 'daily', recurrenceDay: null, preparations: [], reminders: [], accent: '#000', soft: '#fff' };
  const stripProps = { schedules: [daily], now: Date.parse('2030-01-01T03:00:00Z'), onSelect() {}, completedEvents: [{eventId: 50, date: '2030-01-01'}] };
  assert.equal(overviewRows(stripProps.schedules, stripProps.now)[0].originalDate, '2030-01-01');
  assert.ok(resolveOccurrence(daily, '2030-01-02'));
  assert.ok(UpcomingStrip(stripProps));
  assert.equal(overviewRows(stripProps.schedules,stripProps.now,stripProps.completedEvents)[0].originalDate,'2030-01-02');
  assert.ok(UpcomingStrip({...stripProps, completedEvents: []}));
  console.log('PASS A8: completed daily occurrence advances to tomorrow in upcoming cards.');
} finally { await mf.dispose(); await mock.close(); }
console.log('All audit-fix regressions passed. No production data or real push delivery used.');
