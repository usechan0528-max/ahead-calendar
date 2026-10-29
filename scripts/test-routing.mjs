// Default: pure + isolated Worker tests, no external requests. --live uses the operator-provided environment key.
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
  for (const match of [...source.matchAll(/from ['"](\.[^'"]+)['"]/g)]) {
    source = source.replace(match[0], `from '${await moduleUrl(path.resolve(path.dirname(file), `${match[1]}.ts`))}'`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  urls.set(file, url); return url;
}
const travel = await import(await moduleUrl('lib/travel-plan.ts'));
const routing = await import(await moduleUrl('lib/kakao-routing.ts'));
const makePlace = (id, longitude, latitude = 37.4) => ({ provider: 'kakao', id: String(id), name: `장소 ${id}`, address: '테스트 주소', latitude, longitude });
const origin = makePlace(1, 127.11119669891646, 37.394776627382875);
const waypoint = makePlace(2, 127.117, 37.401);
const destination = makePlace(3, 127.12629039752096, 37.4199323570413);
const plan = { origin, waypoints: [waypoint], mode: 'car' };

if (process.argv.includes('--live')) {
  const key = process.env.KAKAO_REST_API_KEY;
  assert.ok(key, 'Provide KAKAO_REST_API_KEY through an ignored environment file.');
  for (const mode of travel.travelModes) {
    try {
      const result = await routing.getKakaoRoute(plan, destination, mode, key);
      assert.equal(result.legs.length, 2); assert.ok(result.distance > 0); assert.ok(result.duration > 0);
      console.log(JSON.stringify({ mode, success: true, legs: result.legs.length, distance: result.distance, duration: result.duration, pathCount: result.legs.reduce((sum, leg) => sum + leg.paths.length, 0) }));
    } catch (error) { console.error(JSON.stringify({ mode, success: false, code: error.code ?? 'failed' })); process.exitCode = 1; }
  }
} else {
  assert.deepEqual(travel.parseTravelPlan(plan), plan);
  for (const invalid of [null, [], {}, { ...plan, origin: null }, { ...plan, mode: 'plane' }, { ...plan, waypoints: [null] }, { ...plan, waypoints: Array(6).fill(waypoint) }]) assert.equal(travel.parseTravelPlan(invalid), null);
  assert.ok(travel.parseTravelPlan({ ...plan, waypoints: Array(5).fill(waypoint) }));
  assert.equal(travel.readTravelPlan(JSON.stringify(plan), null), null);
  assert.equal(travel.readTravelPlan('{bad', destination), null);
  assert.equal(travel.routeLink([origin, waypoint, destination], 'traffic'), null);
  assert.match(travel.routeLink([origin, destination], 'traffic'), /^https:\/\/map\.kakao\.com\/link\/by\/traffic\/%EC%9E%A5%EC%86%8C%201,37/);
  assert.equal(travel.routeLink([origin, { ...destination, id: 'evil' }], 'car'), null);
  const geometric = { origin: makePlace(0, 0, 0), waypoints: [4, 1, 3, 2].map((i) => makePlace(i, i, 0)), mode: 'walk' };
  assert.deepEqual(travel.suggestWaypointOrder(geometric, makePlace(6, 6, 0)).map((p) => p.id), ['1', '2', '3', '4']);
  assert.deepEqual(geometric.waypoints.map((p) => p.id), ['4', '1', '3', '2']);
  assert.equal(travel.formatRouteDuration(3661), '1시간 2분');
  console.log('PASS: bounded route contracts, safe mode links, fixed-end shortest geometric ordering without source mutation');

  const points = [[127.11, 37.39], [127.12, 37.40]];
  const carSection = { distance: 1200, duration: 120, roads: [{ vertexes: points.flat() }] };
  const car = { routes: [{ result_code: 0, summary: { distance: 2400, duration: 240 }, sections: [carSection, carSection] }] };
  const walkLeg = { properties: { distance: 1000, time: 800 }, steps: [{ properties: { guidance: '앞으로 이동' }, path: { points } }] };
  const walk = { status: 'OK', route: { properties: { totalDistance: 2000, totalTime: 1600 }, legs: [walkLeg, walkLeg] } };
  const transitCandidate = (time) => ({ properties: { totalDistance: 3000, totalTime: time }, steps: [{ properties: { guidance: '버스 탑승' }, path: { points } }] });
  const transit = { status: 'OK', routes: [transitCandidate(900), transitCandidate(500)] };
  assert.equal(routing.parseDrivingRoute(car, 2).duration, 240);
  assert.deepEqual(routing.parseDrivingRoute(car, 2).legs[0].paths[0][0], [127.11, 37.39]);
  assert.equal(routing.parseWalkingRoute(walk, 2).duration, 1600);
  assert.equal(routing.parseTransitLeg(transit).duration, 500);
  assert.throws(() => routing.parseDrivingRoute({ routes: [{ result_code: 104 }] }, 1), /no_route/);
  assert.throws(() => routing.parseWalkingRoute({ status: 'SAME_POINT' }, 1), /no_route/);
  assert.throws(() => routing.parseDrivingRoute(car, 3), /invalid_response/);
  assert.throws(() => routing.parseWalkingRoute({ status: 'OK', route: { ...walk.route, properties: { totalTime: -1, totalDistance: 5 } } }, 2), /invalid_response/);
  assert.throws(() => routing.parseTransitLeg({ status: 'OK', routes: [] }), /no_route/);
  console.log('PASS: real API schema parsers, coordinates, meters/seconds, transit candidate selection and malformed/no-route rejection');

  const require = createRequire(import.meta.url);
  const { Miniflare, createFetchMock } = createRequire(require.resolve('wrangler/package.json'))('miniflare');
  const mock = createFetchMock(); mock.disableNetConnect();
  const files = await readdir('dist/server', { recursive: true });
  const fakeKey = 'server-only-rest-test-secret';
  const mf = new Miniflare({
    modules: ['index.js', ...files.filter((file) => /\.m?js$/.test(file) && file !== 'index.js')].map((file) => ({ type: 'ESModule', path: path.resolve('dist/server', file) })),
    modulesRoot: path.resolve('dist/server'), compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], fetchMock: mock, bindings: { KAKAO_REST_API_KEY: fakeKey, KAKAO_MAP_JAVASCRIPT_KEY: 'public-test-key' },
  });
  try {
    const db = await mf.getD1Database('DB');
    for (const file of (await readdir('drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
      for (const sql of (await readFile(path.join('drizzle', file), 'utf8')).split('--> statement-breakpoint')) if (sql.trim()) await db.prepare(sql).run();
    }
    async function api(url, { method = 'GET', owner = 'owner-a', body } = {}) {
      body = await withCurrentEventRevision(db, url, method, owner, body);
      if (url.endsWith('/route') && body?.mode && body.planFingerprint === undefined) body = { ...body, planFingerprint: travel.travelPlanFingerprint(plan, destination) };
      const headers = { 'content-type': 'application/json' };
      if (owner) Object.assign(headers, { 'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': `${owner}@example.test` });
      return mf.dispatchFetch(`http://localhost${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    }
    async function json(url, options, status = 200) {
      const response = await api(url, options);
      assert.equal(response.status, status, `${url}: ${await response.clone().text()}`); return response.json();
    }
    const body = { title: '동선 테스트', category: '여행', eventDate: '2030-01-01', eventTime: '09:00', location: destination.name, place: destination, travelPlan: plan };
    const event = (await json('/api/events', { method: 'POST', body }, 201)).event;
    assert.deepEqual(event.travelPlan, plan); assert.equal('travel_plan_json' in event, false);
    const url = `/api/events/${event.id}`, routeUrl = `${url}/route`;
    assert.equal((await api(routeUrl, { method: 'POST', owner: null, body: { mode: 'car' } })).status, 401);
    assert.equal((await api(routeUrl, { method: 'POST', owner: 'owner-b', body: { mode: 'car' } })).status, 404);
    for (const invalid of [null, [], {}, { mode: 'plane' }]) assert.equal((await api(routeUrl, { method: 'POST', body: invalid })).status, 400);
    assert.equal((await db.prepare('SELECT count(*) AS total FROM route_request_limits').first()).total, 0);
    for (const invalid of [{ ...body, place: null }, { ...body, travelPlan: { ...plan, origin: null } }, { ...body, travelPlan: { ...plan, waypoints: Array(6).fill(waypoint) } }]) assert.equal((await api(url, { method: 'PATCH', body: invalid })).status, 400);
    const olderBody = { ...body }; delete olderBody.travelPlan;
    assert.deepEqual((await json(url, { method: 'PATCH', body: olderBody })).event.travelPlan, plan);
    const publicConfig = await json('/api/maps/config'); assert.equal(JSON.stringify(publicConfig).includes(fakeKey), false);
    assert.deepEqual(publicConfig, { configured: true, javascriptKey: 'public-test-key' });

    function mockRoute(host, pathname, response, extra = () => true, status = 200) {
      return mock.get(host).intercept({ method: 'GET', path: (value) => { const u = new URL(value, host); return u.pathname === pathname && extra(u); }, headers: { authorization: `KakaoAK ${fakeKey}` } }).reply(status, response);
    }
    mockRoute('https://apis-navi.kakaomobility.com', '/v1/directions', car, (u) => u.searchParams.get('waypoints') === `${waypoint.longitude},${waypoint.latitude}` && u.searchParams.get('priority') === 'RECOMMEND');
    const race = await Promise.all([api(routeUrl, { method: 'POST', body: { mode: 'car' } }), api(routeUrl, { method: 'POST', body: { mode: 'car' } })]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 429], JSON.stringify(await Promise.all(race.map((r) => r.clone().json()))));
    const result = await race.find((r) => r.status === 200).json(); assert.equal(result.route.duration, 240);
    assert.equal(JSON.stringify(result).includes(fakeKey), false);
    const release = () => db.prepare('UPDATE route_request_limits SET last_request_at = 0 WHERE owner_id = ?').bind('owner-a').run();
    await release();
    mockRoute('https://dapi.kakao.com', '/v2/routing/walk', walk, (u) => u.searchParams.get('route_mode') === 'SHORTEST' && u.searchParams.get('via_x') === String(waypoint.longitude));
    assert.equal((await json(routeUrl, { method: 'POST', body: { mode: 'walk' } })).route.duration, 1600);
    await release();
    mockRoute('https://dapi.kakao.com', '/v2/routing/publictraffic', transit).times(2);
    assert.equal((await json(routeUrl, { method: 'POST', body: { mode: 'traffic' } })).route.duration, 1000);
    await release(); mockRoute('https://apis-navi.kakaomobility.com', '/v1/directions', { message: fakeKey }, () => true, 403);
    const denied = await json(routeUrl, { method: 'POST', body: { mode: 'car' } }, 502);
    assert.equal(denied.code, 'denied'); assert.equal(JSON.stringify(denied).includes(fakeKey), false);
    await release(); mockRoute('https://apis-navi.kakaomobility.com', '/v1/directions', { routes: [{ result_code: 104 }] });
    assert.equal((await json(routeUrl, { method: 'POST', body: { mode: 'car' } }, 422)).code, 'no_route');
    await db.prepare('UPDATE route_request_limits SET request_count = 30, last_request_at = 0').run();
    assert.equal((await api(routeUrl, { method: 'POST', body: { mode: 'car' } })).status, 429);
    await db.prepare("UPDATE route_request_limits SET request_day = '2000-01-01'").run();
    mockRoute('https://apis-navi.kakaomobility.com', '/v1/directions', car);
    assert.equal((await api(routeUrl, { method: 'POST', body: { mode: 'car' } })).status, 200);
    assert.equal((await db.prepare('SELECT request_count FROM route_request_limits').first()).request_count, 1);
    const changed = { ...destination, id: '4', name: '새 도착지' };
    const quotaBeforeStale = (await db.prepare('SELECT request_count FROM route_request_limits').first()).request_count;
    await json(url, { method: 'PATCH', body: { ...body, travelPlan: { ...plan, waypoints: [] } } });
    assert.equal((await api(routeUrl, { method: 'POST', body: { mode: 'car' } })).status, 409);
    assert.equal((await db.prepare('SELECT request_count FROM route_request_limits').first()).request_count, quotaBeforeStale);
    assert.equal((await json(url, { method: 'PATCH', body: { ...olderBody, location: changed.name, place: changed } })).event.travelPlan, null);
    assert.equal((await api(routeUrl, { method: 'POST', body: { mode: 'car' } })).status, 400);
    await json(url, { method: 'PATCH', body });
    assert.equal((await json(url, { method: 'PATCH', body: { ...body, travelPlan: null } })).event.travelPlan, null);
    mock.assertNoPendingInterceptors();
    console.log('PASS: durable plan CRUD, old-client safety, ownership, atomic throttling/daily reset, 3 modes, no-route/errors and server-only credentials');
  } finally { await mf.dispose(); }
}
