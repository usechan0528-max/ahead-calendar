'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { kakaoPlaceLinks, type KakaoPlace } from '@/lib/kakao-place';
import { formatRouteDistance, formatRouteDuration, modeLabels, routeLink, travelModes, travelStops, travelPlanFingerprint, type RouteResult, type TravelMode, type TravelPlan } from '@/lib/travel-plan';
import { JourneyMap } from './journey-map';

export function EventPlace({ location, place, travelPlan, eventId }: {
  location: string; place?: KakaoPlace | null; travelPlan?: TravelPlan | null; eventId?: number;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<TravelMode>(travelPlan?.mode ?? 'car');
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const links = kakaoPlaceLinks(location, place);
  const resolved = !!links.directions && !!place;
  const stops = useMemo(() => place ? travelPlan ? travelStops(travelPlan, place) : [place] : [], [place, travelPlan]);
  const wholeRouteLink = travelPlan ? routeLink(stops, mode) : null;
  useEffect(() => () => { generation.current += 1; request.current?.abort(); }, []);

  async function calculate() {
    if (!eventId || !travelPlan || !place) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const current = ++generation.current;
    setLoading(true); setError(''); setRoute(null); setOpen(true);
    try {
      const response = await fetch(`/api/events/${eventId}/route`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode, planFingerprint: travelPlanFingerprint(travelPlan, place) }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
      const data = await response.json() as { route?: RouteResult; error?: string };
      if (!response.ok || !data.route) throw new Error(data.error || '경로를 불러오지 못했어요.');
      if (current === generation.current) setRoute(data.route);
    } catch (reason) {
      if (current === generation.current && !controller.signal.aborted) setError(reason instanceof Error && reason.name !== 'TimeoutError' ? reason.message : '응답이 늦어지고 있어요. 잠시 후 다시 시도해 주세요.');
    } finally { if (current === generation.current) setLoading(false); }
  }
  return <section className="event-place" aria-label="일정 장소와 이동 경로">
    <p className="detail-location">⌖ {location}</p>
    {resolved && place.address && <p className="place-address">{place.address}</p>}
    {resolved && travelPlan && <div className="travel-summary">
      <ol className="travel-stop-list">{stops.map((point, index) => <li key={`${point.id}:${index}`}><span>{index + 1}</span><div><small>{index === 0 ? '출발' : index === stops.length - 1 ? '도착' : '방문'}</small><p>{point.name}</p></div></li>)}</ol>
      <fieldset className="travel-mode-options"><legend>이동수단</legend>{travelModes.map((value) => <label key={value}>
        <input type="radio" name={`travel-mode-${eventId}`} checked={mode === value} onChange={() => {
          generation.current += 1; request.current?.abort(); setMode(value); setRoute(null); setError(''); setLoading(false);
        }} />{modeLabels[value]}</label>)}</fieldset>
      <button type="button" className="travel-button travel-primary" disabled={loading || !eventId} onClick={() => void calculate()}>{loading ? '경로 찾는 중…' : `${modeLabels[mode]} 추천 경로 조회`}</button>
      <p className="place-help">조회 시 장소 좌표가 카카오에 전달돼요. 하루 30회까지 조회할 수 있어요.</p>
      {error && <p role="alert" className="place-error">{error}</p>}
      {route && <div className="travel-result" role="status">
        <strong>{formatRouteDuration(route.duration)} <span>· {formatRouteDistance(route.distance)}</span></strong>
        <p>{mode === 'car' ? '카카오 추천 자동차 경로' : mode === 'walk' ? '카카오 최단 도보 경로' : '각 구간의 조회 후보 중 예상시간이 짧은 경로'}</p>
        <small>{new Date(route.fetchedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' })} 조회 기준 · 체류 시간 제외</small>
      </div>}
      <p className="place-help">{mode === 'traffic' ? '대중교통은 구간별 현재 예상시간의 합계예요. 방문 후 연결편·막차·실제 대기시간은 출발 전 확인해 주세요.' : '현재 조회 기준 예상시간이에요. 일정 날짜의 교통상황을 예측하거나 도착을 보장하지 않아요.'}</p>
    </div>}
    <div className="place-actions">
      {resolved && <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '지도 접기' : travelPlan ? '동선 지도 보기' : '지도 보기'}</button>}
      {links.map && <a href={links.map} target="_blank" rel="noopener noreferrer">{resolved ? '장소 카카오맵' : '카카오맵에서 검색'} ↗</a>}
      {wholeRouteLink && <a href={wholeRouteLink} target="_blank" rel="noopener noreferrer">전체 {modeLabels[mode]} 길찾기 ↗</a>}
      {!travelPlan && links.directions && <a href={links.directions} target="_blank" rel="noopener noreferrer">길찾기 ↗</a>}
    </div>
    {resolved && open && <><JourneyMap key={`${mode}:${route?.fetchedAt ?? 'locations'}`} places={stops} route={route} />
      <p className="place-help">지도 제공: Kakao Maps{travelPlan && !route ? ' · 위치만 표시 중이에요. 경로 조회 후 실제 이동 경로가 나타나요.' : ''}</p></>}
    {travelPlan && <ol className="travel-leg-list">{stops.slice(1).map((to, index) => {
      const leg = route?.legs[index], link = routeLink([stops[index], to], mode);
      return <li key={index}><div><strong>{index + 1} → {index + 2}</strong><span>{stops[index].name} → {to.name}</span></div>
        {leg && <p>{formatRouteDuration(leg.duration)} · {formatRouteDistance(leg.distance)}</p>}
        {leg && leg.guidance.length > 0 && <details><summary>구간 안내</summary><ul>{leg.guidance.map((text, index) => <li key={index}>{text}</li>)}</ul></details>}
        {link && <a className="place-external" href={link} target="_blank" rel="noopener noreferrer">{modeLabels[mode]} 구간 길찾기 ↗</a>}
      </li>;
    })}</ol>}
  </section>;
}
