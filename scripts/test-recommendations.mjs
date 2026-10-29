// Pure rules and real built Worker on isolated D1. No user records or live push/network.
import { withCurrentEventRevision } from './current-event-revision.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const urls = new Map();
async function moduleUrl(file) {
  file = path.resolve(file);
  if (urls.has(file)) return urls.get(file);
  let source = ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const match of [...source.matchAll(/from ['"](\.[^'"]+)['"]/g)]) source = source.replace(match[0], `from '${await moduleUrl(path.resolve(path.dirname(file), `${match[1]}.ts`))}'`);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  urls.set(file, url);
  return url;
}
const { buildRecommendations, inferRecommendationProfile, recommendationKeysForTitle } = await import(await moduleUrl('lib/preparation-recommendations.ts'));
const now = new Date('2030-09-19T10:00:00+09:00');
const base = { title: '내 일정', category: '일정', eventDate: '2030-09-19', eventTime: '20:00', allDay: false, recurrence: 'none', recurrenceInterval: 1, recurrenceDay: null, location: '', hasTravelPlan: false };
for (const [title, profile] of [['엄마 생신', 'birthday'], ['결혼 기념일', 'anniversary'], ['친구 결혼식', 'wedding'], ['팀 회의', 'meeting'], ['원고 제출', 'deadline'], ['제주 여행', 'travel'], ['주말 등산', 'outing']]) assert.equal(inferRecommendationProfile({ ...base, title }, 'auto').profile, profile);
assert.equal(inferRecommendationProfile({ ...base, title: '생일' }, 'meeting').profile, 'meeting');
for (const category of ['공부', '전체', '__proto__', 'constructor']) {
  assert.equal(inferRecommendationProfile({ ...base, category }, 'auto').profile, 'general');
  assert.equal(inferRecommendationProfile({ ...base, category, title: '팀 회의' }, 'auto').profile, 'meeting');
  assert.equal(inferRecommendationProfile({ ...base, category }, 'travel').profile, 'travel');
}
const sameDay = buildRecommendations(base, 'auto', now).items.find((r) => r.id === 'general-final');
assert.equal(sameDay.recommendedAt, '2030-09-19T09:00:00.000Z');
assert.equal(sameDay.timingState, 'now', 'Same-day 18:00 preparation remains future at 10:00.');
const allDay = buildRecommendations({ ...base, allDay: true, allDayReminderTime: '08:15' }, 'general', now).items.find((r) => r.id === 'general-final');
assert.equal(allDay.recommendedAt, '2030-09-18T21:15:00.000Z');
assert.equal(allDay.timingState, 'passed');
assert.equal(buildRecommendations({ ...base, eventDate: '2020-01-01', recurrence: 'yearly' }, 'birthday', now).occurrenceDate, '2031-01-01');
const contextual = buildRecommendations({ ...base, location: '서울', hasTravelPlan: true, endDate: '2030-09-21' }, 'general', now);
assert.ok(contextual.items.some((r) => r.id === 'location-route' && r.title.includes('저장한 동선')));
assert.ok(!contextual.items.some((r) => r.id === 'location-weather'));
assert.ok(contextual.items.some((r) => r.id === 'duration-items'));
assert.ok(!buildRecommendations(base, 'general', now).items.some((r) => r.id.startsWith('location-')));
assert.ok(recommendationKeysForTitle(' 날씨에 맞춰 짐 싸기 ').includes('travel-packing'));
assert.ok(recommendationKeysForTitle('여행 일정에 맞춰 짐 싸기').includes('travel-packing'));
assert.ok(recommendationKeysForTitle('날씨가 바뀔 때의 대안 정하기').includes('outing-plan'));
assert.ok(recommendationKeysForTitle('장소의 최신 날씨 확인하기').includes('location-weather'), 'Retired identities still recognize saved user records.');
for (const profile of ['general','travel','outing']) {
  for (const item of buildRecommendations({ ...base, location: '서울' }, profile, now).items) {
    assert.doesNotMatch(`${item.title} ${item.reason}`, /날씨|예보|Open-Meteo/);
  }
}
console.log('PASS: title profiles, manual override, KST exact time, all-day baseline, recurrence, place and duration context');

