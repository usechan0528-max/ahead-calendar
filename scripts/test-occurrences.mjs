// Isolated D1 + production API regression. No user data or real push traffic.
import { withCurrentEventRevision } from './current-event-revision.mjs';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
const cache = new Map();
async function moduleUrl(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  let source = ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const match of [...source.matchAll(/from ['"](\.[^'"]+)['"]/g)]) source = source.replace(match[0], `from '${await moduleUrl(path.resolve(path.dirname(file), `${match[1]}.ts`))}'`);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  cache.set(file, url); return url;
}
const { nextOccurrenceDate } = await import(await moduleUrl('lib/recurrence.ts'));
const { resolveOccurrence, resolvedOccurrencesInRange, relevantResolvedOccurrence, resolvedReminderOccurrences } = await import(await moduleUrl('lib/occurrences.ts'));
const { partitionTodaySchedules } = await import(await moduleUrl('lib/today-schedule.ts'));
const { materializeReminders, currentReminderSql } = await import(await moduleUrl('db/reminder-planner.ts'));
const { setOccurrenceCompletion, readProgress, readOccurrenceCompletion } = await import(await moduleUrl('db/progress.ts'));
const base = { title: '기본 계획', note: '', eventDate: '2030-01-01', eventTime: '10:00', recurrence: 'monthly', recurrenceInterval: 1, recurrenceDay: 1, recurrenceUntil: '2030-03-01' };
assert.equal(nextOccurrenceDate(base, '2030-03-01'), '2030-03-01');
assert.equal(nextOccurrenceDate(base, '2030-03-02'), null);
assert.equal(nextOccurrenceDate({ ...base, eventDate: '2028-02-29', recurrence: 'yearly', recurrenceUntil: '2029-02-28' }, '2029-01-01'), '2029-02-28');
const changes = { title: '옮긴 계획', note: '이 회차만', eventDate: '2030-02-01', eventTime: '11:00', allDay: false, allDayReminderTime: '09:00', endDate: null, endTime: null };
const moved = { ...base, storageId: 9, occurrenceOverrides: [{ originalDate: '2030-01-01', cancelled: false, changes, updatedAt: '2029-12-01T00:00:00.000Z' }] };
const sameDay = resolvedOccurrencesInRange(moved, '2030-02-01', '2030-02-01');
assert.deepEqual(sameDay.map((r) => r.originalDate), ['2030-02-01', '2030-01-01']);
assert.equal(sameDay[1].event.title, '옮긴 계획');
assert.equal(resolvedOccurrencesInRange(moved, '2030-01-01', '2030-01-31').length, 0);
const today = partitionTodaySchedules([moved], [{ eventId: 9, date: '2030-01-01' }], Date.parse('2030-02-01T03:00:00Z'));
assert.equal(today.completed[0].originalDate, '2030-01-01');
assert.equal(today.remaining[0].originalDate, '2030-02-01');
assert.equal(resolveOccurrence({ ...moved, occurrenceOverrides: [{ ...moved.occurrenceOverrides[0], cancelled: true }] }, '2030-01-01'), null);
assert.equal(relevantResolvedOccurrence({ ...base, recurrenceUntil: '2030-01-01', occurrenceOverrides: [{ originalDate: '2030-01-01', cancelled: true, changes: null, updatedAt: '' }] }, '2030-01-01'), null);
assert.equal(relevantResolvedOccurrence(base, '2031-01-01'), null);
assert.equal(relevantResolvedOccurrence({ ...moved, occurrenceOverrides: [{ ...moved.occurrenceOverrides[0], changes: { ...changes, eventDate: '2030-12-01' } }] }, '2030-01-02').originalDate, '2030-02-01');
assert.equal(resolvedReminderOccurrences(moved, 60, new Date('2030-02-01T00:00:00Z'), new Date('2030-02-01T03:00:00Z')).length, 2);
console.log('PASS: inclusive cutoff, leap dates, cross-month moves, same-day distinct identities, cancellation and ended series');

const require = createRequire(import.meta.url);
const { Miniflare, createFetchMock } = createRequire(require.resolve('wrangler/package.json'))('miniflare');
const mock = createFetchMock(); mock.disableNetConnect();
const files = await readdir('dist/server', { recursive: true });
const mf = new Miniflare({ modules: ['index.js', ...files.filter((f) => /\.m?js$/.test(f) && f !== 'index.js')].map((f) => ({ type: 'ESModule', path: path.resolve('dist/server', f) })),
  modulesRoot: path.resolve('dist/server'), compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], fetchMock: mock });
