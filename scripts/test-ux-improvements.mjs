// Isolated regression suite: built Worker + in-memory D1, never a live account or push.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const urls = new Map();
async function moduleUrl(file) {
  file = path.resolve(file);
  if (urls.has(file)) return urls.get(file);
  let source = ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const match of [...source.matchAll(/from ['"](\.[^'"]+)['"]/g)]) source = source.replace(match[0], `from '${await moduleUrl(path.resolve(path.dirname(file), `${match[1]}.ts`))}'`);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  urls.set(file, url); return url;
}
const reminders = await import(await moduleUrl('lib/reminder-preview.ts'));
const time = await import(await moduleUrl('lib/editor-time.ts'));
const drafts = await import(await moduleUrl('lib/event-draft-storage.ts'));
const now = Date.parse('2030-09-10T09:00:00+09:00');
const base = { eventDate: '2030-09-10', eventTime: '10:00', recurrence: 'none', recurrenceInterval: 1, recurrenceDay: null };
let preview = reminders.previewReminders(base, [10080, 1440, 120], now);
assert.equal(preview.upcoming.length, 0); assert.equal(preview.suggestion, 10);
assert.equal(reminders.previewReminders({ ...base, eventTime: '09:05' }, [10], now).suggestion, 0);
assert.equal(reminders.previewReminders({ ...base, eventTime: '08:00' }, [10], now).suggestion, null);
assert.equal(reminders.previewReminders({ ...base, allDay: true, allDayReminderTime: '11:00' }, [60], now).upcoming[0].at, Date.parse('2030-09-10T10:00:00+09:00'));
assert.equal(reminders.previewReminders({ ...base, eventDate: '', endDate: 'invalid' }, [0], now), null);
assert.equal(reminders.previewReminders({ ...base, endDate: '', endTime: '' }, [0], now), null);
assert.equal(reminders.previewReminders({ ...base, recurrence: 'daily', recurrenceUntil: '2030-09-09' }, [0], now).date, null);
assert.equal(reminders.previewReminders({ ...base, recurrence: 'daily', eventTime: '08:00' }, [0], now).date, '2030-09-10');
assert.equal(reminders.previewReminders({ ...base, recurrence: 'daily', eventTime: '08:00' }, [0], now).upcoming.length, 0);
assert.deepEqual(time.shiftEndWithStart('2024-02-28', '09:00', '11:30', '2024-02-28', '10:00'), { endDate: '2024-02-28', endTime: '12:30' });
assert.deepEqual(time.shiftEndWithStart('2024-02-28', '22:00', '23:30', '2024-02-28', '23:00'), { endDate: '2024-02-29', endTime: '00:30' });
assert.deepEqual(time.shiftEndWithStart('2024-02-28', '23:00', '08:00', '2024-03-01', '01:00'), { endDate: '2024-02-29', endTime: '10:00' });
assert.equal(time.shiftEndWithStart('2030-09-10', '11:00', '12:00', '2030-09-10', '10:00'), null);
assert.equal(time.shiftEndWithStart('9999-12-31', '22:00', '23:30', '9999-12-31', '23:00'), null);
assert.equal(time.shiftEndWithStart('invalid', '09:00', '', '2024-02-28', '10:00'), null);
console.log('✓ Remaining reminders, close/past/all-day/repeating dates and duration-preserving time changes');

