// Real built Worker with isolated D1, no production records or network traffic.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const urls = new Map();
async function moduleUrl(file) {
  file = path.resolve(file);
  if (urls.has(file)) return urls.get(file);
  let source = ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const match of [...source.matchAll(/from ['"](\.[^'"]+)['"]/g)]) source = source.replace(match[0], `from '${await moduleUrl(path.resolve(path.dirname(file), `${match[1]}.ts`))}'`);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  urls.set(file, url); return url;
}
const bulkLib = await import(await moduleUrl('lib/bulk-events.ts'));
const target = { id: 1, revision: 0, date: '2024-02-28' };
for (const action of [[], ['delete'], {}, { toString: null }, null, 0, 'nope']) assert.equal(bulkLib.parseBulkRequest({ action, targets: [target] }), null);
for (const payload of [null, [], { action: 'delete', targets: [] }, { action: 'delete', targets: [target, target] },
  { action: 'shift', targets: [target], days: 0 }, { action: 'shift', targets: [target], days: '1' },
  { action: 'shift', targets: [target], days: 366 }, { action: 'category', targets: [target], category: '' },
  { action: 'complete', targets: [{ ...target, date: '2023-02-29' }] }, { action: 'complete', targets: [{ ...target, date: null }] },
  { action: 'delete', targets: [{ ...target, owner: 'foreign' }] }, { action: 'delete', targets: [target], owner: 'foreign' },
  { action: 'delete', targets: Array.from({ length: 21 }, (_, id) => ({ ...target, id: id + 1 })) }]) assert.equal(bulkLib.parseBulkRequest(payload), null);
assert.equal(bulkLib.parseBulkRequest({ action: 'category', targets: [target], category: '  운동  ' }).category, '운동');
console.log('✓ Strict action/target/date/category/size validation');

