// Pure date cases + built Worker against isolated D1. No real data or push traffic.
import { withCurrentEventRevision } from './current-event-revision.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createECDH, randomBytes } from 'node:crypto';
import ts from 'typescript';
import { isValidEventDate } from '../lib/recurrence.ts';
import { getMonthDays } from '../lib/calendar-view.ts';

// Resolve the same extensionless TypeScript modules the production bundler uses.
const urls = new Map();
async function moduleUrl(file) {
  file = path.resolve(file);
  if (urls.has(file)) return urls.get(file);
  let source = ts.transpileModule(await readFile(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const match of [...source.matchAll(/from ['"](\.[^'"]+)['"]/g)]) {
    source = source.replace(match[0], `from '${await moduleUrl(path.resolve(path.dirname(file), `${match[1]}.ts`))}'`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  urls.set(file, url);
  return url;
}
const { occurrencesInRange, occurrenceEndDate, occurrenceDayStatus, relevantOccurrenceDate, lastCoveredDate, reminderTime, formatEventRange } = await import(await moduleUrl('lib/event-duration.ts'));
const { materializeReminders } = await import(await moduleUrl('db/reminder-planner.ts'));
const base = { eventDate: '2030-01-30', eventTime: '18:00', allDay: true, endDate: '2030-02-02', endTime: null, recurrence: 'none', recurrenceInterval: 1, recurrenceDay: null };
assert.deepEqual(occurrencesInRange(base, '2030-02-01', '2030-02-28'), [{ start: '2030-01-30', end: '2030-02-02', lastCovered: '2030-02-02' }]);
assert.equal(reminderTime(base), '09:00');
assert.equal(reminderTime({ ...base, allDayReminderTime: '08:15' }), '08:15');
assert.equal(reminderTime({ ...base, allDay: false }), '18:00');
assert.equal(occurrenceDayStatus(base, base.eventDate, '2030-02-02'), 'ongoing');
assert.equal(occurrenceDayStatus(base, base.eventDate, '2030-02-03'), 'past');
assert.match(formatEventRange(base, base.eventDate), /종일/);
const midnight = { ...base, allDay: false, endTime: '00:00' };
assert.equal(lastCoveredDate(midnight, midnight.eventDate), '2030-02-01');
assert.deepEqual(occurrencesInRange(midnight, '2030-02-02', '2030-02-02'), []);
const yearly = { ...base, eventDate: '2028-02-29', endDate: '2028-03-02', recurrence: 'yearly' };
assert.equal(occurrenceEndDate(yearly, '2029-02-28'), '2029-03-02');
const monthly = { ...base, eventDate: '2030-01-31', recurrence: 'monthly', recurrenceDay: 31 };
assert.deepEqual(occurrencesInRange(monthly, '2030-03-01', '2030-03-02').map((o) => [o.start, o.end]), [['2030-02-28', '2030-03-02']]);
const overlap = { ...base, eventDate: '2030-01-01', endDate: '2030-01-03', recurrence: 'daily' };
assert.equal(occurrencesInRange(overlap, '2030-01-05', '2030-01-05').length, 3);
assert.equal(relevantOccurrenceDate(overlap, '2030-01-05'), '2030-01-05');
const overlappingTimed = { ...overlap, allDay: false, endTime: '06:00' };
assert.equal(relevantOccurrenceDate(overlappingTimed, '2030-01-05', new Date('2030-01-05T15:00:00+09:00')), '2030-01-04');
const overnight = { ...base, eventDate: '2030-09-09', endDate: '2030-09-10', allDay: false, endTime: '01:00', recurrence: 'weekly', recurrenceDay: 1 };
assert.equal(occurrenceDayStatus(overnight, '2030-09-09', '2030-09-10', new Date('2030-09-10T15:00:00+09:00')), 'past');
assert.equal(relevantOccurrenceDate(overnight, '2030-09-10', new Date('2030-09-10T15:00:00+09:00')), '2030-09-16');
assert.equal(occurrenceDayStatus({ ...overnight, endDate: '2030-09-09', endTime: '20:00' }, '2030-09-09', '2030-09-09', new Date('2030-09-09T19:00:00+09:00')), 'ongoing');
const edgeDays = getMonthDays('9999-12').filter(isValidEventDate);
assert.equal(occurrencesInRange({ ...base, eventDate: '9999-12-31', endDate: null }, edgeDays[0], edgeDays.at(-1)).length, 1);
assert.deepEqual(occurrencesInRange({ ...base, eventDate: '1900-01-01', endDate: '1900-01-03' }, '1900-01-01', '1900-01-02').map((o) => o.start), ['1900-01-01']);
console.log('PASS: inclusive all-day ranges, exclusive midnight, cross-month/leap-year repeats, overlapping/ongoing instances and supported year edges');

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve('wrangler/package.json'));
const { Miniflare, createFetchMock } = wranglerRequire('miniflare');
const mock = createFetchMock();
mock.disableNetConnect();
const vapid = createECDH('prime256v1');
vapid.generateKeys();
const files = await readdir('dist/server', { recursive: true });
const mf = new Miniflare({
  modules: ['index.js', ...files.filter((name) => /\.m?js$/.test(name) && name !== 'index.js')].map((name) => ({ type: 'ESModule', path: path.resolve('dist/server', name) })),
  modulesRoot: path.resolve('dist/server'), compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'], fetchMock: mock,
  bindings: {
    VAPID_PUBLIC_KEY: vapid.getPublicKey().toString('base64url'), VAPID_PRIVATE_KEY: vapid.getPrivateKey().toString('base64url'),
    VAPID_SUBJECT: 'https://ahead.example', NOTIFICATION_ACTION_SECRET: randomBytes(32).toString('base64url'), SCHEDULER_SECRET: randomBytes(32).toString('base64url'),
  },
});
try {
  const db = await mf.getD1Database('DB');
  const sql = (statement, ...values) => db.prepare(statement).bind(...values).run();
  for (const file of (await readdir('drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
    if (file.startsWith('0010_')) await sql("INSERT INTO events (id, owner_id, title, category, event_date, event_time) VALUES (100, 'owner-a', '기존 일정', '일정', '2030-09-10', '17:30')");
    for (const statement of (await readFile(path.join('drizzle', file), 'utf8')).split('--> statement-breakpoint')) {
      if (statement.trim()) await db.prepare(statement).run();
    }
  }
  const legacy = await db.prepare('SELECT * FROM events WHERE id = 100').first();
  assert.equal(legacy.event_time, '17:30');
  assert.equal(legacy.all_day, 0);
  assert.equal(legacy.all_day_reminder_time, '09:00');
  assert.equal(legacy.end_date, null);
  assert.equal(legacy.end_time, null);
  async function api(url, { method = 'GET', owner = 'owner-a', body, raw } = {}) {
    body = await withCurrentEventRevision(db, url, method, owner, body);
    const headers = { 'content-type': 'application/json' };
    if (owner) Object.assign(headers, { 'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': `${owner}@example.test` });
    return mf.dispatchFetch(`http://localhost${url}`, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  }
  async function json(url, options, status = 200) {
    const response = await api(url, options);
    assert.equal(response.status, status, `${url}: ${await response.clone().text()}`);
    return response.json();
  }
  const input = { title: '종일 여행', category: '여행', eventDate: '2030-09-10', eventTime: '17:30', allDay: true, endDate: '2030-09-12', recurrence: 'none' };
  const a = (await json('/api/events', { method: 'POST', body: input }, 201)).event;
  const endpoint = `/api/events/${a.id}`;
  const event = async () => (await json('/api/events')).events.find((item) => item.id === a.id);
  assert.equal(a.all_day, 1);
  assert.equal(a.event_time, '17:30');
  assert.equal(a.all_day_reminder_time, '09:00');
  assert.equal(a.end_date, '2030-09-12');
  assert.equal(a.end_time, null);
  const single = (await json('/api/events', { method: 'POST', body: { title: '하루 기념일', category: '기념일', eventDate: input.eventDate, allDay: true } }, 201)).event;
  assert.equal(single.all_day, 1);
  assert.equal(single.all_day_reminder_time, '09:00');
  const timed = (await json('/api/events', { method: 'POST', body: { ...input, allDay: false, endTime: '00:00' } }, 201)).event;
  assert.equal(timed.end_time, '00:00');
  assert.equal(timed.all_day, 0);
  assert.equal((await api(endpoint, { method: 'PATCH', owner: null, body: input })).status, 401);
  assert.equal((await api(endpoint, { method: 'PATCH', owner: 'owner-b', body: input })).status, 404);
  const invalid = [null, [], { ...input, allDay: 'true' }, { ...input, allDayReminderTime: '24:00' }, { ...input, endDate: '2030-02-30' },
    { ...input, endDate: '2030-09-09' }, { ...input, endDate: '2031-09-12' }, { ...input, endTime: '10:00' },
    { ...input, allDay: false }, { ...input, allDay: false, endDate: null, endTime: '18:00' },
    { ...input, allDay: false, endDate: input.eventDate, endTime: input.eventTime }, { ...input, allDay: false, endDate: input.eventDate, endTime: '17:29' }];
  for (const body of invalid) {
    assert.equal((await api('/api/events', { method: 'POST', body })).status, 400, JSON.stringify(body));
    assert.equal((await api(endpoint, { method: 'PATCH', body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await api(endpoint, { method: 'PATCH', raw: '{bad' })).status, 400);
  const oldClient = { title: '이전 클라이언트 수정', category: input.category, eventDate: input.eventDate, eventTime: input.eventTime, recurrence: 'none' };
  await json(endpoint, { method: 'PATCH', body: oldClient });
  assert.equal((await event()).all_day, 1);
  assert.equal((await event()).end_date, input.endDate);
  assert.equal((await event()).all_day_reminder_time, '09:00');
  console.log('PASS: migration preserves existing time; duration CRUD, legacy PATCH preservation, ownership and malformed range validation');

  await sql("INSERT INTO push_subscriptions (id, owner_id, endpoint, p256dh, auth, reminders_enabled_at) VALUES (10, 'owner-a', 'https://fcm.googleapis.com/fcm/send/isolated-duration', 'test-key', 'test-auth', '2030-09-09T00:00:00.000Z')");
  for (const rule of (await event()).reminders) await json(`${endpoint}/reminders/${rule.id}`, { method: 'DELETE' });
  await json(`${endpoint}/reminders`, { method: 'POST', body: { offsetMinutes: 0 } }, 201);
  const now = new Date('2030-09-09T12:00:00Z');
  const plan = (at = now) => materializeReminders(db, at, { eventId: a.id });
  const jobs = async () => (await db.prepare('SELECT * FROM notification_jobs WHERE event_id = ? ORDER BY id').bind(a.id).all()).results;
  await plan();
  let reservations = await jobs();
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].scheduled_for, '2030-09-10T00:00:00.000Z');
  assert.match(reservations[0].body, /종일 일정/);
  await plan();
  await plan(new Date('2030-09-10T12:00:00Z'));
  await plan(new Date('2030-09-11T12:00:00Z'));
  assert.equal((await jobs()).length, 1, 'Covered dates must not create daily reminders.');
  const oldJob = reservations[0];
  await json(endpoint, { method: 'PATCH', body: { ...input, allDayReminderTime: '11:15' } });
  await plan();
  reservations = await jobs();
  assert.equal(reservations.find((job) => job.id === oldJob.id).status, 'scheduled');
  assert.equal(reservations.length, 1, 'Changing alarm time updates the same stable occurrence identity.');
  assert.equal(reservations.filter((job) => job.status === 'scheduled').length, 1);
  assert.equal(reservations.find((job) => job.status === 'scheduled').scheduled_for, '2030-09-10T02:15:00.000Z');
  await json(endpoint, { method: 'PATCH', body: { ...input, allDay: false, allDayReminderTime: '11:15', endTime: '18:00' } });
  await plan();
  assert.equal((await jobs()).find((job) => job.status === 'scheduled').scheduled_for, '2030-09-10T08:30:00.000Z');
  assert.equal((await event()).event_time, '17:30');
  assert.equal((await event()).all_day_reminder_time, '11:15');
  assert.equal((await db.prepare('SELECT reminders_enabled_at FROM push_subscriptions WHERE id = 10').first()).reminders_enabled_at, '2030-09-09T00:00:00.000Z');
  console.log('PASS: all-day KST alarm base, one job per occurrence/device/offset, deduplication, edit cancellation and timed-mode restoration with consent preserved');
} finally {
  await mf.dispose();
}