const scope = 'a'.repeat(64); const id = crypto.randomUUID();
const values = { title: '임시 일정', date: '2030-09-10', time: '09:00', hasEnd: 'on', endDate: '', initialReminderDraft: JSON.stringify({ mode: 'custom', once: { id: 0, amount: '1', unit: 60 }, custom: [{ id: 1, amount: '', unit: 1440 }] }) };
const draft = { version: 1, draftId: id, scope, savedAt: Date.now(), values, pending: null };
assert.deepEqual(drafts.readEventDraft(JSON.stringify(draft), scope), draft);
assert.equal(drafts.readEventDraft(JSON.stringify(draft), 'b'.repeat(64)), null);
assert.equal(drafts.readEventDraft(JSON.stringify(draft), scope, draft.savedAt + drafts.EVENT_DRAFT_TTL + 1), null);
assert.equal(drafts.readEventDraft('{broken', scope), null);
assert.equal(drafts.readEventDraft('x'.repeat(60001), scope), null);
assert.equal(drafts.readEventDraft(JSON.stringify({ ...draft, values: { ...values, unknown: 'x' } }), scope), null);
assert.equal(drafts.draftInitial(values).hasEnd, true); assert.equal(drafts.draftInitial(values).endDate, '');
assert.equal(drafts.draftInitial(values).preparationsEnabled, false);
const memory = new Map();
const storage = { get length() { return memory.size; }, key: i => [...memory.keys()][i] ?? null, getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
const attempt = { requestId: id, scope, payload: JSON.stringify({ requestId: id, title: '임시 일정' }), values, reminders: { mode: 'none', offsets: [] }, remember: false };
drafts.writeEventDraft(storage, { ...draft, pending: attempt });
drafts.writeEventDraft(storage, { ...draft, values: { ...values, title: '다른 탭 변경' } });
assert.equal(drafts.loadLatestEventDraft(storage, scope).pending.requestId, id);
const second = { ...draft, draftId: crypto.randomUUID() };
drafts.writeEventDraft(storage, second); assert.equal(storage.length, 2);
storage.removeItem(drafts.eventDraftKey(scope, id)); assert.equal(storage.length, 1);
assert.equal(drafts.loadLatestEventDraft(storage, scope).draftId, second.draftId);
assert.throws(() => drafts.writeEventDraft({ getItem: () => null, setItem: () => { throw new Error('blocked'); } }, draft));
const place = { provider: 'kakao', id: '1', name: '역', address: '서울', latitude: 37, longitude: 127 };
const routeDraft = drafts.draftInitial({ travelPlan: JSON.stringify({ origin: null, waypoints: [place], mode: 'walk' }), routeOriginQuery: '검색 중' });
assert.equal(routeDraft.travelDraft.origin, null); assert.equal(routeDraft.travelDraft.waypoints.length, 1); assert.equal(routeDraft.travelDraft.mode, 'walk');
console.log('✓ Opt-in draft scope/TTL/corruption/size/storage errors, per-draft identities, pending protection and partial input restore');

const { Miniflare, createFetchMock } = createRequire(require.resolve('wrangler/package.json'))('miniflare');
const mock = createFetchMock(); mock.disableNetConnect();
const files = await readdir('dist/server', { recursive: true });
const mf = new Miniflare({ modules: ['index.js', ...files.filter(name => /\.m?js$/.test(name) && name !== 'index.js')].map(name => ({ type: 'ESModule', path: path.resolve('dist/server', name) })), modulesRoot: path.resolve('dist/server'), compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], fetchMock: mock });
try {
  const db = await mf.getD1Database('DB');
  for (const file of (await readdir('drizzle')).filter(name => name.endsWith('.sql')).sort()) for (const statement of (await readFile(path.join('drizzle', file), 'utf8')).split('--> statement-breakpoint')) if (statement.trim()) await db.prepare(statement).run();
  const sql = (query, ...args) => db.prepare(query).bind(...args).run();
  const count = async table => (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n;
  const auth = owner => owner ? { 'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': `${owner}@example.test` } : {};
  async function api(url, { owner = 'ux-owner', method = 'GET', body, headers = {} } = {}) {
    const response = await mf.dispatchFetch(`http://localhost${url}`, { method, headers: { ...auth(owner), origin: 'http://localhost', 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  const account = (await api('/api/events')).body.accountScope;
  const keyed = { 'x-toj-event-save': '1', 'x-toj-event-account': account };
  const input = { title: '재시도할 일정', category: '일정', eventDate: '2024-02-28', eventTime: '09:00', recurrence: 'none', allDay: true, initialReminderOffsets: [0], seedPreparations: true };
  const requestId = crypto.randomUUID();
  const send = (body, options = {}) => api('/api/events', { method: 'POST', body, headers: keyed, ...options });
  const concurrent = await Promise.all(Array.from({ length: 20 }, () => send({ ...input, requestId })));
  assert.ok(concurrent.every(result => result.status === 201));
  assert.equal(new Set(concurrent.map(result => result.body.event.id)).size, 1);
  assert.equal(await count('events'), 1); assert.equal(await count('reminder_rules'), 1); assert.equal(await count('event_creation_receipts'), 1);
  const saved = concurrent[0].body.event; const prepCount = await count('preparation_items');
  await send({ ...input, requestId }); assert.equal(await count('preparation_items'), prepCount);
  assert.equal((await send({ ...input, title: '변경된 내용', requestId })).status, 409);
  assert.equal((await send({ requestId, ...Object.fromEntries(Object.entries(input).reverse()) })).status, 201);
  assert.equal((await send({ ...input, requestId: crypto.randomUUID() })).status, 201, 'Intentional duplicates remain allowed with a separate draft.');
  assert.equal((await send({ ...input, requestId }, { owner: 'other' })).status, 409);
  assert.equal((await send({ ...input, requestId }, { owner: null })).status, 401);
  assert.equal((await send({ ...input, requestId }, { headers: { ...keyed, origin: 'https://evil.test' } })).status, 403);
  assert.equal((await send({ ...input, requestId: 'bad' })).status, 400);
  assert.equal((await send({ ...input, note: 'x'.repeat(66000), requestId: crypto.randomUUID() })).status, 400);
  const lookup = await api(`/api/events?requestId=${requestId}`, { headers: { 'x-toj-event-account': account } });
  assert.equal(lookup.body.state, 'saved'); assert.equal(lookup.body.event.id, saved.id);
  const inputLib = await import(await moduleUrl('lib/event-input.ts'));
  const saveLib = await import(await moduleUrl('lib/event-save.ts'));
  const hash = data => saveLib.eventPayloadHash({ input: inputLib.parseEventInput(data), offsets: data.initialReminderOffsets, seed: data.seedPreparations });
  assert.equal(lookup.body.payloadHash, await hash(input));
  assert.notEqual(lookup.body.payloadHash, await hash({ ...input, title: '다른 탭에서 수정한 초안' }));
  assert.equal((await api(`/api/events?requestId=${crypto.randomUUID()}`, { headers: { 'x-toj-event-account': account } })).body.state, 'missing');
  const collision = crypto.randomUUID();
  const mismatched = await Promise.all([send({ ...input, requestId: collision }), send({ ...input, requestId: collision, title: '다른 초안' })]);
  assert.deepEqual(mismatched.map(result => result.status).sort(), [201, 409]);
  console.log('✓ 20 concurrent creates, lost-response replay, distinct drafts, canonical hash conflicts, account/origin/body isolation');

  const before = await count('events');
  const failingId = crypto.randomUUID();
  await sql("CREATE TRIGGER fail_ux_child BEFORE INSERT ON reminder_rules WHEN NEW.offset_minutes = 12345 BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
  assert.equal((await send({ ...input, requestId: failingId, initialReminderOffsets: [12345] })).status, 503);
  assert.equal(await count('events'), before);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM event_creation_receipts WHERE request_id = ?').bind(failingId).first()).n, 0);
  await sql('DROP TRIGGER fail_ux_child');
  assert.equal((await send({ ...input, requestId: failingId, initialReminderOffsets: [12345] })).status, 201);
  const bulk = (await api('/api/events/bulk')).body;
  const deleted = await api('/api/events/bulk', { method: 'POST', headers: { 'x-toj-bulk': '1', 'x-toj-bulk-account': bulk.scope }, body: { action: 'delete', targets: [{ id: saved.id, revision: saved.notification_revision, date: saved.event_date }] } });
  assert.equal(deleted.body.results[0].status, 'success');
  assert.equal((await send({ ...input, requestId })).status, 410);
  assert.equal((await api(`/api/events?requestId=${requestId}`, { headers: { 'x-toj-event-account': account } })).status, 410);
  console.log('✓ Atomic child rollback, safe retry after rollback, bulk-deletion tombstone and no resurrection');

  const event = (await send({ ...input, requestId: crypto.randomUUID() })).body.event;
  const directHeaders = { 'x-toj-list-checks': '1', 'x-toj-event-account': account };
  const readChecks = (targets, options = {}) => api('/api/completions', { method: 'POST', body: { targets }, headers: directHeaders, ...options });
  const ref = { eventId: event.id, date: event.event_date, revision: event.notification_revision };
  assert.equal((await readChecks(Array.from({ length: 11 }, () => ref))).status, 400);
  assert.equal((await readChecks([ref], { owner: 'other' })).status, 409);
  assert.equal((await readChecks([ref], { headers: { ...directHeaders, origin: 'https://evil.test' } })).status, 403);
  let checks = (await readChecks([ref])).body.results[0].occurrence;
  assert.equal((await readChecks([{ ...ref, revision: ref.revision + 1 }])).body.results[0].stale, true);
  assert.equal(checks.complete, false); assert.equal(checks.canCompleteEvent, true); assert.equal(checks.revision, event.notification_revision);
  const change = body => api(`/api/events/${event.id}/completion`, { method: 'PATCH', headers: directHeaders, body: { date: event.event_date, kind: 'event', itemId: 0, complete: true, revision: checks.revision, ...body } });
  assert.equal((await change({ revision: checks.revision + 1 })).status, 409);
  const actions = await Promise.all([change({}), change({})]); assert.ok(actions.every(result => result.status === 200));
  assert.equal((await db.prepare("SELECT count(*) AS n FROM xp_ledger WHERE action_key = ?").bind(`event:${event.id}:${event.event_date}:0`).first()).n, 1);
  assert.equal((await readChecks([ref])).body.results[0].occurrence.complete, true);
  await change({ complete: false });
  const preps = event.preparations;
  assert.ok(preps.length);
  assert.equal((await change({ kind: 'preparation', itemId: preps[0].id })).status, 200);
  assert.ok((await readChecks([ref])).body.results[0].occurrence.completedPreparationIds.includes(preps[0].id));
  const freshBulk = (await api('/api/events/bulk')).body;
  assert.ok(freshBulk.shiftBlockedIds.includes(event.id));
  const future = (await send({ ...input, eventDate: '2099-01-01', requestId: crypto.randomUUID() })).body.event;
  assert.equal((await readChecks([{ eventId: future.id, date: future.event_date, revision: future.notification_revision }])).body.results[0].occurrence.canCompleteEvent, false);
  console.log('✓ Bounded list reads, revision/account checks, event/preparation completion, immutable XP and bulk preflight eligibility');
} finally { await mf.dispose(); }

// Render exact partial drafts through controlled initial props, not DOM value injection.
async function component(file, deps) {
  const exports = {};
  runInNewContext(ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: name => deps[name] ?? require(name) });
  return exports;
}
const reminderSettings = await import(await moduleUrl('lib/reminder-settings.ts'));
const { InitialReminderField } = await component('components/initial-reminder-field.tsx', { '@/lib/reminder-settings': reminderSettings, './editor-section': { EditorSection: ({ children }) => React.createElement('div', null, children) }, './reminder-preview': { ReminderPreview: () => null } });
const markup = renderToStaticMarkup(React.createElement(InitialReminderField, { initial: null, initialEditorDraft: values.initialReminderDraft, initialRemember: false, deviceLoaded: true, deviceEnabled: false }));
assert.match(markup, /name="initialReminderAmount-1"[^>]*value=""/);
assert.match(markup, /name="initialReminderChoice" value="null"/);
assert.match(markup, /중복 없이|알림은 0~365일/);
const { EventTimeFields } = await component('components/event-time-fields.tsx', { '@/lib/recurrence': await import(await moduleUrl('lib/recurrence.ts')), '@/lib/event-duration': await import(await moduleUrl('lib/event-duration.ts')), '@/lib/editor-time': time });
const timeMarkup = renderToStaticMarkup(React.createElement(EventTimeFields, { date: '2030-09-10', onDateChange() {}, initial: drafts.draftInitial(values) }));
assert.match(timeMarkup, /name="hasEnd"[^>]*checked/); assert.match(timeMarkup, /name="endDate"[^>]*value=""/);
console.log('✓ Empty custom reminder input and incomplete end-date controls survive draft restoration');

const libraryDeps = {};
for (const name of ['recurrence', 'event-duration', 'occurrences', 'today-schedule']) libraryDeps[`@/lib/${name}`] = await import(await moduleUrl(`lib/${name}.ts`));
const checkKey = (eventId, date) => `${eventId}:${date}`;
const toggles = [];
let onlyRemaining = false;
const checkState = { values: { '44:2030-09-10': { eventId: 44, date: '2030-09-10', complete: false, completedPreparationIds: [8], canCompleteEvent: true, canCompletePreparation: true } }, loading: false, busy: false, error: '', notice: '', toggle: (...args) => toggles.push(args), retry() {} };
const { WorkspaceOverview } = await component('components/workspace-overview.tsx', { ...libraryDeps,
  react: { ...React, useState: () => [onlyRemaining, () => {}] },
  './calendar-workspace': { AppIcon: () => null },
  './use-overview-checks': { occurrenceCheckKey: checkKey, useOverviewChecks: () => checkState },
});
const schedule = { ...base, id: 100044, storageId: 44, title: '목록 계획', allDay: true, category: '일정', accent: '#294e3e', soft: '#e8eee0', time: '09:00', reminders: [], preparations: [{ id: 8, label: '완료된 준비', meta: '미리' }, { id: 9, label: '남아 있는 준비', meta: '당일' }] };
const overviewProps = { view: 'preparations', schedules: [schedule], now, selectedId: schedule.id, onSelect() {}, onCreate() {}, deviceLoaded: true, deviceEnabled: false, onDeviceSettings() {}, completedEvents: [] };
let overviewMarkup = renderToStaticMarkup(React.createElement(WorkspaceOverview, overviewProps));
assert.match(overviewMarkup, /1\/2 완료/); assert.match(overviewMarkup, /남은 준비만 보기/); assert.match(overviewMarkup, /완료된 준비/);
onlyRemaining = true;
overviewMarkup = renderToStaticMarkup(React.createElement(WorkspaceOverview, overviewProps));
assert.doesNotMatch(overviewMarkup, /완료된 준비/); assert.match(overviewMarkup, /남아 있는 준비/);
function elements(node) { return Array.isArray(node) ? node.flatMap(elements) : node && typeof node === 'object' && node.props ? [node, ...elements(node.props.children)] : []; }
const tree = WorkspaceOverview(overviewProps);
elements(tree).find(node => node.type === 'input' && node.props['aria-label']?.includes('남아 있는 준비')).props.onChange({ target: { checked: true } });
assert.deepEqual(toggles, [[44, '2030-09-10', 'preparation', 9, true]]);
const todayTree = WorkspaceOverview({ ...overviewProps, view: 'today' });
elements(todayTree).find(node => node.props.id === 'quick-event-44-2030-09-10').props.onClick();
assert.deepEqual(toggles.at(-1), [44, '2030-09-10', 'event', 0, true]);
checkState.values['44:2030-09-10'].canCompleteEvent = false;
assert.match(renderToStaticMarkup(React.createElement(WorkspaceOverview, { ...overviewProps, view: 'today' })), /disabled=""[^>]*>시작 전|disabled=""[\s\S]*시작 전/);
console.log('✓ Direct today/preparation actions, original-date payloads, remaining-only filter, counts and future-event controls');
