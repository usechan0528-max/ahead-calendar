'use client';

import { useEffect, useRef, useState } from 'react';
import type { KakaoPlace } from '@/lib/kakao-place';
import type { RouteResult } from '@/lib/travel-plan';
import { kakaoErrorMessage, loadKakaoMaps } from '@/lib/kakao-maps';

export function JourneyMap({ places, route }: { places: KakaoPlace[]; route?: RouteResult | null }) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const element = container.current;
    const overlays: Array<{ setMap(map: null): void }> = [];
    let observer: ResizeObserver | undefined;
    loadKakaoMaps().then((maps) => {
      if (!active || !element || !places.length) return;
      const point = new maps.LatLng(places[0].latitude, places[0].longitude);
      const map = new maps.Map(element, { center: point, level: 3, scrollwheel: false });
      const bounds = new maps.LatLngBounds();
      places.forEach((place, index) => {
        const position = new maps.LatLng(place.latitude, place.longitude);
        bounds.extend(position);
        overlays.push(new maps.Marker({ position, map, title: `${index + 1}. ${place.name}` }));
        if (places.length > 1) {
          const content = document.createElement('span');
          content.className = 'travel-map-number'; content.textContent = String(index + 1);
          overlays.push(new maps.CustomOverlay({ position, map, content, yAnchor: 2.4 }));
        }
      });
      route?.legs.forEach((leg) => leg.paths.forEach((points) => {
        const path = points.map(([longitude, latitude]) => { const point = new maps.LatLng(latitude, longitude); bounds.extend(point); return point; });
        overlays.push(new maps.Polyline({ path, map, strokeWeight: 5, strokeColor: '#294e3e', strokeOpacity: .85 }));
      }));
      const fit = () => { map.relayout(); if (places.length > 1) map.setBounds(bounds, 45, 35, 35, 35); else map.setCenter(point); };
      observer = new ResizeObserver(fit); observer.observe(element); fit(); setState('ready');
    }).catch((reason) => { if (active) { setError(kakaoErrorMessage(reason)); setState('error'); } });
    return () => { active = false; observer?.disconnect(); overlays.forEach((item) => item.setMap(null)); element?.replaceChildren(); };
  }, [places, route, attempt]);
  return <div className="place-map-wrap">
    <div ref={container} className="place-map" aria-label={places.length > 1 ? '출발지와 방문지, 도착지 지도' : `${places[0]?.name ?? '장소'} 위치 지도`} />
    {state === 'loading' && <p className="place-map-status" role="status">지도를 불러오는 중…</p>}
    {state === 'error' && <div className="place-map-status" role="status"><p>{error}</p><button type="button" onClick={() => { setState('loading'); setAttempt((value) => value + 1); }}>다시 시도</button></div>}
  </div>;
}
