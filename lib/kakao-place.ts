// Shared web/native contract. Only a user-selected place is stored, never search history.
export type KakaoPlace = {
  provider: 'kakao';
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
};

export function parseKakaoPlace(value: unknown): KakaoPlace | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (p.provider !== 'kakao' || typeof p.id !== 'string' || !/^\d{1,32}$/.test(p.id)
    || typeof p.name !== 'string' || !p.name.trim() || p.name.trim().length > 120
    || typeof p.address !== 'string' || p.address.trim().length > 200
    || typeof p.latitude !== 'number' || !Number.isFinite(p.latitude) || Math.abs(p.latitude) > 90
    || typeof p.longitude !== 'number' || !Number.isFinite(p.longitude) || Math.abs(p.longitude) > 180) return null;
  return { provider: 'kakao', id: p.id, name: p.name.trim(), address: p.address.trim(), latitude: p.latitude, longitude: p.longitude };
}

export function readStoredPlace(json: string | null | undefined, location: string): KakaoPlace | null {
  try {
    const place = parseKakaoPlace(JSON.parse(json || 'null'));
    return place?.name === location ? place : null;
  } catch { return null; }
}

export function kakaoSearchUrl(location: string): string | null {
  const query = location.trim().slice(0, 120);
  return query ? `https://map.kakao.com/link/search/${encodeURIComponent(query)}` : null;
}

export function kakaoPlaceLinks(location: string, value?: KakaoPlace | null) {
  const place = parseKakaoPlace(value);
  return place && place.name === location.trim()
    ? { map: `https://map.kakao.com/link/map/${place.id}`, directions: `https://map.kakao.com/link/to/${place.id}` }
    : { map: kakaoSearchUrl(location), directions: null };
}
