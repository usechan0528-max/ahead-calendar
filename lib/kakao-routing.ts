import type { KakaoPlace } from './kakao-place';
import { straightDistance, travelStops, type RouteLeg, type RoutePoint, type RouteResult, type TravelMode, type TravelPlan } from './travel-plan';

export class RouteProviderError extends Error {
  constructor(public code: 'denied' | 'quota' | 'no_route' | 'unavailable' | 'invalid_response') { super(code); }
}
type Obj = Record<string, unknown>;
function object(value: unknown): Obj { return value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function metric(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new RouteProviderError('invalid_response');
  return value;
}
function point(value: unknown): RoutePoint {
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'number' || !Number.isFinite(value[0]) || Math.abs(value[0]) > 180
    || typeof value[1] !== 'number' || !Number.isFinite(value[1]) || Math.abs(value[1]) > 90) throw new RouteProviderError('invalid_response');
  return [value[0], value[1]];
}
function guidance(steps: unknown[]) {
  return steps.map((step) => object(object(step).properties).guidance).filter((text): text is string => typeof text === 'string' && text.length > 0).slice(0, 30).map((text) => text.slice(0, 240));
}
function stepPaths(steps: unknown[]): RoutePoint[][] {
  return steps.map((step) => array(object(object(step).path).points).map(point)).filter((path) => path.length >= 2);
}
function validatePaths(legs: RouteLeg[]) {
  const count = legs.reduce((sum, leg) => sum + leg.paths.reduce((n, path) => n + path.length, 0), 0);
  if (count > 20000 || legs.some((leg) => leg.distance > 0 && !leg.paths.length)) throw new RouteProviderError('invalid_response');
}

export function parseDrivingRoute(value: unknown, legCount: number): Omit<RouteResult, 'mode' | 'fetchedAt'> {
  const route = array(object(value).routes).map(object).find((route) => route.result_code === 0);
  if (!route) throw new RouteProviderError('no_route');
  const summary = object(route.summary);
  const sections = array(route.sections);
  if (sections.length !== legCount) throw new RouteProviderError('invalid_response');
  const legs = sections.map((value) => {
    const section = object(value);
    const paths = array(section.roads).map((road) => {
      const vertices = array(object(road).vertexes);
      if (vertices.length % 2) throw new RouteProviderError('invalid_response');
      const points: RoutePoint[] = [];
      for (let i = 0; i < vertices.length; i += 2) points.push(point([vertices[i], vertices[i + 1]]));
      return points;
    }).filter((path) => path.length >= 2);
    return { distance: metric(section.distance), duration: metric(section.duration), paths, guidance: [] };
  });
  validatePaths(legs);
  return { distance: metric(summary.distance), duration: metric(summary.duration), legs };
}

export function parseWalkingRoute(value: unknown, legCount: number): Omit<RouteResult, 'mode' | 'fetchedAt'> {
  const data = object(value);
  if (data.status !== 'OK') throw new RouteProviderError('no_route');
  const route = object(data.route), properties = object(route.properties);
  const legs = array(route.legs).map((value) => {
    const leg = object(value), properties = object(leg.properties), steps = array(leg.steps);
    return { distance: metric(properties.distance), duration: metric(properties.time), paths: stepPaths(steps), guidance: guidance(steps) };
  });
  if (legs.length !== legCount) throw new RouteProviderError('invalid_response');
  validatePaths(legs);
  return { distance: metric(properties.totalDistance), duration: metric(properties.totalTime), legs };
}

export function parseTransitLeg(value: unknown): RouteLeg {
  const data = object(value);
  if (data.status !== 'OK') throw new RouteProviderError('no_route');
  // Choose the shortest duration among provider-returned candidates, not a global timetable optimum.
  const routes = array(data.routes).map(object).filter((route) => {
    const p = object(route.properties);
    return typeof p.totalTime === 'number' && Number.isFinite(p.totalTime) && p.totalTime >= 0;
  }).sort((a, b) => Number(object(a.properties).totalTime) - Number(object(b.properties).totalTime));
  const route = routes[0];
  if (!route) throw new RouteProviderError('no_route');
  const p = object(route.properties), steps = array(route.steps);
  const leg = { distance: metric(p.totalDistance), duration: metric(p.totalTime), paths: stepPaths(steps), guidance: guidance(steps) };
  validatePaths([leg]); return leg;
}

