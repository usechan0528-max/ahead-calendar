// Production Worker, isolated in-memory database, no production writes or real push.
import { withCurrentEventRevision } from './current-event-revision.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createECDH, randomBytes } from 'node:crypto';
import { matchReminderPreset, offsetInput, parseInitialReminderChoice, parseInitialReminderOffsets, readInitialReminderPreference } from '../lib/reminder-settings.ts';

assert.equal(matchReminderPreset([]), 'none');
assert.equal(matchReminderPreset([{ offset_minutes: 10 }]), 'custom');
assert.equal(matchReminderPreset([120, 10080, 1440].map((offset_minutes) => ({ offset_minutes }))), 'standard');
assert.equal(matchReminderPreset([10, 20, 30].map((offset_minutes) => ({ offset_minutes }))), 'custom');
assert.deepEqual(offsetInput(2880), { amount: 2, unit: 1440 });
assert.deepEqual(offsetInput(0), { amount: 0, unit: 1 });
assert.deepEqual(parseInitialReminderOffsets([]), []);
assert.deepEqual(parseInitialReminderOffsets([0, 525600, 90]), [525600, 90, 0]);
for (const bad of [null, '[]', {}, [1, 1], [NaN], [Infinity], [false], ['60'], [-1], [0.5], [525601], Array.from({ length: 11 }, (_, i) => i)]) assert.equal(parseInitialReminderOffsets(bad), null);
assert.equal(parseInitialReminderChoice({ mode: 'once', offsets: [] }), null);
assert.equal(parseInitialReminderChoice({ mode: 'custom', offsets: [] }), null);
assert.equal(parseInitialReminderChoice({ mode: 'none', offsets: [60] }), null);
assert.equal(parseInitialReminderChoice({ mode: 'standard', offsets: [1, 2, 3] }), null);
assert.equal(parseInitialReminderChoice({ mode: ['none'], offsets: [] }), null);
assert.deepEqual(parseInitialReminderChoice({ mode: 'none', offsets: [] }), { mode: 'none', offsets: [] });
for (const raw of [null, '', '{broken', 'null', '{"version":2,"mode":"none","offsets":[]}']) assert.equal(readInitialReminderPreference(raw), null);
assert.deepEqual(readInitialReminderPreference('{"version":1,"mode":"custom","offsets":[0,60]}'), { mode: 'custom', offsets: [60, 0] });

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
    VAPID_PUBLIC_KEY: vapid.getPublicKey().toString('base64url'),
    VAPID_PRIVATE_KEY: vapid.getPrivateKey().toString('base64url'),
    VAPID_SUBJECT: 'https://ahead.example',
    NOTIFICATION_ACTION_SECRET: randomBytes(32).toString('base64url'),
    SCHEDULER_SECRET: randomBytes(32).toString('base64url'),
  },
});

