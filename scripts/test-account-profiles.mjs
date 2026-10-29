// Built production Worker + isolated D1. Never accesses production accounts/data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as profileLib from '../lib/account-profile.ts';
import { parseUsername, parseNickname, profileSnapshot, isAccountProfileSnapshot, NICKNAME_CHANGE_INTERVAL_MS as interval } from '../lib/account-profile.ts';

assert.equal(parseUsername('  My_ToJ  '), 'my_toj');
for (const invalid of [null, '', 'abc', '1abc', '아이디', 'my.toj', 'my-toj', 'a'.repeat(21), 'admin', 'ROOT', '\nmy_toj', 'my\u200btoj', '<script>']) assert.equal(parseUsername(invalid), null);
assert.equal(parseNickname('  차근차근  '), '차근차근');
assert.equal(parseNickname('한글'.normalize('NFD')), '한글');
assert.equal(parseNickname('ㅋㅋ'), 'ㅋㅋ');
for (const invalid of [null, '', '한', '한'.repeat(17), '두 단어', '이름\n', '이름\u200b', '🔒🔒', '<script>']) assert.equal(parseNickname(invalid), null);
const record = { username: 'my_toj', nickname: '한글', nicknameChangedAt: 1_000, revision: 0 };
const testScope = 'a'.repeat(64);
assert.equal(profileSnapshot(record, testScope, 1_000 + interval - 1).profile.canChangeNickname, false);
assert.equal(profileSnapshot(record, testScope, 1_000 + interval).profile.canChangeNickname, true);
assert.equal(isAccountProfileSnapshot(profileSnapshot(record, testScope)), true);
assert.equal(isAccountProfileSnapshot({ profile: {}, serverNow: 0, nicknameChangeDays: 30 }), false);
console.log('✓ Input normalization, invalid characters, and exact 30-day boundary');