async function readLimitedJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new RouteProviderError('invalid_response');
  const decoder = new TextDecoder(); let size = 0, text = '';
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 3000000) { await reader.cancel(); throw new RouteProviderError('invalid_response'); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) { if (error instanceof RouteProviderError) throw error; throw new RouteProviderError('invalid_response'); }
  finally { reader.releaseLock(); }
}

export async function getKakaoRoute(plan: TravelPlan, destination: KakaoPlace, mode: TravelMode, key: string, signal?: AbortSignal): Promise<RouteResult> {
  const stops = travelStops(plan, destination);
  const controller = new AbortController();
  const combined = AbortSignal.any([controller.signal, AbortSignal.timeout(15000), ...(signal ? [signal] : [])]);
  async function request(url: URL) {
    try {
      const response = await fetch(url, { headers: { Authorization: `KakaoAK ${key}`, Accept: 'application/json' }, signal: combined, redirect: 'manual' });
      if (response.status === 401 || response.status === 403) throw new RouteProviderError('denied');
      if (response.status === 429) throw new RouteProviderError('quota');
      if (!response.ok) throw new RouteProviderError('unavailable');
      return await readLimitedJson(response);
    } catch (error) { if (error instanceof RouteProviderError) throw error; throw new RouteProviderError('unavailable'); }
  }
  const origin = stops[0];
  let result: Omit<RouteResult, 'mode' | 'fetchedAt'>;
  try {
    if (mode === 'car') {
      const url = new URL('https://apis-navi.kakaomobility.com/v1/directions');
      url.searchParams.set('origin', `${origin.longitude},${origin.latitude}`);
      url.searchParams.set('destination', `${destination.longitude},${destination.latitude}`);
      if (plan.waypoints.length) url.searchParams.set('waypoints', plan.waypoints.map((p) => `${p.longitude},${p.latitude}`).join('|'));
      url.searchParams.set('priority', 'RECOMMEND'); url.searchParams.set('summary', 'false');
      result = parseDrivingRoute(await request(url), stops.length - 1);
    } else if (mode === 'walk') {
      const url = new URL('https://dapi.kakao.com/v2/routing/walk');
      url.searchParams.set('start_x', String(origin.longitude)); url.searchParams.set('start_y', String(origin.latitude));
      url.searchParams.set('end_x', String(destination.longitude)); url.searchParams.set('end_y', String(destination.latitude));
      url.searchParams.set('output_coord', 'WGS84'); url.searchParams.set('route_mode', 'SHORTEST');
      if (plan.waypoints.length) {
        url.searchParams.set('via_x', plan.waypoints.map((p) => p.longitude).join(','));
        url.searchParams.set('via_y', plan.waypoints.map((p) => p.latitude).join(','));
      }
      result = parseWalkingRoute(await request(url), stops.length - 1);
    } else {
      const legs = await Promise.all(stops.slice(1).map(async (to, index) => {
        const from = stops[index];
        if (straightDistance(from, to) < 1) return { distance: 0, duration: 0, paths: [], guidance: ['같은 위치'] };
        const url = new URL('https://dapi.kakao.com/v2/routing/publictraffic');
        url.searchParams.set('start_x', String(from.longitude)); url.searchParams.set('start_y', String(from.latitude));
        url.searchParams.set('end_x', String(to.longitude)); url.searchParams.set('end_y', String(to.latitude));
        url.searchParams.set('output_coord', 'WGS84');
        return parseTransitLeg(await request(url));
      }));
      validatePaths(legs);
      result = { distance: legs.reduce((sum, leg) => sum + leg.distance, 0), duration: legs.reduce((sum, leg) => sum + leg.duration, 0), legs };
    }
    return { ...result, mode, fetchedAt: new Date().toISOString() };
  } finally { controller.abort(); }
}