try {
  const db = await mf.getD1Database('DB');
  for (const file of (await readdir('drizzle')).filter((f) => f.endsWith('.sql')).sort()) {
    for (const statement of (await readFile(path.join('drizzle', file), 'utf8')).split('--> statement-breakpoint')) if (statement.trim()) await db.prepare(statement).run();
  }
  const sql = (s, ...v) => db.prepare(s).bind(...v).run();
  await sql('INSERT INTO notification_scheduler_state (id, last_completed_at) VALUES (1, ?)', new Date().toISOString());
  async function api(url, { method = 'GET', owner = 'a', body } = {}) {
    body = await withCurrentEventRevision(db, url, method, owner, body);
    return mf.dispatchFetch(`http://localhost${url}`, { method, headers: { 'content-type': 'application/json', ...(owner ? { 'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': `${owner}@example.test` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function json(url, options, status = 200) {
    const response = await api(url, options); assert.equal(response.status, status, await response.clone().text());
    return response.json();
  }
  const input = { ...base, category: '일정', initialReminderOffsets: [0] };
  let event = (await json('/api/events', { method: 'POST', body: input }, 201)).event;
  const endpoint = `/api/events/${event.id}`;
  const occurrenceEndpoint = `${endpoint}/occurrences`;
  async function mutate(action, originalDate = '2030-01-01', change = changes) {
    event = (await json(occurrenceEndpoint, { method: 'PATCH', body: { action, originalDate, changes: change, revision: event.notification_revision } })).event;
    return event;
  }
  assert.equal((await api(occurrenceEndpoint, { method: 'PATCH', owner: null, body: {} })).status, 401);
  assert.equal((await api(occurrenceEndpoint, { method: 'PATCH', owner: 'b', body: { action: 'cancel', originalDate: '2030-01-01', revision: 0 } })).status, 404);
  for (const body of [null, {}, { action: ['cancel'], originalDate: '2030-01-01', revision: 0 }, { action: 'cancel', originalDate: '2030-01-02', revision: 0 }, { action: 'cancel', originalDate: '2030-04-01', revision: 0 }, { action: 'edit', originalDate: '2030-01-01', revision: 0, changes: { ...changes, eventDate: '2030-02-31' } }]) {
    assert.equal((await api(occurrenceEndpoint, { method: 'PATCH', body })).status, 400);
  }
  for (const until of ['2030-02-31', '2029-12-31', 42]) assert.equal((await api('/api/events', { method: 'POST', body: { ...input, recurrenceUntil: until } })).status, 400);
  await mutate('edit');
  assert.equal(event.event_date, '2030-01-01'); assert.equal(event.title, base.title);
  assert.equal(event.occurrenceOverrides[0].changes.title, changes.title);
  assert.equal((await api(occurrenceEndpoint, { method: 'PATCH', body: { action: 'cancel', originalDate: '2030-01-01', revision: 0 } })).status, 409);
  assert.equal((await api(endpoint, { method: 'PATCH', body: { ...input, recurrenceDay: 5 } })).status, 409);
  await mutate('cancel');
  assert.equal(event.occurrenceOverrides[0].cancelled, true);
  await mutate('restore');
  assert.equal(event.occurrenceOverrides[0].cancelled, false); assert.equal(event.occurrenceOverrides[0].changes, null);
  const revision = event.notification_revision;
  const race = await Promise.all(['cancel', 'edit'].map((action) => api(occurrenceEndpoint, { method: 'PATCH', body: { action, originalDate: '2030-01-01', changes, revision } })));
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  event = (await json('/api/events')).events.find((e) => e.id === event.id);
  await mutate('restore');
  console.log('PASS: occurrence API ownership, malformed data, cutoff validation, master preservation, optimistic edit concurrency and restoration');

  const future = new Date('2030-01-01T03:00:00Z');
  await setOccurrenceCompletion(db, 'a', event.id, '2030-01-01', 'event', 0, true, future);
  const xp = (await readProgress(db, 'a', future)).totalXp;
  await mutate('edit');
  const reading = await readOccurrenceCompletion(db, 'a', event.id, '2030-01-01', future);
  assert.equal(reading.complete, true); assert.equal(reading.canCompleteEvent, false);
  await assert.rejects(setOccurrenceCompletion(db, 'a', event.id, '2030-01-01', 'event', 0, true, future), (e) => e.status === 400);
  await setOccurrenceCompletion(db, 'a', event.id, '2030-01-01', 'event', 0, false, new Date('2030-02-01T03:00:00Z'));
  await setOccurrenceCompletion(db, 'a', event.id, '2030-01-01', 'event', 0, true, new Date('2030-02-01T03:00:00Z'));
  assert.equal((await readProgress(db, 'a', future)).totalXp, xp);
  await mutate('cancel');
  await assert.rejects(setOccurrenceCompletion(db, 'a', event.id, '2030-01-01', 'event', 0, true, future), (e) => e.status === 400);
  assert.equal((await readProgress(db, 'a', future)).totalXp, xp);
  await mutate('restore');
  assert.equal((await readOccurrenceCompletion(db, 'a', event.id, '2030-01-01', future)).complete, true);
  console.log('PASS: moved-time eligibility, immutable original-date completions/XP, cancellation and restoration preserve earned records');

  await sql("INSERT INTO push_subscriptions (id, owner_id, endpoint, p256dh, auth, reminders_enabled_at) VALUES (90,'a','https://fcm.googleapis.com/fcm/send/isolated-occurrence','key','auth','2029-12-01T00:00:00.000Z')");
  event = (await json('/api/events', { method: 'POST', body: { ...input, recurrence: 'daily', recurrenceDay: null, recurrenceUntil: null } }, 201)).event;
  const alarmEndpoint = `/api/events/${event.id}/occurrences`;
  const at = new Date('2029-12-31T12:00:00Z');
  const plan = () => materializeReminders(db, at, { eventId: event.id });
  const jobs = async () => (await db.prepare('SELECT * FROM notification_jobs WHERE event_id = ? ORDER BY id').bind(event.id).all()).results;
  async function alarm(action, originalDate, change) {
    event = (await json(alarmEndpoint, { method: 'PATCH', body: { action, originalDate, changes: change, revision: event.notification_revision } })).event;
  }
  await plan();
  const first = (await jobs())[0]; assert.ok(first);
  // Simulate pre-release identity with no original_date column populated.
  await sql('UPDATE notification_jobs SET original_occurrence_date = NULL, idempotency_key = ? WHERE id = ?', `reminder:${event.id}:${first.occurrence_at}:0:90`, first.id);
  await alarm('edit', '2030-01-01', { ...changes, eventDate: '2030-01-01', eventTime: '11:00' });
  await plan();
  let rows = await jobs(); assert.equal(rows.length, 1); assert.equal(rows[0].id, first.id);
  assert.equal(rows[0].occurrence_at, '2030-01-01T02:00:00.000Z');
  assert.equal(rows[0].original_occurrence_date, '2030-01-01');
  await alarm('cancel', '2030-01-01'); await plan();
  assert.equal((await jobs())[0].status, 'cancelled');
  assert.equal((await api(`/api/notifications/jobs/${first.id}/snooze`, { method: 'POST' })).status, 409);
  await alarm('restore', '2030-01-01'); await plan();
  assert.equal((await jobs())[0].status, 'scheduled');
  await sql("UPDATE notification_jobs SET status = 'sent', attempt_count = 1, sent_at = ? WHERE id = ?", at.toISOString(), first.id);
  await alarm('edit', '2030-01-01', { ...changes, eventDate: '2030-01-01', eventTime: '12:00' }); await plan();
  assert.equal((await jobs()).length, 1); assert.equal((await jobs())[0].status, 'sent');
  assert.equal((await api(`/api/notifications/jobs/${first.id}/snooze`, { method: 'POST' })).status, 409);
  // A different original date moved onto the same day gets a distinct job.
  await alarm('edit', '2030-01-02', { ...changes, eventDate: '2030-01-01', eventTime: '13:00' }); await plan();
  rows = await jobs(); assert.equal(rows.length, 2); assert.equal(rows[1].original_occurrence_date, '2030-01-02');
  const second = rows[1];
  await sql("UPDATE notification_jobs SET status = 'scheduled', attempt_count = 1 WHERE id = ?", second.id);
  await alarm('cancel', '2030-01-01');
  const unaffected = (await jobs()).find((j) => j.id === second.id);
  assert.equal(unaffected.status, 'scheduled'); assert.equal(unaffected.event_revision, event.notification_revision);
  const valid = await db.prepare(`SELECT id FROM notification_jobs WHERE id = ? AND ${currentReminderSql()}`).bind(second.id).first();
  assert.ok(valid, 'Other occurrence snooze remains current.');
  // Legacy duplicate unsent rows must never both pass claim/snooze validity.
  await sql(`INSERT INTO notification_jobs (owner_id,event_id,subscription_id,kind,title,body,scheduled_for,idempotency_key,occurrence_at,reminder_offset_minutes,event_revision,expires_at,created_at)
    VALUES ('a',?,90,'reminder','duplicate','duplicate',?,'legacy-duplicate',?,0,?,?,?)`, event.id, second.scheduled_for, second.occurrence_at, event.notification_revision, second.expires_at, second.created_at);
  const validRows = await db.prepare(`SELECT id FROM notification_jobs WHERE event_id = ? AND status = 'scheduled' AND ${currentReminderSql()}`).bind(event.id).all();
  assert.equal(validRows.results.length, 1);
  console.log('PASS: legacy reservation reuse, current payload/time refresh, no sent replay, canceled snooze blocked, unaffected snoozes and same-day identities');

  event = (await json(`/api/events/${event.id}`, { method: 'PATCH', body: { ...input, recurrence: 'daily', recurrenceDay: null, recurrenceUntil: '2030-01-01' } })).event;
  await plan();
  assert.ok((await jobs()).filter((j) => j.original_occurrence_date === '2030-01-02').every((j) => j.status !== 'scheduled'));
  assert.ok(event.occurrenceOverrides.some((o) => o.originalDate === '2030-01-02'));
  assert.equal((await api(`/api/events/${event.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM event_occurrence_overrides WHERE event_id = ?').bind(event.id).first()).n, 0);
  console.log('PASS: shortened cutoff invalidates future jobs without deleting overrides; event deletion cascades exception data');
} finally { await mf.dispose(); }
console.log('All recurrence exception checks passed. No production data or real notifications were used.');