const require = createRequire(import.meta.url);
const component = {};
let uiSnapshot = profileSnapshot(null, testScope);
const uiDependencies = {
  'next/link': { default: ({ children, ...props }) => createElement('a', props, children) },
  './calendar-workspace': { AppIcon: () => createElement('svg', { 'aria-hidden': true }) },
  './use-connection-status': { useConnectionStatus: () => true },
  './use-account-profile': { useAccountProfile: () => ({ snapshot: uiSnapshot, version: 0, refresh() {}, accept() {} }) },
  '@/lib/account-profile': profileLib,
};
runInNewContext(ts.transpileModule(await readFile('components/account-profile-settings.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports: component, require: name => uiDependencies[name] ?? require(name) });
const renderProfile = () => renderToStaticMarkup(createElement(component.AccountProfileSettings));
const setupMarkup = renderProfile();
assert.match(setupMarkup, /프로필 설정/);
assert.match(setupMarkup, /처음 설정한 날부터/);
assert.match(setupMarkup, /중복 불가/);
assert.match(setupMarkup, /영문 대소문자는 구분하지/);
assert.doesNotMatch(setupMarkup, /다른 사람과 같아도/);
assert.doesNotMatch(setupMarkup.match(/<input[^>]*id="profile-username"[^>]*>/)[0], /readOnly/);
uiSnapshot = profileSnapshot(record, testScope, 2_000);
const lockedMarkup = renderProfile();
assert.match(lockedMarkup.match(/<input[^>]*id="profile-username"[^>]*>/)[0], /readOnly/);
assert.match(lockedMarkup.match(/<input[^>]*id="profile-nickname"[^>]*>/)[0], /readOnly/);
assert.match(lockedMarkup, /변경 가능 여부 새로 확인/);
assert.match(lockedMarkup, /한국 시간/);
uiSnapshot = profileSnapshot(record, testScope, 1_000 + interval);
const eligibleMarkup = renderProfile();
assert.doesNotMatch(eligibleMarkup.match(/<input[^>]*id="profile-nickname"[^>]*>/)[0], /readOnly/);
assert.match(eligibleMarkup, /닉네임 변경/);
console.log('✓ Setup/locked/eligible profile forms, immutable ID and visible next-change time');

const { Miniflare, createFetchMock } = createRequire(require.resolve('wrangler/package.json'))('miniflare');
const mock = createFetchMock(); mock.disableNetConnect();
const files = await readdir('dist/server', { recursive: true });
const mf = new Miniflare({
  modules: ['index.js', ...files.filter(name => /\.m?js$/.test(name) && name !== 'index.js')].map(name => ({ type: 'ESModule', path: path.resolve('dist/server', name) })),
  modulesRoot: path.resolve('dist/server'), compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'], fetchMock: mock,
});
try {
  const db = await mf.getD1Database('DB');
  for (const name of (await readdir('drizzle')).filter(name => name.endsWith('.sql')).sort()) {
    for (const sql of (await readFile(path.join('drizzle', name), 'utf8')).split('--> statement-breakpoint')) {
      if (name === '0022_unique_nicknames.sql' && sql.includes('CREATE UNIQUE INDEX')) {
        // Existing collisions must fail safely, not rename/delete members during migration.
        for (const [owner, username, nickname] of [['migration-a', 'legacy_a', 'LegacyName'], ['migration-b', 'legacy_b', 'legacyname']]) {
          await db.prepare('INSERT INTO account_profiles (owner_id, username, nickname, created_at, nickname_changed_at) VALUES (?, ?, ?, 1, 1)').bind(owner, username, nickname).run();
        }
        await assert.rejects(db.prepare(sql).run(), /UNIQUE constraint failed/);
        assert.equal((await db.prepare("SELECT count(*) AS count FROM account_profiles WHERE owner_id IN ('migration-a','migration-b')").first()).count, 2);
        await db.prepare("DELETE FROM account_profiles WHERE owner_id = 'migration-b'").run();
      }
      if (sql.trim()) await db.prepare(sql).run();
      if (name === '0022_unique_nicknames.sql' && sql.includes('CREATE UNIQUE INDEX')) {
        const legacy = await db.prepare("SELECT nickname, revision, created_at, nickname_changed_at FROM account_profiles WHERE owner_id = 'migration-a'").first();
        assert.deepEqual(legacy, { nickname: 'LegacyName', revision: 0, created_at: 1, nickname_changed_at: 1 });
        await db.prepare("DELETE FROM account_profiles WHERE owner_id = 'migration-a'").run();
        await db.prepare('PRAGMA optimize').run();
      }
    }
  }
  console.log('✓ Unique-index migration preserves existing data and refuses unresolved collisions');
  async function request(method = 'GET', body, options = {}) {
    const owner = options.owner === undefined ? 'profile-owner' : options.owner;
    const headers = { 'content-type': 'application/json', origin: 'http://localhost', 'x-toj-profile': '1', ...options.headers };
    if (owner) Object.assign(headers, { 'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': `${owner}@example.test` });
    if (owner && method !== 'GET' && !Object.hasOwn(headers, 'x-toj-profile-account')) {
      const read = await mf.dispatchFetch('http://localhost/api/profile', { headers });
      headers['x-toj-profile-account'] = (await read.json()).accountScope;
    }
    const response = await mf.dispatchFetch('http://localhost/api/profile', { method, headers, body: options.raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    return { response, data: await response.json() };
  }
  async function expect(status, method = 'GET', body, options) {
    const result = await request(method, body, options);
    assert.equal(result.response.status, status, `${method}: ${JSON.stringify(result.data)}`);
    assert.match(result.response.headers.get('cache-control'), /private, no-store/);
    return result.data;
  }
  const create = { username: 'My_ToJ', nickname: '차근차근' };
  for (const method of ['GET', 'POST', 'PATCH']) await expect(401, method, method === 'GET' ? undefined : create, { owner: null });
  assert.equal((await expect(200)).profile, null);
  assert.equal((await db.prepare('SELECT count(*) AS count FROM account_profiles').first()).count, 0);
  for (const headers of [{ origin: 'https://evil.example' }, { origin: 'null' }, { 'x-toj-profile': '' }, { 'sec-fetch-site': 'cross-site' }]) await expect(403, 'POST', create, { headers });
  await expect(415, 'POST', create, { headers: { 'content-type': 'text/plain' } });
  await expect(400, 'POST', undefined, { raw: '{bad' });
  await expect(400, 'POST', []);
  await expect(413, 'POST', undefined, { raw: JSON.stringify({ nickname: '가'.repeat(900) }) });
  for (const payload of [{ ...create, ownerId: 'someone-else' }, { ...create, nicknameChangedAt: 0 }, { username: 'admin', nickname: '운영자' }]) await expect(400, 'POST', payload);
  console.log('✓ Auth, same-origin/custom-header protection, body limits and rejected owner injection');

  const first = await expect(201, 'POST', create);
  assert.equal(first.profile.username, 'my_toj');
  assert.equal(first.profile.canChangeNickname, false);
  assert.equal(first.profile.nextNicknameChangeAt - first.profile.nicknameChangedAt, interval);
  assert.equal('ownerId' in first.profile, false);
  const replay = await expect(200, 'POST', { username: 'my_toj', nickname: '차근차근' });
  assert.deepEqual(replay.profile, first.profile);
  await expect(409, 'POST', { username: 'another_id', nickname: '새로운이름' });
  await expect(400, 'PATCH', { nickname: '새이름', revision: 0, username: 'new_id' });
  await expect(400, 'PATCH', { nickname: '새이름', revision: 0, ownerId: 'someone-else' });
  await expect(429, 'PATCH', { nickname: '새이름', revision: 0 });
  const unchanged = await expect(200, 'PATCH', { nickname: '차근차근', revision: 99 });
  assert.deepEqual(unchanged.profile, first.profile);
  console.log('✓ Immutable ID, initial cooldown, and idempotent replay without extending cooldown');

  const sameUsername = await Promise.all(Array.from({ length: 20 }, (_, i) => request('POST', { username: 'same_username', nickname: `아이디경쟁${i}` }, { owner: `race-${i}` })));
  assert.equal(sameUsername.filter(result => result.response.status === 201).length, 1);
  assert.equal(sameUsername.filter(result => result.response.status === 409 && result.data.code === 'username_taken').length, 19);
  const sameOwner = await Promise.all(Array.from({ length: 20 }, (_, i) => request('POST', { username: `ownerrace_${i}`, nickname: `단일회원${i}` }, { owner: 'same-owner' })));
  assert.equal(sameOwner.filter(result => result.response.status === 201).length, 1);
  assert.equal((await db.prepare("SELECT count(*) AS count FROM account_profiles WHERE owner_id = 'same-owner'").first()).count, 1);
  const duplicate = await expect(409, 'POST', { username: 'other_user', nickname: '  차근차근  '.normalize('NFD') }, { owner: 'other-owner' });
  assert.equal(duplicate.code, 'nickname_taken');
  assert.equal('profile' in duplicate, false);
  assert.equal((await expect(200, 'GET', undefined, { owner: 'other-owner' })).profile, null);
  await expect(201, 'POST', { username: 'other_user', nickname: '다른사용자' }, { owner: 'other-owner' });
  assert.equal((await expect(200, 'GET', undefined, { owner: 'empty-owner' })).profile, null);
  console.log('✓ 20-way unique-ID/first-profile races and normalized duplicate rejection without partial registration');

  const nicknameRace = await Promise.all(Array.from({ length: 20 }, (_, i) => request('POST', { username: `nickname_race_${i}`, nickname: i % 2 ? 'DailyJ' : 'dailyj' }, { owner: `nickname-race-${i}` })));
  assert.equal(nicknameRace.filter(result => result.response.status === 201).length, 1);
  assert.equal(nicknameRace.filter(result => result.response.status === 409 && result.data.code === 'nickname_taken').length, 19);
  assert.equal((await db.prepare("SELECT count(*) AS count FROM account_profiles WHERE lower(nickname) = 'dailyj'").first()).count, 1);
  const plan = await db.prepare('EXPLAIN QUERY PLAN SELECT 1 FROM account_profiles WHERE lower(nickname) = lower(?)').bind('DailyJ').all();
  assert.match(JSON.stringify(plan.results), /idx_account_profiles_nickname_unique/);
  await assert.rejects(db.prepare("INSERT INTO account_profiles (owner_id, username, nickname, created_at, nickname_changed_at) VALUES ('raw-duplicate', 'raw_duplicate', 'DAILYJ', 1, 1)").run(), /idx_account_profiles_nickname_unique/);
  console.log('✓ 20-way case-insensitive nickname race and database-level uniqueness even without API validation');

  const oldScope = (await expect(200)).accountScope;
  assert.equal((await expect(409, 'POST', { username: 'wrong_account', nickname: '잘못된계정' }, { owner: 'fresh-account', headers: { 'x-toj-profile-account': oldScope } })).code, 'account_changed');
  assert.equal((await expect(200, 'GET', undefined, { owner: 'fresh-account' })).profile, null);
  await db.prepare("UPDATE account_profiles SET created_at = 1, nickname_changed_at = 1 WHERE owner_id = 'other-owner'").run();
  const otherBefore = (await expect(200, 'GET', undefined, { owner: 'other-owner' })).profile;
  assert.equal((await expect(409, 'PATCH', { nickname: first.profile.nickname.normalize('NFD'), revision: 0 }, { owner: 'other-owner' })).code, 'nickname_taken');
  assert.deepEqual((await expect(200, 'GET', undefined, { owner: 'other-owner' })).profile, otherBefore);
  assert.equal(otherBefore.canChangeNickname, true);
  assert.equal((await expect(409, 'PATCH', { nickname: '다른계정오류', revision: 0 }, { owner: 'other-owner', headers: { 'x-toj-profile-account': oldScope } })).code, 'account_changed');
  assert.deepEqual((await expect(200, 'GET', undefined, { owner: 'other-owner' })).profile, otherBefore);
  console.log('✓ A stale form cannot create or modify a different account after sign-in changes');

  // Only this isolated test database is advanced to an eligible historical state.
  await db.prepare("UPDATE account_profiles SET created_at = 1, nickname_changed_at = (CAST(strftime('%s','now') AS INTEGER) * 1000) - ? + 60000 WHERE owner_id = ?").bind(interval, 'profile-owner').run();
  await expect(429, 'PATCH', { nickname: '아직안돼요', revision: 0 });
  await db.prepare("UPDATE account_profiles SET nickname_changed_at = (CAST(strftime('%s','now') AS INTEGER) * 1000) - ? WHERE owner_id = ?").bind(interval, 'profile-owner').run();
  const changed = await Promise.all(Array.from({ length: 20 }, (_, i) => request('PATCH', { nickname: `변경이름${i}`, revision: 0 })));
  assert.equal(changed.filter(result => result.response.status === 200).length, 1);
  assert.equal(changed.filter(result => result.response.status === 409).length, 19);
  const current = (await expect(200)).profile;
  assert.equal(current.revision, 1);
  assert.equal(current.username, 'my_toj');
  assert.equal(current.canChangeNickname, false);
  assert.deepEqual((await expect(200, 'PATCH', { nickname: current.nickname, revision: 0 })).profile, current);
  await expect(429, 'PATCH', { nickname: '다시변경', revision: 1 });
  assert.deepEqual((await expect(200, 'GET', undefined, { owner: 'other-owner' })).profile, otherBefore);
  assert.equal((await expect(200, 'GET', undefined, { owner: 'same-owner' })).profile.revision, 0);
  console.log('✓ Database-time cooldown, concurrent nickname CAS, no-op retry and cross-account safety');

  // A duplicate rejection has not consumed the eligible member's change window.
  const corrected = await expect(200, 'PATCH', { nickname: '새로운계획자', revision: 0 }, { owner: 'other-owner' });
  assert.equal(corrected.profile.revision, 1);
  assert.equal(corrected.profile.nickname, '새로운계획자');
  await expect(201, 'POST', { username: 'released_name', nickname: '다른사용자' }, { owner: 'released-owner' });

  const changers = Array.from({ length: 20 }, (_, i) => `changer-${i}`);
  await Promise.all(changers.map((owner, i) => expect(201, 'POST', { username: `changer_${i}`, nickname: `고유회원${i}` }, { owner })));
  await Promise.all(changers.map(owner => db.prepare('UPDATE account_profiles SET created_at = 1, nickname_changed_at = 1 WHERE owner_id = ?').bind(owner).run()));
  const beforeChanges = await Promise.all(changers.map(owner => expect(200, 'GET', undefined, { owner })));
  const changeRace = await Promise.all(changers.map((owner, i) => request('PATCH', { nickname: i % 2 ? '한마음J' : '한마음j', revision: 0 }, { owner })));
  assert.equal(changeRace.filter(result => result.response.status === 200).length, 1);
  assert.equal(changeRace.filter(result => result.response.status === 409 && result.data.code === 'nickname_taken').length, 19);
  for (let i = 0; i < changers.length; i++) {
    if (changeRace[i].response.status === 409) assert.deepEqual((await expect(200, 'GET', undefined, { owner: changers[i] })).profile, beforeChanges[i].profile);
  }
  const eligibleOwner = changers.find((owner, i) => changeRace[i].response.status === 409);
  const mixedRace = await Promise.all([
    request('POST', { username: 'mixed_signup', nickname: '동시선택' }, { owner: 'mixed-owner' }),
    request('PATCH', { nickname: '동시선택', revision: 0 }, { owner: eligibleOwner }),
  ]);
  assert.equal(mixedRace.filter(result => [200, 201].includes(result.response.status)).length, 1);
  assert.equal(mixedRace.filter(result => result.response.status === 409 && result.data.code === 'nickname_taken').length, 1);
  console.log('✓ Failed changes preserve name/revision/cooldown; concurrent create/change share one uniqueness rule');

  await expect(201, 'POST', { username: 'case_display', nickname: 'CaseStyle' }, { owner: 'case-owner' });
  await expect(429, 'PATCH', { nickname: 'CASESTYLE', revision: 0 }, { owner: 'case-owner' });
  await db.prepare("UPDATE account_profiles SET created_at = 1, nickname_changed_at = 1 WHERE owner_id = 'case-owner'").run();
  const caseChange = await expect(200, 'PATCH', { nickname: 'CASESTYLE', revision: 0 }, { owner: 'case-owner' });
  assert.equal(caseChange.profile.nickname, 'CASESTYLE');
  assert.equal(caseChange.profile.revision, 1);
  assert.deepEqual((await expect(200, 'PATCH', { nickname: 'CASESTYLE', revision: 0 }, { owner: 'case-owner' })).profile, caseChange.profile);
  console.log('✓ Own display-case edits follow cooldown while exact retries remain no-ops');

  const page = await mf.dispatchFetch('http://localhost/profile');
  assert.equal(page.status, 200);
  const markup = await page.text();
  assert.match(markup, /내 프로필/);
  assert.match(markup, /프로필을 불러오는 중/);
  assert.doesNotMatch(markup, /차근차근|my_toj/);
  await db.prepare('DROP TABLE account_profiles').run(); // isolated fixture only
  await expect(503);
  console.log('✓ Profile route renders without personal data; storage failure reports unavailable');
  console.log('All account-profile checks passed. No live data or authentication changed.');
} finally { await mf.dispose(); }
