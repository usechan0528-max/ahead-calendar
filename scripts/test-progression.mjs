// Isolated product rules, D1 transactions and production API. Never sends real push.
import { withCurrentEventRevision } from './current-event-revision.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { DAILY_XP_CAP, FINAL_XP, LEVEL_THRESHOLDS, growthLevel } from '../lib/progression.ts';
const urls = new Map();
async function moduleUrl(file) {
  file = path.resolve(file);
  if (urls.has(file)) return urls.get(file);
  let source = ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const match of [...source.matchAll(/from ['"](\.[^'"]+)['"]/g)]) source = source.replace(match[0], `from '${await moduleUrl(path.resolve(path.dirname(file), `${match[1]}.ts`))}'`);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  urls.set(file, url); return url;
}
const { readProgress, readOccurrenceCompletion, setDailyGoal, setOccurrenceCompletion } = await import(await moduleUrl('db/progress.ts'));
const { materializeReminders } = await import(await moduleUrl('db/reminder-planner.ts'));
assert.equal(LEVEL_THRESHOLDS.length, 50);
assert.equal(LEVEL_THRESHOLDS[0], 0);
assert.equal(LEVEL_THRESHOLDS.at(-1), 12_000);
assert.ok(LEVEL_THRESHOLDS.every((n, i) => !i || n > LEVEL_THRESHOLDS[i - 1]));
assert.equal(growthLevel(0).stage, 'P');
assert.equal(growthLevel(11_999).level, 49);
assert.equal(growthLevel(12_000).stage, 'J');
assert.equal(growthLevel(100_000).level, 50);
assert.equal(Math.ceil(FINAL_XP / DAILY_XP_CAP), 200);
console.log('PASS: 50 progressive levels, exact 12000-XP J threshold, 200-day minimum');

