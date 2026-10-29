import { parseKakaoPlace, type KakaoPlace } from './kakao-place';

export const travelModes = ['car', 'traffic', 'walk'] as const;
export type TravelMode = typeof travelModes[number];
export const modeLabels: Record<TravelMode, string> = { car: '자동차', traffic: '대중교통', walk: '도보' };
export const MAX_WAYPOINTS = 5;
export type TravelPlan = { origin: KakaoPlace; waypoints: KakaoPlace[]; mode: TravelMode };
export type RoutePoint = [number, number]; // longitude, latitude (provider / GeoJSON order)
export type RouteLeg = { distance: number; duration: number; paths: RoutePoint[][]; guidance: string[] };
export type RouteResult = { mode: TravelMode; distance: number; duration: number; legs: RouteLeg[]; fetchedAt: string };

export function parseTravelPlan(value: unknown): TravelPlan | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const plan = value as Record<string, unknown>;
  const origin = parseKakaoPlace(plan.origin);
  if (!origin || !travelModes.includes(plan.mode as TravelMode) || !Array.isArray(plan.waypoints)
    || plan.waypoints.length > MAX_WAYPOINTS) return null;
  const waypoints = plan.waypoints.map(parseKakaoPlace);
  if (waypoints.some((place) => !place)) return null;
  return { origin, waypoints: waypoints as KakaoPlace[], mode: plan.mode as TravelMode };
}

export function readTravelPlan(json: string | null | undefined, destination: KakaoPlace | null): TravelPlan | null {
  if (!destination) return null;
  try { return parseTravelPlan(JSON.parse(json || 'null')); } catch { return null; }
}

export function travelStops(plan: TravelPlan, destination: KakaoPlace) { return [plan.origin, ...plan.waypoints, destination]; }

// Include labels as well as coordinates so another tab's edit cannot relabel a calculated route.
export function travelPlanFingerprint(plan: TravelPlan, destination: KakaoPlace) {
  return JSON.stringify([plan.mode, ...travelStops(plan, destination).map((p) => [p.id, p.name, p.address, p.latitude, p.longitude])]);
}

export function routeLink(stops: KakaoPlace[], mode: TravelMode): string | null {
  if (!travelModes.includes(mode) || stops.length < 2 || stops.length > 7 || (mode === 'traffic' && stops.length !== 2)) return null;
  const places = stops.map(parseKakaoPlace);
  if (places.some((place) => !place)) return null;
  return `https://map.kakao.com/link/by/${mode}/${places.map((place) => `${encodeURIComponent(place!.name)},${place!.latitude},${place!.longitude}`).join('/')}`;
}

export function straightDistance(a: KakaoPlace, b: KakaoPlace) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2
    + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

// Exact shortest geometric ordering for <=5 intermediates, NOT a road/time optimum.
// Origin/destination and actual schedule times never change here.
export function suggestWaypointOrder(plan: TravelPlan, destination: KakaoPlace): KakaoPlace[] {
  if (plan.waypoints.length > MAX_WAYPOINTS) return [...plan.waypoints];
  const length = (points: KakaoPlace[]) => points.slice(1).reduce((sum, point, index) => sum + straightDistance(points[index], point), 0);
  let best = [...plan.waypoints];
  let bestDistance = length([plan.origin, ...best, destination]);
  function visit(prefix: KakaoPlace[], remaining: KakaoPlace[]) {
    if (!remaining.length) {
      const distance = length([plan.origin, ...prefix, destination]);
      if (distance < bestDistance - .01) { best = prefix; bestDistance = distance; }
      return;
    }
    remaining.forEach((point, index) => visit([...prefix, point], remaining.filter((_, i) => i !== index)));
  }
  visit([], plan.waypoints);
  return best;
}

export function formatRouteDistance(meters: number) { return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`; }
export function formatRouteDuration(seconds: number) {
  const minutes = Math.ceil(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분` : `${minutes}분`;
}
