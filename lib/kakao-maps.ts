import { parseKakaoPlace, type KakaoPlace } from './kakao-place';

type Coordinates = object;
type Bounds = { extend(point: Coordinates): void };
export type MapInstance = { relayout(): void; setCenter(point: Coordinates): void; setBounds(bounds: Bounds, top?: number, right?: number, bottom?: number, left?: number): void };
type MarkerInstance = { setMap(map: MapInstance | null): void };
type SearchRow = { id: string; place_name: string; road_address_name: string; address_name: string; x: string; y: string };
type Pagination = { current: number; last: number };
export type KakaoMaps = {
  load(callback: () => void): void;
  LatLng: new (latitude: number, longitude: number) => Coordinates;
  LatLngBounds: new () => Bounds;
  Map: new (element: HTMLElement, options: { center: Coordinates; level: number; scrollwheel: boolean }) => MapInstance;
  Marker: new (options: { position: Coordinates; map: MapInstance; title?: string }) => MarkerInstance;
  CustomOverlay: new (options: { position: Coordinates; content: HTMLElement; map: MapInstance; yAnchor: number }) => MarkerInstance;
  Polyline: new (options: { path: Coordinates[]; strokeWeight: number; strokeColor: string; strokeOpacity: number; map: MapInstance }) => MarkerInstance;
  services: {
    Status: { OK: string; ZERO_RESULT: string };
    Places: new () => { keywordSearch(query: string, callback: (rows: SearchRow[], status: string, pagination: Pagination) => void, options: { size: number; page: number }): void };
  };
};
declare global { interface Window { kakao?: { maps: KakaoMaps } } }

export class KakaoMapsError extends Error {
  constructor(public code: 'unconfigured' | 'unavailable' | 'search') { super(code); }
}

let pending: Promise<KakaoMaps> | null = null;

// Load only after an explicit search or map-open action. Never load a REST/Admin key.
export function loadKakaoMaps(): Promise<KakaoMaps> {
  if (pending) return pending;
  pending = (async () => {
    const response = await fetch('/api/maps/config', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new KakaoMapsError('unavailable');
    const config = await response.json() as { javascriptKey?: string; configured?: boolean };
    if (!config.configured || !config.javascriptKey) throw new KakaoMapsError('unconfigured');
    const javascriptKey = config.javascriptKey;
    return new Promise<KakaoMaps>((resolve, reject) => {
      const script = document.createElement('script');
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        script.onload = script.onerror = null;
        script.remove();
        reject(new KakaoMapsError('unavailable'));
      };
      const timeout = setTimeout(fail, 15000);
      script.async = true;
      const url = new URL('https://dapi.kakao.com/v2/maps/sdk.js');
      url.searchParams.set('appkey', javascriptKey);
      url.searchParams.set('libraries', 'services');
      url.searchParams.set('autoload', 'false');
      script.src = url.toString();
      script.onerror = fail;
      script.onload = () => {
        try {
          if (!window.kakao?.maps?.load) return fail();
          window.kakao.maps.load(() => {
            if (settled) return;
            const maps = window.kakao?.maps;
            if (!maps?.Map || !maps.services?.Places) return fail();
            settled = true;
            clearTimeout(timeout);
            script.onload = script.onerror = null;
            resolve(maps);
          });
        } catch { fail(); }
      };
      document.head.appendChild(script);
    });
  })().catch((error) => { pending = null; throw error; });
  return pending;
}

export async function searchKakaoPlaces(query: string, page = 1) {
  const maps = await loadKakaoMaps();
  return new Promise<{ places: KakaoPlace[]; page: number; last: number }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new KakaoMapsError('search')), 10000);
    try {
      new maps.services.Places().keywordSearch(query.trim().slice(0, 120), (rows, status, pagination) => {
        clearTimeout(timer);
        if (status === maps.services.Status.ZERO_RESULT) return resolve({ places: [], page: 1, last: 1 });
        if (status !== maps.services.Status.OK) return reject(new KakaoMapsError('search'));
        const places = rows.map((row) => parseKakaoPlace({ provider: 'kakao', id: row.id, name: row.place_name,
          address: row.road_address_name || row.address_name, latitude: Number(row.y), longitude: Number(row.x) }))
          .filter((place): place is KakaoPlace => !!place);
        resolve({ places, page: pagination.current, last: pagination.last });
      }, { size: 5, page });
    } catch { clearTimeout(timer); reject(new KakaoMapsError('search')); }
  });
}

export function kakaoErrorMessage(error: unknown) {
  return error instanceof KakaoMapsError && error.code === 'unconfigured'
    ? '카카오맵 연결 준비 중이에요. 지금은 장소를 직접 입력하거나 카카오맵에서 찾아볼 수 있어요.'
    : '카카오맵을 불러오지 못했어요. 잠시 후 다시 시도하거나 카카오맵에서 직접 확인해 주세요.';
}