const require = createRequire(import.meta.url);
const { Miniflare, createFetchMock } = createRequire(require.resolve('wrangler/package.json'))('miniflare');
const mock = createFetchMock(); mock.disableNetConnect();
const files = await readdir('dist/server', { recursive: true });
const mf = new Miniflare({
  modules: ['index.js', ...files.filter((f) => /\.m?js$/.test(f) && f !== 'index.js')].map((f) => ({ type: 'ESModule', path: path.resolve('dist/server', f) })),
  modulesRoot: path.resolve('dist/server'), compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], fetchMock: mock,
});
try {
  const db = await mf.getD1Database('DB');
  const sql = (s, ...v) => db.prepare(s).bind(...v).run();
  for (const file of (await readdir('drizzle')).filter((f) => f.endsWith('.sql')).sort()) {
    for (const statement of (await readFile(path.join('drizzle', file), 'utf8')).split('--> statement-breakpoint')) if (statement.trim()) await db.prepare(statement).run();
  }
  let nextId = 100;
  const date = '2030-09-19';
  const now = new Date(`${date}T12:00:00+09:00`);
  async function seed(owner, overrides = {}) {
    const event = { id: ++nextId, date, time: '00:00', recurrence: 'none', allDay: 1, end: null, ...overrides };
    await sql('INSERT INTO events (id, owner_id, title, category, event_date, event_time, recurrence, all_day, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', event.id, owner, '실천', '일정', event.date, event.time, event.recurrence, event.allDay, event.end);
    return event.id;
  }
  const complete = (owner, id, on = date, value = true, at = now, database = db) => setOccurrenceCompletion(database, owner, id, on, 'event', 0, value, at);
  const a = await seed('a');
  await setDailyGoal(db, 'a', 3, now);
  await Promise.all(Array.from({ length: 12 }, () => complete('a', a)));
  assert.equal((await readProgress(db, 'a', now)).totalXp, 10);
  await complete('a', a, date, false);
  await complete('a', a);
  assert.equal((await readProgress(db, 'a', now)).totalXp, 10);
  const b = await seed('a'), c = await seed('a');
  await Promise.all([b, c].map((id) => complete('a', id)));
  assert.equal((await readProgress(db, 'a', now)).totalXp, 40);
  assert.equal((await readProgress(db, 'a', now)).goal.achieved, true);
  await assert.rejects(setDailyGoal(db, 'a', 1, now), (e) => e.status === 409);
  const more = await Promise.all(Array.from({ length: 5 }, () => seed('a')));
  await Promise.all(more.map((id) => complete('a', id)));
  assert.equal((await readProgress(db, 'a', now)).todayXp, 60);
  const zero = await db.prepare("SELECT action_key FROM xp_ledger WHERE owner_id = 'a' AND kind = 'event' AND xp = 0").first();
  assert.ok(zero);
  const zeroId = Number(zero.action_key.split(':')[1]);
  const tomorrow = new Date('2030-09-20T12:00:00+09:00');
  await complete('a', zeroId, date, false, tomorrow); await complete('a', zeroId, date, true, tomorrow);
  assert.equal((await readProgress(db, 'a', tomorrow)).todayXp, 0);
  assert.equal((await readProgress(db, 'a', tomorrow)).totalXp, 60);
  console.log('PASS: concurrent deduplication, immutable undo/recomplete receipts, shared cap, one bonus and zero-XP replay across KST days');

  await sql("INSERT INTO xp_ledger (owner_id, action_key, kind, earned_date, xp, created_at) VALUES ('partial', 'fixture', 'preparation', ?, 59, ?)", date, now.toISOString());
  const partial = await Promise.all([seed('partial'), seed('partial')]);
  await Promise.all(partial.map((id) => complete('partial', id)));
  assert.equal((await readProgress(db, 'partial', now)).todayXp, 60);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM xp_ledger WHERE owner_id = 'partial' AND xp = 1").first()).n, 1);
  const before = await readProgress(db, 'a', now);
  await assert.rejects(complete('intruder', a), (e) => e.status === 404);
  const future = await seed('future', { date: '2030-09-20' });
  await assert.rejects(complete('future', future, '2030-09-20'), (e) => e.status === 400);
  const timed = await seed('future', { time: '18:00', allDay: 0 });
  await assert.rejects(complete('future', timed), (e) => e.status === 400);
  const span = await seed('span', { date: '2030-09-18', end: '2030-09-20' });
  await assert.rejects(complete('span', span, date), (e) => e.status === 400);
  await complete('span', span, '2030-09-18');
  assert.equal((await readProgress(db, 'span', now)).totalXp, 10);
  const weekly = await seed('weekly', { recurrence: 'weekly' });
  await assert.rejects(complete('weekly', weekly, '2030-09-20'), (e) => e.status === 400);
  assert.deepEqual(await readProgress(db, 'a', now), before);
  console.log('PASS: partial cap allocation, owner isolation, future/time/recurrence validation and multi-day start identity');

  const prepEvent = await seed('prep', { recurrence: 'daily', date: '2030-09-18' });
  await sql("INSERT INTO preparation_items (id, event_id, title, timing, status) VALUES (900, ?, '기존 완료', '미리', 'complete')", prepEvent);
  assert.deepEqual((await readOccurrenceCompletion(db, 'prep', prepEvent, '2030-09-18', now)).completedPreparationIds, [900]);
  assert.deepEqual((await readOccurrenceCompletion(db, 'prep', prepEvent, date, now)).completedPreparationIds, []);
  await setOccurrenceCompletion(db, 'prep', prepEvent, '2030-09-18', 'preparation', 900, false, now);
  await setOccurrenceCompletion(db, 'prep', prepEvent, '2030-09-18', 'preparation', 900, true, now);
  assert.equal((await readProgress(db, 'prep', now)).totalXp, 0);
  await setOccurrenceCompletion(db, 'prep', prepEvent, date, 'preparation', 900, true, now);
  assert.equal((await readProgress(db, 'prep', now)).totalXp, 3);
  assert.deepEqual((await readOccurrenceCompletion(db, 'prep', prepEvent, '2030-09-20', now)).completedPreparationIds, []);
  await assert.rejects(setOccurrenceCompletion(db, 'prep', prepEvent, '2030-09-21', 'preparation', 900, true, now), (e) => e.status === 400);
  await assert.rejects(setOccurrenceCompletion(db, 'prep', prepEvent, date, 'preparation', 9999, true, now), (e) => e.status === 409);
  console.log('PASS: preparation completion per occurrence, legacy preservation without retroactive XP and invalid preparation rejection');

  async function api(url, method = 'GET', body, owner = 'api') {
    body = await withCurrentEventRevision(db, url, method, owner, body);
    const headers = { 'content-type': 'application/json' };
    if (owner) Object.assign(headers, { 'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': `${owner}@test.example` });
    return mf.dispatchFetch(`http://localhost${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  const apiEvent = await seed('api', { date: '2026-01-02', recurrence: 'daily' });
  await sql("INSERT INTO preparation_items (id, event_id, title, timing, status) VALUES (901, ?, '기존 기록', '미리', 'complete')", apiEvent);
  assert.equal((await api(`/api/preparations/901`, 'PATCH', { status: 'pending' })).status, 200);
  assert.equal((await api(`/api/events/${apiEvent}`, 'PATCH', { title: '날짜 수정', category: '일정', eventDate: '2026-01-01', eventTime: '00:00', recurrence: 'daily', allDay: true })).status, 200);
  const legacyAttempt = await api(`/api/events/${apiEvent}/completion`, 'PATCH', { date: '2026-01-02', kind: 'preparation', itemId: 901, complete: true });
  assert.equal(legacyAttempt.status, 200, await legacyAttempt.clone().text());
  assert.equal((await legacyAttempt.json()).progress.totalXp, 0);
  assert.equal((await api('/api/progress', 'GET', undefined, null)).status, 401);
  assert.equal((await api(`/api/events/${apiEvent}/completion?date=2026-01-02`, 'GET', undefined, 'other')).status, 404);
  for (const body of [null, [], {}, { target: '3' }, { target: 0 }, { target: 6 }]) assert.equal((await api('/api/progress', 'PATCH', body)).status, 400);
  for (const body of [null, { date, kind: 'event', complete: 'true' }, { date, kind: 'preparation', itemId: -1, complete: true }]) assert.equal((await api(`/api/events/${apiEvent}/completion`, 'PATCH', body)).status, 400);
  console.log('PASS: built API auth/validation and legacy status plus anchor edits cannot create retroactive XP');

  const rollback = await seed('rollback');
  const failing = { prepare: (...args) => db.prepare(...args), batch: (statements) => db.batch([...statements, db.prepare('INSERT INTO table_that_does_not_exist VALUES (1)')]) };
  await assert.rejects(complete('rollback', rollback, date, true, now, failing));
  assert.equal((await readProgress(db, 'rollback', now)).totalXp, 0);
  assert.equal((await readOccurrenceCompletion(db, 'rollback', rollback, date, now)).complete, false);
  const raced = await seed('raced');
  const racing = { prepare: (...args) => db.prepare(...args), batch: async (statements) => { await sql('UPDATE events SET notification_revision = notification_revision + 1 WHERE id = ?', raced); return db.batch(statements); } };
  await assert.rejects(complete('raced', raced, date, true, now, racing), (e) => e.status === 409);
  assert.equal((await readProgress(db, 'raced', now)).totalXp, 0);
  await sql('DELETE FROM events WHERE id = ?', a);
  assert.equal((await readProgress(db, 'a', now)).totalXp, 60);
  console.log('PASS: batch rollback, edit revision fence and XP history survives source deletion');

  const alarm = await seed('alarm', { allDay: 0, time: '12:00' });
  await sql("INSERT INTO push_subscriptions (id, owner_id, endpoint, p256dh, auth, reminders_enabled_at) VALUES (500, 'alarm', 'https://fcm.googleapis.com/fcm/send/isolated', 'key', 'auth', '2030-09-19T00:00:00.000Z')");
  await sql('INSERT INTO reminder_rules (event_id, offset_minutes) VALUES (?, 0)', alarm);
  await materializeReminders(db, now, { eventId: alarm });
  assert.equal((await db.prepare('SELECT status FROM notification_jobs WHERE event_id = ?').bind(alarm).first()).status, 'scheduled');
  await complete('alarm', alarm);
  assert.equal((await db.prepare('SELECT status FROM notification_jobs WHERE event_id = ?').bind(alarm).first()).status, 'cancelled');
  await materializeReminders(db, now, { eventId: alarm });
  assert.equal((await db.prepare('SELECT status FROM notification_jobs WHERE event_id = ?').bind(alarm).first()).status, 'cancelled');
  console.log('PASS: completing an occurrence cancels its queued reminder and planner does not revive it');
} finally { await mf.dispose(); }