const require = createRequire(import.meta.url);
const { Miniflare, createFetchMock } = createRequire(require.resolve('wrangler/package.json'))('miniflare');
const mock = createFetchMock(); mock.disableNetConnect();
const files = await readdir('dist/server', { recursive: true });
const mf = new Miniflare({
  modules: ['index.js', ...files.filter(name => /\.m?js$/.test(name) && name !== 'index.js')].map(name => ({ type: 'ESModule', path: path.resolve('dist/server', name) })),
  modulesRoot: path.resolve('dist/server'), compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], fetchMock: mock,
});
try {
  const db = await mf.getD1Database('DB');
  const sql = (query, ...args) => db.prepare(query).bind(...args).run();
  const row = id => db.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
  for (const file of (await readdir('drizzle')).filter(name => name.endsWith('.sql')).sort()) {
    for (const statement of (await readFile(path.join('drizzle', file), 'utf8')).split('--> statement-breakpoint')) if (statement.trim()) await db.prepare(statement).run();
  }
  const auth = owner => owner ? { 'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': `${owner}@example.test` } : {};
  async function read(owner = 'bulk-owner') {
    const response = await mf.dispatchFetch('http://localhost/api/events/bulk', { headers: auth(owner) });
    return { status: response.status, body: await response.json() };
  }
  const scope = (await read()).body.scope;
  async function send(body, options = {}) {
    const response = await mf.dispatchFetch('http://localhost/api/events/bulk', { method: 'POST', headers: {
      ...auth(options.owner === undefined ? 'bulk-owner' : options.owner), 'content-type': 'application/json', origin: 'http://localhost',
      'x-toj-bulk': '1', 'x-toj-bulk-account': scope, ...options.headers }, body: options.raw ?? JSON.stringify(body) });
    const data = await response.json();
    assert.match(response.headers.get('cache-control'), /private, no-store/);
    return { status: response.status, ...data };
  }
  async function seed(id, owner = 'bulk-owner', date = '2024-02-28') {
    await sql('INSERT INTO events (id, owner_id, title, category, event_date, event_time, all_day) VALUES (?, ?, ?, ?, ?, ?, 1)', id, owner, `일정 ${id}`, '일정', date, '09:00');
  }
  const ref = async (id, date) => { const event = await row(id); return { id, revision: event.notification_revision, date: date ?? event.event_date }; };
  const perform = async (action, ids, extra = {}) => send({ action, targets: await Promise.all(ids.map(id => ref(id))), ...extra });
  await seed(1); await seed(2, 'foreign');
  assert.equal((await read(null)).status, 401);
  assert.equal((await send({ action: 'delete', targets: [target] }, { owner: null })).status, 401);
  for (const headers of [{ origin: 'https://evil.test' }, { 'x-toj-bulk': '' }, { 'sec-fetch-site': 'cross-site' }]) assert.equal((await send({ action: 'delete', targets: [target] }, { headers })).status, 403);
  assert.equal((await send({ action: 'delete', targets: [target] }, { owner: 'foreign' })).status, 409);
  assert.equal((await send({}, { raw: 'x'.repeat(8193) })).status, 413);
  assert.equal((await send({}, { headers: { 'content-type': 'text/plain' } })).status, 415);
  for (const action of [['delete'], { toString: null }]) assert.equal((await send({ action, targets: [target] })).status, 400);
  const mixed = await send({ action: 'category', category: '운동', targets: [await ref(1), await ref(2), { ...target, id: 99999 }] });
  assert.deepEqual(mixed.results.map(result => result.status), ['success', 'failed', 'failed']);
  assert.equal((await row(2)).category, '일정');
  assert.deepEqual((await read()).body.events.map(event => event.id), [1]);
  for (const action of ['delete', 'category', 'complete', 'shift']) {
    const result = await send({ action, targets: [target], ...(action === 'category' ? { category: '여행' } : action === 'shift' ? { days: 1 } : {}) });
    assert.equal(result.results[0].status, 'failed');
  }
  console.log('✓ Owner/account isolation, origin/body guards, partial results and stale revisions');

  // A no-op undo must not manufacture completion history and block moving dates.
  await seed(3);
  assert.equal((await perform('pending', [3])).results[0].status, 'success');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM occurrence_completions WHERE event_id = 3').first()).n, 0);
  await sql("UPDATE events SET end_date = '2024-03-01' WHERE id = 3");
  const shiftTarget = await ref(3);
  const shifts = await Promise.all(Array.from({ length: 8 }, () => send({ action: 'shift', targets: [shiftTarget], days: 1 })));
  assert.equal(shifts.filter(result => result.results[0].status === 'success').length, 1);
  assert.equal((await row(3)).event_date, '2024-02-29'); assert.equal((await row(3)).end_date, '2024-03-02');
  assert.equal((await send({ action: 'shift', targets: [shiftTarget], days: 1 })).results[0].status, 'failed');
  await seed(4, 'bulk-owner', '9999-12-31');
  assert.equal((await perform('shift', [4], { days: 1 })).results[0].status, 'failed');
  await seed(5); await sql("UPDATE events SET recurrence = 'daily' WHERE id = 5");
  assert.equal((await perform('shift', [5], { days: 1 })).results[0].status, 'failed');
  console.log('✓ No-op undo, leap-day/end-date movement, concurrent/replayed shifts and date/repeat bounds');

  for (let id = 10; id < 30; id++) await seed(id);
  const completion = { action: 'complete', targets: await Promise.all(Array.from({ length: 20 }, (_, i) => ref(i + 10))) };
  const completed = await Promise.all([send(completion), send(completion)]);
  assert.ok(completed.every(result => result.results.every(item => item.status === 'success')));
  const xp = await db.prepare("SELECT sum(xp) AS xp, sum(CASE WHEN kind = 'event' THEN 1 ELSE 0 END) AS n FROM xp_ledger WHERE owner_id = 'bulk-owner'").first();
  assert.equal(xp.xp, 60); assert.equal(xp.n, 20);
  await perform('pending', [10]); await perform('complete', [10]);
  assert.equal((await db.prepare("SELECT sum(xp) AS xp FROM xp_ledger WHERE owner_id = 'bulk-owner'").first()).xp, 60);
  await perform('pending', [10]);
  assert.equal((await perform('shift', [10], { days: 1 })).results[0].status, 'failed');
  // Even zero-XP/deleted-preparation receipts cannot be moved to farm new rewards.
  await seed(31);
  await sql("INSERT INTO xp_ledger (owner_id, action_key, kind, earned_date, xp, rules_version, created_at) VALUES ('bulk-owner', 'preparation:31:2024-02-28:77', 'preparation', '2024-02-28', 0, 1, '2024-02-28')");
  assert.equal((await perform('shift', [31], { days: 1 })).results[0].status, 'failed');
  await seed(32, 'bulk-owner', '2099-01-01');
  assert.equal((await perform('complete', [32])).results[0].status, 'failed');
  console.log('✓ 20-event concurrent completion, 60-XP cap, replay/undo protection, future/history restrictions');

  await seed(40); await sql("UPDATE events SET recurrence = 'daily', location = '장소', note = '메모', end_date = '2024-02-29' WHERE id = 40");
  const changes = { title: '이동한 회차', note: '', eventDate: '2024-03-03', eventTime: '09:00', allDay: true, allDayReminderTime: '09:00', endDate: null, endTime: null };
  await sql('INSERT INTO event_occurrence_overrides (event_id, original_date, cancelled, data_json, updated_at) VALUES (40, ?, 0, ?, ?)', '2024-02-28', JSON.stringify(changes), '2024-02-01');
  await sql("INSERT INTO preparation_items (event_id, title, timing, status) VALUES (40, '준비 보존', '지금', 'complete')");
  await sql("INSERT INTO push_subscriptions (id, owner_id, endpoint, p256dh, auth) VALUES (1, 'bulk-owner', 'https://push.example.test/1', 'fake', 'fake')");
  await sql("INSERT INTO notification_jobs (event_id, owner_id, subscription_id, kind, title, body, scheduled_for, occurrence_at, original_occurrence_date, status, attempt_count, lifetime_attempt_count, event_revision, idempotency_key) VALUES (40, 'bulk-owner', 1, 'reminder', '이동한 회차', '', '2099-01-01', '2024-03-03T00:00:00Z', '2024-02-28', 'scheduled', 1, 1, 0, 'bulk-test-job')");
  assert.equal((await perform('category', [40], { category: '사용자 종류' })).results[0].status, 'success');
  const kept = await row(40); assert.equal(kept.location, '장소'); assert.equal(kept.note, '메모'); assert.equal(kept.end_date, '2024-02-29');
  const job = await db.prepare('SELECT * FROM notification_jobs WHERE event_id = 40').first();
  assert.equal(job.status, 'scheduled'); assert.equal(job.event_revision, 1); assert.equal(job.attempt_count, 1); assert.equal(job.lifetime_attempt_count, 1);
  assert.equal((await db.prepare('SELECT data_json FROM event_occurrence_overrides WHERE event_id = 40').first()).data_json, JSON.stringify(changes));
  assert.equal((await db.prepare('SELECT title, status FROM preparation_items WHERE event_id = 40').first()).status, 'complete');
  assert.equal((await perform('complete', [40])).results[0].status, 'success');
  assert.equal((await db.prepare("SELECT occurrence_date FROM occurrence_completions WHERE event_id = 40 AND kind = 'event'").first()).occurrence_date, '2024-02-28');
  assert.equal((await db.prepare('SELECT status FROM notification_jobs WHERE event_id = 40').first()).status, 'cancelled');
  const beforeDeleteXp = (await db.prepare('SELECT count(*) AS n FROM xp_ledger').first()).n;
  assert.equal((await perform('delete', [40])).results[0].status, 'success');
  for (const table of ['preparation_items', 'notification_jobs', 'event_occurrence_overrides', 'occurrence_completions']) assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table} WHERE event_id = 40`).first()).n, 0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM xp_ledger').first()).n, beforeDeleteXp);
  assert.ok(await row(2));
  console.log('✓ Series metadata/snooze preservation, moved original-date completion, cascading delete and retained XP');

  await seed(50); await seed(51);
  await sql("CREATE TRIGGER reject_bulk_test BEFORE UPDATE ON events WHEN OLD.id = 50 BEGIN SELECT RAISE(ABORT, 'isolated failure'); END");
  const partial = await perform('category', [50, 51], { category: '업무' });
  assert.deepEqual(partial.results.map(item => item.status), ['unknown', 'success']);
  assert.equal((await row(50)).category, '일정'); assert.equal((await row(51)).category, '업무');
  await sql('DROP TRIGGER reject_bulk_test');
  console.log('✓ Storage-error outcome is uncertain, with honest independent partial success');

  const snapshot = (await read()).body;
  const component = {};
  const dependencies = { '@/lib/bulk-events': bulkLib, './event-category-field': { EventCategoryField: () => React.createElement('div', null, '종류 입력') } };
  for (const name of ['recurrence', 'occurrences', 'event-duration', 'event-category', 'design-tokens']) dependencies[`@/lib/${name}`] = await import(await moduleUrl(`lib/${name}.ts`));
  let stateIndex = 0, override = {};
  dependencies.react = { ...React, useState: initial => { const index = stateIndex++; return React.useState(Object.hasOwn(override, index) ? override[index] : initial); } };
  runInNewContext(ts.transpileModule(await readFile('components/bulk-event-manager.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports: component, require: name => dependencies[name] ?? require(name) });
  const render = states => { stateIndex = 0; override = { 0: snapshot, 1: false, ...states }; return renderToStaticMarkup(React.createElement(component.BulkEventManager, { offline: false, colors: {}, onClose() {}, onChanged() {} })); };
  assert.match(render({ 5: [1, 3], 6: '검색에없는값' }), /필터 밖 2개 포함/);
  assert.match(render({ 5: [1], 10: 'delete', 14: { action: 'delete', targets: [await ref(1)] } }), /되돌릴 수 없어요/);
  assert.match(render({ 4: true, 5: [50], 15: partial.results }), /1개 처리 · 1개 확인 필요/);
  assert.match(render({ 0: { ...snapshot, events: [] } }), /등록한 일정이 없어요/);
  assert.match(render({ 5: [1], 10: 'shift' }), /실천 기록이 없는 일반 일정만/);
  console.log('✓ Filter-hidden selections, deletion scope, partial results, empty and date-safety UI');
} finally { await mf.dispose(); }