try {
  const db = await mf.getD1Database('DB');
  for (const file of (await readdir('drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
    for (const sql of (await readFile(path.join('drizzle', file), 'utf8')).split('--> statement-breakpoint')) {
      if (sql.trim()) await db.prepare(sql).run();
    }
  }
  const sql = (statement, ...values) => db.prepare(statement).bind(...values).run();
  async function api(url, { method = 'GET', owner = 'owner-a', body, raw } = {}) {
    body = await withCurrentEventRevision(db, url, method, owner, body);
    const headers = { 'content-type': 'application/json' };
    if (owner) Object.assign(headers, { 'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': `${owner}@example.test` });
    return mf.dispatchFetch(`http://localhost${url}`, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  }
  async function json(url, options, status = 200) {
    const response = await api(url, options);
    assert.equal(response.status, status, `${options?.method ?? 'GET'} ${url}: ${await response.clone().text()}`);
    return response.json();
  }
  const future = new Date(Date.now() + (9 + 4) * 3600000).toISOString();
  const eventInput = { title: '사용자 설정 테스트', category: '기념일', eventDate: future.slice(0, 10), eventTime: future.slice(11, 16), recurrence: 'none' };
  for (const category of ['공부', '전체', '생일', '결혼기념일', 'constructor', 'toString', '__proto__', '가'.repeat(20), '  업무   회의  ']) {
    const normalized = category.trim().replace(/\s+/g, ' ');
    const custom = (await json('/api/events', { method: 'POST', owner: 'category-owner', body: { ...eventInput, category, recurrence: 'daily', initialReminderOffsets: [] } }, 201)).event;
    assert.equal(custom.category, normalized);
    assert.equal(custom.preparations.length, 3, 'Unknown kinds safely use the general legacy preparation template.');
    const saved = (await json('/api/events', { owner: 'category-owner' })).events.find(e => e.id === custom.id);
    assert.equal(saved.category, normalized);
    assert.ok(!(await json('/api/events', { owner: 'owner-a' })).events.some(e => e.id === custom.id));
    const edited = (await json(`/api/events/${custom.id}`, { method: 'PATCH', owner: 'category-owner', body: { ...eventInput, category: normalized, recurrence: 'daily', note: '메모만 수정' } })).event;
    assert.equal(edited.category, normalized); assert.deepEqual(edited.preparations, custom.preparations);
    const moved = (await json(`/api/events/${custom.id}/occurrences`, { method: 'PATCH', owner: 'category-owner', body: { action: 'edit', originalDate: eventInput.eventDate, revision: edited.notification_revision, changes: { title: '이번 회차', note: '', eventDate: eventInput.eventDate, eventTime: eventInput.eventTime, allDay: false, allDayReminderTime: '09:00', endDate: null, endTime: null } } })).event;
    assert.equal(moved.category, normalized); assert.equal(moved.occurrenceOverrides.length, 1);
    const changedKind = (await json(`/api/events/${custom.id}`, { method: 'PATCH', owner: 'category-owner', body: { ...eventInput, category: '운동', recurrence: 'daily' } })).event;
    assert.equal(changedKind.category, '운동'); assert.deepEqual(changedKind.preparations, custom.preparations); assert.equal(changedKind.occurrenceOverrides.length, 1);
    await api(`/api/events/${custom.id}`, { method: 'DELETE', owner: 'category-owner' });
  }
  for (const category of [null, {}, [], false, 42, '', ' ', '가'.repeat(21), '\u200b', '공부\n종류']) {
    assert.equal((await api('/api/events', { method: 'POST', owner: 'category-owner', body: { ...eventInput, category } })).status, 400);
  }
  assert.equal((await json('/api/events', { owner: 'category-owner' })).events.length, 0);
  console.log('PASS: custom kind persistence, edit/occurrence preservation, owner isolation, inherited-key safety and category validation');
  const a = (await json('/api/events', { method: 'POST', body: eventInput }, 201)).event;
  const other = (await json('/api/events', { method: 'POST', body: { ...eventInput, title: '다른 일정' } }, 201)).event;
  const b = (await json('/api/events', { method: 'POST', owner: 'owner-b', body: eventInput }, 201)).event;
  const event = async () => (await json('/api/events')).events.find((item) => item.id === a.id);
  const revision = async () => (await db.prepare('SELECT notification_revision AS revision FROM events WHERE id = ?').bind(a.id).first()).revision;
  const jobs = async () => (await db.prepare('SELECT * FROM notification_jobs WHERE event_id = ? ORDER BY id').bind(a.id).all()).results;
  const endpoint = `/api/events/${a.id}/reminders`;
  const ruleUrl = (ruleId, eventId = a.id) => `/api/events/${eventId}/reminders/${ruleId}`;
  const first = a.reminders[0];
  const initialRevision = await revision();
  const initialJobs = await jobs();
  for (const method of ['GET', 'PATCH']) assert.equal((await api('/api/category-colors', { method, owner: null, body: method === 'PATCH' ? { category: '일정', color: '#123456' } : undefined })).status, 401);
  for (const body of [null, [], {}, { category: ' ', color: '#123456' }, { category: '가'.repeat(21), color: '#123456' }, { category: '공부', color: '#abc' }, { category: '공부', color: 'red' }, { category: '공부', color: {} }]) await json('/api/category-colors', { method: 'PATCH', body }, 400);
  await json('/api/category-colors', { method: 'PATCH', raw: '{invalid' }, 400);
  for (const category of ['기념일', '공부', '__proto__', 'constructor']) {
    const saved = await json('/api/category-colors', { method: 'PATCH', body: { category, color: '#AABBCC', ownerId: 'owner-b' } });
    assert.equal(saved.color, '#aabbcc');
    const colors = (await json('/api/category-colors')).colors;
    assert.ok(Object.hasOwn(colors, category)); assert.equal(colors[category], '#aabbcc');
    assert.deepEqual((await json('/api/category-colors', { owner: 'owner-b' })).colors, {});
    await json('/api/category-colors', { method: 'PATCH', body: { category, color: '#123456' } });
    assert.equal((await json('/api/category-colors')).colors[category], '#123456');
    await json('/api/category-colors', { method: 'PATCH', owner: 'owner-b', body: { category, color: null } });
    assert.equal((await json('/api/category-colors')).colors[category], '#123456');
    await json('/api/category-colors', { method: 'PATCH', body: { category, color: null } });
    assert.ok(!Object.hasOwn((await json('/api/category-colors')).colors, category));
  }
  assert.equal(await revision(), initialRevision); assert.deepEqual(await jobs(), initialJobs);
  console.log('PASS: category color persistence, overwrite/reset, ownership, inherited-key safety, validation and no notification side effects');

  for (const method of ['PATCH', 'DELETE']) {
    assert.equal((await api(ruleUrl(first.id), { method, owner: null, body: { offsetMinutes: 1 } })).status, 401);
    assert.equal((await api(ruleUrl(first.id), { method, owner: 'owner-b', body: { offsetMinutes: 1 } })).status, 404);
    assert.equal((await api(ruleUrl(first.id, other.id), { method, body: { offsetMinutes: 1 } })).status, 404);
    assert.equal((await api(ruleUrl(b.reminders[0].id), { method, body: { offsetMinutes: 1 } })).status, 404);
  }
  for (const body of [null, [], {}, { offsetMinutes: null }, { offsetMinutes: '' }, { offsetMinutes: -1 }, { offsetMinutes: 0.5 }, { offsetMinutes: 525601 }]) {
    assert.equal((await api(ruleUrl(first.id), { method: 'PATCH', body })).status, 400);
    assert.equal((await api(endpoint, { method: 'POST', body })).status, 400);
  }
  assert.equal((await api(ruleUrl(first.id), { method: 'PATCH', raw: '{invalid' })).status, 400);
  assert.equal((await api(endpoint, { method: 'PATCH', body: null })).status, 400);
  assert.equal(await revision(), initialRevision);
  console.log('PASS: reminder ownership, path matching and strict malformed/offset validation');

  const concurrent = await Promise.all(Array.from({ length: 5 }, () => api(endpoint, { method: 'POST', body: { offsetMinutes: 60 } })));
  assert.ok(concurrent.every((response) => response.status === 201));
  assert.equal((await event()).reminders.filter((r) => r.offset_minutes === 60).length, 1);
  assert.equal(await revision(), initialRevision + 1, 'Duplicate adds must not revise settings.');
  const sixty = (await event()).reminders.find((r) => r.offset_minutes === 60);
  let before = await revision();
  await json(ruleUrl(sixty.id), { method: 'PATCH', body: { offsetMinutes: 60 } });
  assert.equal(await revision(), before);
  assert.equal((await api(ruleUrl(sixty.id), { method: 'PATCH', body: { offsetMinutes: 1440 } })).status, 409);
  assert.equal(await revision(), before);
  await json(endpoint, { method: 'POST', body: { offsetMinutes: 30 } }, 201);
  const thirty = (await event()).reminders.find((r) => r.offset_minutes === 30);
  const collision = await Promise.all([sixty, thirty].map((r) => api(ruleUrl(r.id), { method: 'PATCH', body: { offsetMinutes: 45 } })));
  assert.deepEqual(collision.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await event()).reminders.filter((r) => r.offset_minutes === 45).length, 1);
  const race = await Promise.all([
    api(endpoint, { method: 'PATCH', body: { preset: 'standard' } }),
    api(ruleUrl(thirty.id), { method: 'PATCH', body: { offsetMinutes: 55 } }),
  ]);
  assert.equal(race[0].status, 200);
  assert.ok([200, 404].includes(race[1].status));
  assert.deepEqual((await event()).reminders.map((r) => r.offset_minutes), [10080, 1440, 120]);
  console.log('PASS: atomic duplicate adds, no-op preservation and concurrent edit collision');

  await sql(`INSERT INTO push_subscriptions (id, owner_id, endpoint, p256dh, auth, reminders_enabled_at)
    VALUES (10, 'owner-a', 'https://fcm.googleapis.com/fcm/send/isolated', 'test-key', 'test-auth', ?)`, new Date(Date.now() - 60000).toISOString());
  await json(endpoint, { method: 'POST', body: { offsetMinutes: 0 } }, 201);
  const beforeJobs = await jobs();
  assert.ok(beforeJobs.some((j) => j.reminder_offset_minutes === 0 && j.status === 'scheduled'));
  const zero = (await event()).reminders.find((r) => r.offset_minutes === 0);
  const oldJob = beforeJobs.find((j) => j.reminder_offset_minutes === 0);
  await json(ruleUrl(zero.id), { method: 'PATCH', body: { offsetMinutes: 15 } });
  let afterJobs = await jobs();
  assert.equal(afterJobs.find((j) => j.id === oldJob.id).status, 'cancelled');
  const revised = await revision();
  assert.ok(afterJobs.some((j) => j.reminder_offset_minutes === 15 && j.status === 'scheduled' && j.event_revision === revised));
  for (const job of beforeJobs.filter((j) => j.reminder_offset_minutes !== 0 && j.status === 'scheduled')) {
    assert.equal(afterJobs.filter((j) => j.idempotency_key === job.idempotency_key).length, 1);
    assert.equal(afterJobs.find((j) => j.id === job.id).status, 'scheduled');
  }
  const noopSnapshot = JSON.stringify(await jobs());
  before = await revision();
  await json(ruleUrl(zero.id), { method: 'PATCH', body: { offsetMinutes: 15 } });
  assert.equal(await revision(), before);
  assert.equal(JSON.stringify(await jobs()), noopSnapshot);
  assert.equal((await api(ruleUrl(zero.id), { method: 'PATCH', body: { offsetMinutes: 1440 } })).status, 409);
  assert.equal(JSON.stringify(await jobs()), noopSnapshot);
  console.log('PASS: edited rules cancel obsolete reservations, preserve other identities and no-op jobs');

  const sent = (await jobs()).find((j) => j.reminder_offset_minutes === 15 && j.status === 'scheduled');
  await sql("UPDATE notification_jobs SET status = 'sent', attempt_count = 1, sent_at = ? WHERE id = ?", new Date().toISOString(), sent.id);
  await json(ruleUrl(zero.id), { method: 'DELETE' });
  await json(endpoint, { method: 'POST', body: { offsetMinutes: 15 } }, 201);
  afterJobs = await jobs();
  assert.equal(afterJobs.find((j) => j.id === sent.id).status, 'sent');
  assert.equal(afterJobs.filter((j) => j.idempotency_key === sent.idempotency_key).length, 1);
  const prepBeforeClear = (await event()).preparations;
  for (const rule of (await event()).reminders) await json(ruleUrl(rule.id), { method: 'DELETE' });
  assert.deepEqual((await event()).reminders, []);
  assert.ok((await jobs()).every((j) => !['scheduled', 'processing'].includes(j.status)));
  assert.deepEqual((await event()).preparations, prepBeforeClear);
  assert.ok((await db.prepare('SELECT reminders_enabled_at FROM push_subscriptions WHERE id = 10').first()).reminders_enabled_at);
  assert.equal((await json(`/api/events/${a.id}/notifications?subscriptionId=10`)).nextReminder, null);
  const worker = await mf.getWorker();
  await worker.scheduled({ cron: '* * * * *' });
  assert.ok((await jobs()).every((j) => !['scheduled', 'processing'].includes(j.status)));
  console.log('PASS: last reminder removal stops planning and preserves sent history, checklist and device consent');

  const preparationUrl = `/api/events/${a.id}/preparations`;
  for (const body of [null, [], {}, { title: '', timing: '일정 전' }, { title: 'x'.repeat(161), timing: '지금' }, { title: '확인', timing: 'x'.repeat(61) }, { title: '  ', timing: '지금' }]) {
    assert.equal((await api(preparationUrl, { method: 'POST', body })).status, 400);
  }
  assert.equal((await api(preparationUrl, { method: 'POST', raw: 'invalid' })).status, 400);
  assert.equal((await api(preparationUrl, { method: 'POST', owner: null, body: { title: '확인', timing: '지금' } })).status, 401);
  assert.equal((await api(preparationUrl, { method: 'POST', owner: 'owner-b', body: { title: '확인', timing: '지금' } })).status, 404);
  const p = (await json(preparationUrl, { method: 'POST', body: { title: '  직접 추가한 준비  ', timing: ' 하루 전 ' } }, 201)).preparation;
  assert.equal(p.title, '직접 추가한 준비'); assert.equal(p.timing, '하루 전');
  const pUrl = `/api/preparations/${p.id}`;
  const checklistRevision = await revision();
  const notificationSnapshot = JSON.stringify(await jobs());
  for (const method of ['PATCH', 'DELETE']) {
    assert.equal((await api(pUrl, { method, owner: 'owner-b', body: { title: '변경', timing: '지금' } })).status, 404);
    assert.equal((await api(pUrl, { method, owner: null, body: { title: '변경', timing: '지금' } })).status, 401);
  }
  assert.equal((await api(pUrl, { method: 'PATCH', body: { title: '변경', timing: '지금', status: 'complete' } })).status, 400);
  await json(pUrl, { method: 'PATCH', body: { status: 'complete' } });
  const edited = (await json(pUrl, { method: 'PATCH', body: { title: '준비 내용 수정', timing: '당일 아침' } })).preparation;
  assert.equal(edited.status, 'complete');
  await Promise.all([
    json(pUrl, { method: 'PATCH', body: { title: '동시 수정', timing: '오늘' } }),
    json(pUrl, { method: 'PATCH', body: { status: 'pending' } }),
  ]);
  const latestP = (await event()).preparations.find((item) => item.id === p.id);
  assert.equal(latestP.title, '동시 수정'); assert.equal(latestP.status, 'pending');
  assert.equal(await revision(), checklistRevision);
  assert.equal(JSON.stringify(await jobs()), notificationSnapshot);
  for (const item of (await event()).preparations) assert.equal((await api(`/api/preparations/${item.id}`, { method: 'DELETE' })).status, 204);
  assert.deepEqual((await event()).preparations, []);
  await json(preparationUrl, { method: 'POST', body: { title: '새로 시작', timing: '필요할 때' } }, 201);
  assert.equal((await event()).preparations.length, 1);
  assert.equal((await json('/api/events', { owner: 'owner-b' })).events[0].preparations.length, b.preparations.length);
  console.log('PASS: preparation add/edit/delete, validation, owner isolation, completion preservation and empty-state recovery');

  const eventCount = async () => (await db.prepare('SELECT COUNT(*) AS count FROM events').first()).count;
  const subscriptionsBeforeCreate = JSON.stringify((await db.prepare('SELECT * FROM push_subscriptions ORDER BY id').all()).results);
  const countBeforeInvalid = await eventCount();
  for (const initialReminderOffsets of [null, '[]', {}, ['60'], [false], [null], [60, 60], [-1], [1.5], [525601], Array.from({ length: 11 }, (_, i) => i)]) {
    assert.equal((await api('/api/events', { method: 'POST', body: { ...eventInput, initialReminderOffsets } })).status, 400);
  }
  assert.equal((await api('/api/events', { method: 'POST', owner: null, body: { ...eventInput, initialReminderOffsets: [] } })).status, 401);
  assert.equal(await eventCount(), countBeforeInvalid, 'Bad reminder input must not create any event.');
  assert.deepEqual(b.reminders.map((rule) => [rule.offset_minutes, rule.repeat_until_ack]), [[10080, 0], [1440, 0], [120, 1]], 'Old clients retain their exact default rules.');
  for (const preparationsEnabled of [false, true]) {
    const none = (await json('/api/events', { method: 'POST', body: { ...eventInput, title: '알림 없이 저장', initialReminderOffsets: [], preparationsEnabled } }, 201)).event;
    assert.equal(none.reminders.length, 0);
    assert.equal(none.preparations.length, preparationsEnabled ? 3 : 0);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM notification_jobs WHERE event_id = ?').bind(none.id).first()).count, 0);
  }
  for (const offsets of [[0], [525600], [10080, 1440, 120], [0, 90, 2880], Array.from({ length: 10 }, (_, i) => i * 10)]) {
    const created = (await json('/api/events', { method: 'POST', body: { ...eventInput, initialReminderOffsets: offsets } }, 201)).event;
    const expected = [...offsets].sort((a, b) => b - a);
    assert.deepEqual(created.reminders.map((rule) => rule.offset_minutes), expected);
    assert.ok(created.reminders.every((rule) => rule.event_id === created.id && rule.repeat_until_ack === 0));
    const planned = (await db.prepare('SELECT reminder_offset_minutes FROM notification_jobs WHERE event_id = ?').bind(created.id).all()).results;
    assert.ok(planned.every((job) => expected.includes(job.reminder_offset_minutes)), 'Only chosen offsets may be planned.');
    const edited = (await json(`/api/events/${created.id}`, { method: 'PATCH', body: { ...eventInput, title: '알림 보존 수정', initialReminderOffsets: [] } })).event;
    assert.deepEqual(edited.reminders, created.reminders, 'Creation-only defaults must never reset reminders on PATCH.');
  }
  const concurrentCreates = await Promise.all(Array.from({ length: 4 }, (_, i) => json('/api/events', { method: 'POST', body: { ...eventInput, title: `동시 생성 ${i}`, initialReminderOffsets: [i + 1] } }, 201)));
  concurrentCreates.forEach(({ event: created }, i) => {
    assert.deepEqual(created.reminders.map((r) => [r.event_id, r.offset_minutes]), [[created.id, i + 1]]);
    assert.ok(created.preparations.every((item) => item.event_id === created.id));
  });
  const withoutConsent = (await json('/api/events', { method: 'POST', owner: 'owner-without-consent', body: { ...eventInput, initialReminderOffsets: [0] } }, 201)).event;
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM notification_jobs WHERE event_id = ?').bind(withoutConsent.id).first()).count, 0);
  assert.equal(JSON.stringify((await db.prepare('SELECT * FROM push_subscriptions ORDER BY id').all()).results), subscriptionsBeforeCreate);
  const countBeforeFailure = await eventCount();
  await sql("CREATE TRIGGER fail_test_creation BEFORE INSERT ON reminder_rules WHEN NEW.offset_minutes = 12345 BEGIN SELECT RAISE(ABORT, 'test creation rollback'); END");
  assert.equal((await api('/api/events', { method: 'POST', body: { ...eventInput, initialReminderOffsets: [12345] } })).status, 503);
  assert.equal(await eventCount(), countBeforeFailure, 'A failed child insert must roll back the parent event.');
  await sql('DROP TRIGGER fail_test_creation');
  console.log('PASS: creation reminder choices, limits, empty setup, legacy defaults, edit preservation, concurrent parent/child linkage, atomic rollback and untouched device consent');
  const beforeSeedValidation = await eventCount();
  for (const seedPreparations of [null, 'false', 0, [], {}]) {
    assert.equal((await api('/api/events', {method:'POST',body:{...eventInput,seedPreparations}})).status,400);
  }
  assert.equal(await eventCount(), beforeSeedValidation);
  assert.equal(b.preparations.length, 3, 'Legacy clients still receive their existing templates.');
  for (const preparationsEnabled of [false,true]) {
    const chosen = (await json('/api/events', {method:'POST',owner:'flow-owner',body:{...eventInput,title:'선택해서 준비',preparationsEnabled,seedPreparations:false,initialReminderOffsets:[]}},201)).event;
    assert.equal(chosen.preparations_enabled, Number(preparationsEnabled));
    assert.deepEqual(chosen.preparations, []);
    assert.deepEqual(chosen.reminders, []);
    const snapshot = async () => (await json('/api/events',{owner:'flow-owner'})).events.find((item)=>item.id===chosen.id);
    await json(`/api/events/${chosen.id}/preparation-settings`,{method:'PATCH',owner:'flow-owner',body:{enabled:true}});
    assert.deepEqual((await snapshot()).preparations, [], 'Enabling preparations does not automatically adopt recommendations.');
    const recommendationUrl = `/api/events/${chosen.id}/recommendations`;
    const suggestions = (await json(recommendationUrl,{owner:'flow-owner'})).snapshot;
    assert.deepEqual((await snapshot()).preparations, [], 'Reading recommendations has no checklist side effects.');
    const rule = suggestions.items.find((item)=>item.state==='available');
    assert.ok(rule);
    await json(recommendationUrl,{method:'POST',owner:'flow-owner',body:{action:'adopt',ruleId:rule.id,token:suggestions.token}});
    const adopted = (await snapshot()).preparations;
    assert.equal(adopted.length,1);
    const edited = (await json(`/api/events/${chosen.id}`,{method:'PATCH',owner:'flow-owner',body:{...eventInput,seedPreparations:false,preparationsEnabled:true}})).event;
    assert.deepEqual(edited.preparations,adopted,'Editing preserves the selected item.');
    assert.deepEqual(edited.reminders,[]);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions WHERE owner_id = ?').bind('flow-owner').first()).count,0);
    await api(`/api/events/${chosen.id}`,{method:'DELETE',owner:'flow-owner'});
  }
  console.log('PASS: select-only preparations, legacy compatibility, validation, one-item adoption, edit preservation and no implicit device consent');
  console.log('All customization integration checks passed. No real device notifications were sent.');
} finally { await mf.dispose(); }
