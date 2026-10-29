// No browser automation, production writes or real Kakao calls. Build the Worker first.
import { withCurrentEventRevision } from './current-event-revision.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { parseKakaoPlace, readStoredPlace, kakaoSearchUrl, kakaoPlaceLinks } from '../lib/kakao-place.ts';

const place = { provider: 'kakao', id: '123456', name: '서울역 테스트', address: '서울 중구 테스트로', latitude: 37.554, longitude: 126.97 };
assert.deepEqual(parseKakaoPlace(place), place);
for (const invalid of [null, [], {}, { ...place, id: '../evil' }, { ...place, provider: 'other' },
  { ...place, latitude: NaN }, { ...place, latitude: 91 }, { ...place, longitude: -181 },
  { ...place, longitude: '126.97' }, { ...place, name: '' }, { ...place, address: 'x'.repeat(201) }]) {
  assert.equal(parseKakaoPlace(invalid), null);
}
assert.deepEqual(readStoredPlace(JSON.stringify(place), place.name), place);
assert.equal(readStoredPlace('{broken', place.name), null);
assert.equal(readStoredPlace(JSON.stringify(place), '다른 장소'), null);
assert.equal(kakaoSearchUrl('   '), null);
assert.equal(kakaoSearchUrl('서울 & 부산/#?'), 'https://map.kakao.com/link/search/%EC%84%9C%EC%9A%B8%20%26%20%EB%B6%80%EC%82%B0%2F%23%3F');
assert.deepEqual(kakaoPlaceLinks(place.name, place), { map: 'https://map.kakao.com/link/map/123456', directions: 'https://map.kakao.com/link/to/123456' });
assert.equal(kakaoPlaceLinks('수정된 장소', place).directions, null);
console.log('PASS: strict place contract, safe stored decoding and fixed-origin encoded links');