const require = createRequire(import.meta.url);
const { Miniflare, createFetchMock } = createRequire(require.resolve('wrangler/package.json'))('miniflare');
const mock = createFetchMock(); mock.disableNetConnect();
const files = await readdir('dist/server', { recursive: true });
const mf = new Miniflare({ modules: ['index.js', ...files.filter((name) => /\.m?js$/.test(name) && name !== 'index.js')].map((name) => ({ type: 'ESModule', path: path.resolve('dist/server', name) })), modulesRoot: path.resolve('dist/server'), compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], fetchMock: mock });
try {
  const db = await mf.getD1Database('DB');
  for (const file of (await readdir('drizzle')).filter((name) => name.endsWith('.sql')).sort()) for (const sql of (await readFile(path.join('drizzle', file), 'utf8')).split('--> statement-breakpoint')) if (sql.trim()) await db.prepare(sql).run();
  async function api(url, { method = 'GET', owner = 'recommendation-test', body, raw } = {}) {
    body = await withCurrentEventRevision(db, url, method, owner, body);
    const headers = { 'content-type': 'application/json' };
    if (owner) Object.assign(headers, { 'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': `${owner}@example.test` });
    return mf.dispatchFetch(`http://localhost${url}`, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  }
  async function json(url, options, status = options?.method === 'DELETE' ? 204 : 200) {
    const response = await api(url, options);
    assert.equal(response.status, status, `${options?.method ?? 'GET'} ${url}: ${await response.clone().text()}`);
    return response.status === 204 ? null : response.json();
  }
  const input = { title: '부모님 생신', category: '기념일', eventDate: '2030-12-20', eventTime: '18:00', recurrence: 'yearly' };
  const e = (await json('/api/events', { method: 'POST', body: input }, 201)).event;
  assert.equal(e.preparations_enabled, 1);
  const endpoint = `/api/events/${e.id}/recommendations`;
  const snapshot = async () => (await json(endpoint)).snapshot;
  const write = async (action, status = 200) => json(endpoint, { method: 'POST', body: { ...action, token: (await snapshot()).token } }, status);
  const count = async (table) => (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n;
  const initialPreps = await count('preparation_items');
  const initialRules = await count('reminder_rules');
  const initialJobs = await count('notification_jobs');
  const s = await snapshot();
  assert.equal(s.profile, 'birthday');
  assert.equal(s.items.find((r) => r.id === 'celebration-gift').state, 'added');
  for (const method of ['GET', 'POST']) {
    assert.equal((await api(endpoint, { method, owner: null, body: method === 'POST' ? { action: 'restore', token: s.token } : undefined })).status, 401);
    assert.equal((await api(endpoint, { method, owner: 'intruder', body: method === 'POST' ? { action: 'restore', token: s.token } : undefined })).status, 404);
  }
  for (const body of [null, [], {}, { action: 'profile', profile: 'bogus', token: s.token }, { action: 'adopt', ruleId: 'unknown-rule', token: s.token }, { action: 'adopt', ruleId: '../x', token: s.token }]) assert.equal((await api(endpoint, { method: 'POST', body })).status, 400);
  assert.equal((await api(endpoint, { method: 'POST', raw: '{invalid' })).status, 400);
  assert.match((await api(endpoint)).headers.get('cache-control'), /no-store/);
  assert.equal(await count('preparation_items'), initialPreps);
  console.log('PASS: owner isolation, no GET writes, strict input validation, no-store responses');

  const adopted = await Promise.all(Array.from({ length: 8 }, () => json(endpoint, { method: 'POST', body: { action: 'adopt', ruleId: 'birthday-date', token: s.token } })));
  assert.equal(new Set(adopted.map((r) => r.preparation.id)).size, 1);
  const adoptedId = adopted[0].preparation.id;
  assert.equal(await count('preparation_items'), initialPreps + 1);
  assert.equal(await count('reminder_rules'), initialRules);
  assert.equal(await count('notification_jobs'), initialJobs);
  assert.equal(await count('xp_ledger'), 0);
  assert.equal((await snapshot()).items.find((r) => r.id === 'birthday-date').state, 'added');
  await json(`/api/preparations/${adoptedId}`, { method: 'PATCH', body: { title: '사용자가 고친 준비', timing: '이번 주말' } });
  assert.equal((await write({ action: 'adopt', ruleId: 'birthday-date' })).preparation.title, '사용자가 고친 준비');
  assert.equal(await count('preparation_items'), initialPreps + 1);
  await json(`/api/preparations/${adoptedId}`, { method: 'DELETE' });
  assert.equal((await snapshot()).items.find((r) => r.id === 'birthday-date').state, 'removed');
  await write({ action: 'adopt', ruleId: 'birthday-date' }, 409);
  await write({ action: 'restore' });
  await write({ action: 'adopt', ruleId: 'birthday-date' }, 409);
  console.log('PASS: concurrent adoption, persistent identity after editing/deleting, no reminder or XP side effects');

  const seededGift = s.items.find((r) => r.id === 'celebration-gift').preparationId;
  await write({ action: 'profile', profile: 'meeting' });
  await json(`/api/preparations/${seededGift}`, { method: 'DELETE' });
  await write({ action: 'profile', profile: 'birthday' });
  assert.equal((await snapshot()).items.find((r) => r.id === 'celebration-gift').state, 'removed');
  await write({ action: 'adopt', ruleId: 'celebration-gift' }, 409);
  const savedProfile = await write({ action: 'profile', profile: 'meeting' });
  assert.equal((await snapshot()).configuredProfile, 'meeting');
  const staleToken = savedProfile.snapshot.token;
  await write({ action: 'dismiss', ruleId: 'meeting-agenda' });
  assert.equal((await snapshot()).items.find((r) => r.id === 'meeting-agenda').state, 'dismissed');
  await write({ action: 'adopt', ruleId: 'meeting-agenda' }, 409);
  await write({ action: 'restore' });
  assert.equal((await snapshot()).items.find((r) => r.id === 'meeting-agenda').state, 'available');
  await write({ action: 'profile', profile: 'travel' });
  await json(endpoint, { method: 'POST', body: { action: 'adopt', ruleId: 'meeting-agenda', token: staleToken } }, 409);
  const tokenBeforeEdit = (await snapshot()).token;
  await json(`/api/events/${e.id}`, { method: 'PATCH', body: { ...input, title: '수정된 생신 일정' } });
  await json(endpoint, { method: 'POST', body: { action: 'restore', token: tokenBeforeEdit } }, 409);
  console.log('PASS: seeded deletion tombstones across profiles, persistent choice, dismiss/restore and stale-edit rejection');

  await write({ action: 'profile', profile: 'meeting' });
  const manual = (await json(`/api/events/${e.id}/preparations`, { method: 'POST', body: { title: ' 회의 안건과 목표 정리하기 ', timing: '직접 정한 시점' } }, 201)).preparation;
  const matching = (await snapshot()).items.find((r) => r.id === 'meeting-agenda');
  assert.equal(matching.preparationId, manual.id);
  const existing = await write({ action: 'adopt', ruleId: 'meeting-agenda' });
  assert.equal(existing.preparation.id, manual.id);
  assert.equal(existing.preparation.timing, '직접 정한 시점');

  const settings = `/api/events/${e.id}/preparation-settings`;
  const eventState = async () => db.prepare('SELECT * FROM events WHERE id = ?').bind(e.id).first();
  const relatedState = async () => {
    const result = {};
    for (const table of ['preparation_items', 'recommendation_settings', 'recommendation_state', 'reminder_rules', 'notification_jobs', 'occurrence_completions', 'xp_ledger']) result[table] = (await db.prepare(`SELECT * FROM ${table}`).all()).results;
    return result;
  };
  const before = await relatedState();
  const eventBefore = await eventState();
  for (const enabled of [null, 'false', 0, 1, [], {}]) await json(settings, { method: 'PATCH', body: { enabled } }, 400);
  await json(settings, { method: 'PATCH', owner: null, body: { enabled: false } }, 401);
  await json(settings, { method: 'PATCH', owner: 'intruder', body: { enabled: false } }, 404);
  await json('/api/events/0/preparation-settings', { method: 'PATCH', body: { enabled: false } }, 400);
  assert.equal((await json(settings, { method: 'PATCH', body: { enabled: false } })).enabled, false);
  assert.equal((await snapshot()).enabled, false);
  assert.deepEqual((await snapshot()).items, []);
  await json(endpoint, { method: 'POST', body: { action: 'adopt', ruleId: 'meeting-agenda', token: (await snapshot()).token } }, 409);
  assert.deepEqual(await relatedState(), before, 'Hiding must preserve all preparations, recommendations, completion/XP and notifications.');
  assert.deepEqual(await eventState(), { ...eventBefore, preparations_enabled: 0, notification_revision: eventBefore.notification_revision + 1 }, 'Visibility must advance the edit version without moving the alarm cutoff or schedule.');
  assert.equal((await json('/api/events')).events.find((item) => item.id === e.id).preparations_enabled, 0);
  await json(`/api/events/${e.id}`, { method: 'PATCH', body: input });
  assert.equal((await eventState()).preparations_enabled, 0, 'Old clients omitting the preference must preserve off.');
  await json(settings, { method: 'PATCH', body: { enabled: true } });
  await json(settings, { method: 'PATCH', body: { enabled: true } });
  assert.equal((await snapshot()).configuredProfile, 'meeting');
  assert.equal((await snapshot()).items.find((item) => item.id === 'meeting-agenda').preparationId, manual.id);
  assert.deepEqual(await relatedState(), before, 'Re-enabling cannot reseed items, grant XP or erase receipts.');
  const off = (await json('/api/events', { method: 'POST', body: { ...input, title: '준비 없는 일정', preparationsEnabled: false } }, 201)).event;
  assert.equal(off.preparations_enabled, 0);
  assert.equal(off.preparations.length, 0);
  assert.equal(off.reminders.length, 3);
  assert.equal((await snapshot()).enabled, true, 'Other events remain enabled.');
  await json(`/api/events/${off.id}/preparation-settings`, { method: 'PATCH', body: { enabled: true } });
  assert.equal((await json('/api/events')).events.find((item) => item.id === off.id).preparations.length, 0);
  await json(`/api/events/${off.id}`, { method: 'PATCH', body: { ...input, preparationsEnabled: 'false' } }, 400);
  await json(`/api/events/${off.id}`, { method: 'DELETE' });
  console.log('PASS: opt-out creation, durable per-event visibility, strict ownership/types, no reseeding, no alarm/XP side effects');

  const trip = (await json('/api/events', { method: 'POST', body: { ...input, title: '여행 준비', category: '여행', location: '서울' } }, 201)).event;
  const packing = trip.preparations.find((item) => item.title === '여행 일정에 맞춰 짐 싸기');
  assert.ok(packing, 'New trips seed general packing instead of weather preparation.');
  await json(`/api/preparations/${packing.id}`, { method: 'PATCH', body: { title: '날씨에 맞춰 짐 싸기', timing: '직접 정한 시점' } });
  const retiredPrep = (await json(`/api/events/${trip.id}/preparations`, { method: 'POST', body: { title: '장소의 최신 날씨 확인하기', timing: '출발 전' } }, 201)).preparation;
  // Recreate an adopted, completed pre-removal record in isolated D1 only.
  await db.prepare("UPDATE preparation_items SET recommendation_key = 'location-weather', source = 'recommendation', status = 'complete' WHERE id = ?").bind(retiredPrep.id).run();
  await db.prepare("INSERT INTO recommendation_state (event_id, rule_key, preparation_id, dismissed) VALUES (?, 'location-weather', ?, 0)").bind(trip.id, retiredPrep.id).run();
  const preserved = await relatedState();
  const tripEndpoint = `/api/events/${trip.id}/recommendations`;
  const tripSnapshot = (await json(tripEndpoint)).snapshot;
  assert.ok(!tripSnapshot.items.some((item) => item.id === 'location-weather'));
  assert.equal(tripSnapshot.items.find((item) => item.id === 'travel-packing').preparationId, packing.id);
  assert.deepEqual(await relatedState(), preserved, 'Reading new recommendations never rewrites historical items, completion or alarm records.');
  await json(tripEndpoint, { method: 'POST', body: { action: 'adopt', ruleId: 'location-weather', token: tripSnapshot.token } }, 400);
  assert.deepEqual(await relatedState(), preserved, 'A stale client cannot adopt the retired weather recommendation.');
  const reused = await json(tripEndpoint, { method: 'POST', body: { action: 'adopt', ruleId: 'travel-packing', token: tripSnapshot.token } });
  assert.equal(reused.preparation.id, packing.id);
  assert.equal(reused.preparation.title, '날씨에 맞춰 짐 싸기');
  assert.equal(reused.preparation.timing, '직접 정한 시점');
  assert.equal(await count('preparation_items'), preserved.preparation_items.length);
  const editedRetired = await json(`/api/preparations/${retiredPrep.id}`, { method: 'PATCH', body: { title: '직접 보관한 준비 기록', timing: '확인 완료' } });
  assert.equal(editedRetired.preparation.status, 'complete');
  assert.equal(editedRetired.preparation.id, retiredPrep.id);
  await json(`/api/events/${trip.id}`, { method: 'DELETE' });
  console.log('PASS: retired weather recommendations disappear; existing checklist records remain editable and packing aliases prevent duplication.');

  const anniversary = (await json('/api/events', {method:'POST',body:{...input,title:'결혼 기념일',seedPreparations:false,initialReminderOffsets:[]}},201)).event;
  const stageEndpoint = `/api/events/${anniversary.id}/recommendations`;
  const stageSnapshot = async()=>(await json(stageEndpoint)).snapshot;
  const stageToken = (await stageSnapshot()).token;
  const countsBeforeStages = await Promise.all(['reminder_rules','notification_jobs','xp_ledger','occurrence_completions'].map(count));
  for(const timing of [null,0,[],{},'', ' '.repeat(4),'x'.repeat(61)]) await json(stageEndpoint,{method:'POST',body:{action:'adopt',ruleId:'celebration-gift',token:stageToken,timing}},400);
  await json(stageEndpoint,{method:'POST',body:{action:'dismiss',ruleId:'celebration-gift',token:stageToken,timing:'7일 전'}},400);
  const stageAction={action:'adopt',ruleId:'celebration-gift',token:stageToken,timing:'  21일 전 · 준비 메모  '};
  const adoptedStages=await Promise.all([json(stageEndpoint,{method:'POST',body:stageAction}),json(stageEndpoint,{method:'POST',body:stageAction})]);
  assert.equal(adoptedStages[0].preparation.id,adoptedStages[1].preparation.id);
  const stageId=adoptedStages[0].preparation.id;
  assert.equal(adoptedStages[0].preparation.timing,'21일 전 · 준비 메모');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM preparation_items WHERE event_id = ?').bind(anniversary.id).first()).n,1,'Only the chosen stage is adopted, even under concurrent retries.');
  await json(`/api/preparations/${stageId}`,{method:'PATCH',body:{title:'직접 정한 선물 준비',timing:'내가 정한 시점'}});
  const repeatedStage=await json(stageEndpoint,{method:'POST',body:{...stageAction,token:(await stageSnapshot()).token,timing:'3일 전 · 준비 메모'}});
  assert.equal(repeatedStage.preparation.id,stageId); assert.equal(repeatedStage.preparation.title,'직접 정한 선물 준비'); assert.equal(repeatedStage.preparation.timing,'내가 정한 시점');
  assert.equal((await stageSnapshot()).items.find(item=>item.id==='celebration-booking').state,'available');
  assert.deepEqual(await Promise.all(['reminder_rules','notification_jobs','xp_ledger','occurrence_completions'].map(count)),countsBeforeStages,'Adopting stage notes never creates alerts, completion or XP.');
  const beforeDisabledStage=(await stageSnapshot()).token;
  await json(`/api/events/${anniversary.id}/preparation-settings`,{method:'PATCH',body:{enabled:false}});
  await json(stageEndpoint,{method:'POST',body:{...stageAction,ruleId:'celebration-booking',token:beforeDisabledStage}},409);
  await json(`/api/events/${anniversary.id}/preparation-settings`,{method:'PATCH',body:{enabled:true}});
  await json(`/api/preparations/${stageId}`,{method:'DELETE'});
  await json(stageEndpoint,{method:'POST',body:{...stageAction,token:(await stageSnapshot()).token}},409);
  await json(`/api/events/${anniversary.id}`,{method:'DELETE'});
  console.log('PASS: optional anniversary stage timing, strict validation, concurrent single adoption, preserve edits, opt-out/tombstones and no alarm/XP side effects');

  await json(`/api/events/${e.id}`, { method: 'DELETE' });
  await json(endpoint, undefined, 404);
  assert.equal(await count('recommendation_settings'), 0);
  assert.equal(await count('recommendation_state'), 0);
  console.log('PASS: manual-equivalent dedup without rewriting and event-deletion cascade');
} finally { await mf.dispose(); await mock.close(); }