const urls = new Map();
async function moduleUrl(file) {
  file = path.resolve(file);
  if (urls.has(file)) return urls.get(file);
  let source = ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const match of [...source.matchAll(/from ['"](\.[^'"]+)['"]/g)]) {
    source = source.replace(match[0], `from '${await moduleUrl(path.resolve(path.dirname(file), `${match[1]}.ts`))}'`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  urls.set(file, url); return url;
}
const sdk = await import(await moduleUrl('lib/kakao-maps.ts'));
const originalFetch = globalThis.fetch;
let configured = false, failScript = false, appended = 0, fetched = 0, scriptRemoved = 0, status = 'OK';
const fakeKey = 'javascript-test-key';
const fakeMaps = {
  load: (callback) => queueMicrotask(callback), Map: class {},
  services: { Status: { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT' }, Places: class {
    keywordSearch(query, callback, options) {
      assert.equal(query, '서울역'); assert.deepEqual(options, { size: 5, page: 2 });
      callback([{ id: place.id, place_name: place.name, road_address_name: place.address, address_name: '', x: '126.97', y: '37.554' }], status, { current: 2, last: 4 });
    }
  } },
};
globalThis.fetch = async (url) => { assert.equal(url, '/api/maps/config'); fetched++; return Response.json(configured ? { configured: true, javascriptKey: fakeKey } : { configured: false }); };
globalThis.window = { kakao: { maps: fakeMaps } };
globalThis.document = {
  createElement: () => ({ remove: () => { scriptRemoved++; } }),
  head: { appendChild(script) {
    appended++;
    const url = new URL(script.src);
    assert.equal(url.origin, 'https://dapi.kakao.com');
    assert.equal(url.searchParams.get('appkey'), fakeKey);
    assert.equal(url.searchParams.get('libraries'), 'services');
    assert.equal(url.searchParams.get('autoload'), 'false');
    queueMicrotask(() => failScript ? script.onerror() : script.onload());
  } },
};
try {
  await assert.rejects(sdk.loadKakaoMaps(), (error) => error.code === 'unconfigured');
  assert.equal(appended, 0);
  configured = true; failScript = true;
  await assert.rejects(sdk.loadKakaoMaps(), (error) => error.code === 'unavailable');
  assert.equal(scriptRemoved, 1);
  failScript = false;
  const results = await Promise.all([sdk.loadKakaoMaps(), sdk.loadKakaoMaps()]);
  assert.equal(results[0], fakeMaps); assert.equal(results[1], fakeMaps);
  assert.equal(fetched, 3); assert.equal(appended, 2);
  const found = await sdk.searchKakaoPlaces(' 서울역 ', 2);
  assert.deepEqual(found, { places: [place], page: 2, last: 4 });
  status = 'ZERO_RESULT'; assert.equal((await sdk.searchKakaoPlaces('서울역', 2)).places.length, 0);
  status = 'ERROR'; await assert.rejects(sdk.searchKakaoPlaces('서울역', 2), (error) => error.code === 'search');
} finally { globalThis.fetch = originalFetch; delete globalThis.document; delete globalThis.window; }
console.log('PASS: lazy SDK, missing key, script failure/retry, concurrent load, paged search and no-results/error');

const require = createRequire(import.meta.url);
const { Miniflare, createFetchMock } = createRequire(require.resolve('wrangler/package.json'))('miniflare');
const mock = createFetchMock(); mock.disableNetConnect();
const files = await readdir('dist/server', { recursive: true });
const options = {
  modules: ['index.js', ...files.filter((file) => /\.m?js$/.test(file) && file !== 'index.js')].map((file) => ({ type: 'ESModule', path: path.resolve('dist/server', file) })),
  modulesRoot: path.resolve('dist/server'), compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'], fetchMock: mock,
};
const mf = new Miniflare({ ...options, bindings: { KAKAO_MAP_JAVASCRIPT_KEY: fakeKey, SCHEDULER_SECRET: 'private-do-not-return' } });
try {
  const db = await mf.getD1Database('DB');
  for (const file of (await readdir('drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
    for (const sql of (await readFile(path.join('drizzle', file), 'utf8')).split('--> statement-breakpoint')) {
      if (sql.trim()) await db.prepare(sql).run();
    }
  }
  async function api(url, { method = 'GET', owner = 'owner-a', body } = {}) {
    body = await withCurrentEventRevision(db, url, method, owner, body);
    const headers = { 'content-type': 'application/json' };
    if (owner) Object.assign(headers, { 'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': `${owner}@example.test` });
    return mf.dispatchFetch(`http://localhost${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function json(url, options, status = 200) {
    const response = await api(url, options);
    assert.equal(response.status, status, `${url}: ${await response.clone().text()}`);
    return response.json();
  }
  assert.equal((await api('/api/maps/config', { owner: null })).status, 401);
  const config = await api('/api/maps/config');
  assert.equal(config.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await config.json(), { configured: true, javascriptKey: fakeKey });
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const body = { title: '지도 테스트', category: '일정', eventDate: today, eventTime: '09:00', location: place.name, place };
  const event = (await json('/api/events', { method: 'POST', body }, 201)).event;
  assert.deepEqual(event.place, place); assert.equal('place_json' in event, false);
  const url = `/api/events/${event.id}`;
  assert.deepEqual((await json('/api/events')).events.find((item) => item.id === event.id).place, place);
  assert.equal((await api(url, { method: 'PATCH', owner: 'owner-b', body })).status, 404);
  assert.equal((await api(url, { method: 'PATCH', owner: null, body })).status, 401);
  for (const invalid of [{ ...place, longitude: 181 }, { ...place, id: 'javascript:evil' }, { ...place, name: 'Mismatch' }, []]) {
    assert.equal((await api(url, { method: 'PATCH', body: { ...body, place: invalid } })).status, 400);
  }
  const oldBody = { ...body }; delete oldBody.place;
  assert.deepEqual((await json(url, { method: 'PATCH', body: { ...oldBody, title: '이름 수정' } })).event.place, place);
  assert.equal((await api(`${url}/context?date=${today}`)).status, 404, 'Removed weather route stays unavailable; map data remains intact.');
  assert.equal((await json(url, { method: 'PATCH', body: { ...oldBody, location: '다른 위치' } })).event.place, null);
  await json(url, { method: 'PATCH', body });
  assert.equal((await json(url, { method: 'PATCH', body: { ...body, place: null } })).event.place, null);
  const plain = (await json('/api/events', { method: 'POST', body: { ...oldBody, location: '부산' } }, 201)).event;
  assert.equal(plain.place, null);
  mock.assertNoPendingInterceptors();
  console.log('PASS: migrations, place CRUD, older clients, ownership, config credential allowlist and removed weather endpoint');
} finally { await mf.dispose(); }
const unconfigured = new Miniflare(options);
try {
  const response = await unconfigured.dispatchFetch('http://localhost/api/maps/config', { headers: { 'oai-authenticated-user-id': 'owner-a', 'oai-authenticated-user-email': 'a@example.test' } });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { configured: false });
  console.log('PASS: unconfigured deployment degrades without exposing keys');
} finally { await unconfigured.dispose(); }
