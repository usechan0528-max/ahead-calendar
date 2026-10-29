'use client';

import { useId, useState } from 'react';
import { PlacePicker } from './place-picker';
import type { KakaoPlace } from '@/lib/kakao-place';
import { MAX_WAYPOINTS, modeLabels, suggestWaypointOrder, travelModes, type TravelMode, type TravelPlan } from '@/lib/travel-plan';

export function EventLocationFields({ location, place = null, travelPlan = null, travelDraft, initialOriginQuery }: {
  location?: string; place?: KakaoPlace | null; travelPlan?: TravelPlan | null;
  travelDraft?: Omit<TravelPlan, 'origin'> & { origin: KakaoPlace | null }; initialOriginQuery?: string;
}) {
  const id = useId();
  const [destination, setDestination] = useState(place);
  const initialPlan = travelPlan ?? travelDraft;
  const [enabled, setEnabled] = useState(!!initialPlan);
  const [origin, setOrigin] = useState(initialPlan?.origin ?? null);
  const [waypoints, setWaypoints] = useState(initialPlan?.waypoints ?? []);
  const [mode, setMode] = useState<TravelMode>(initialPlan?.mode ?? 'car');
  const [adding, setAdding] = useState(false);
  const [searchVersion, setSearchVersion] = useState(0);
  const [notice, setNotice] = useState('');
  const active = enabled && !!destination;
  const plan = active ? { origin, waypoints, mode } : null;
  function move(index: number, direction: number) {
    const next = [...waypoints];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    setWaypoints(next); setNotice('');
  }
  return <>
    <PlacePicker location={location} place={place} label="장소 / 도착지 (선택)" onChange={(value) => { setDestination(value); setNotice(''); }} />
    <input type="hidden" name="travelPlan" value={JSON.stringify(plan)} />
    {destination && <div className="travel-fields">
      <label className="travel-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />이동 경로도 계획하기</label>
      {active && <>
        <label htmlFor={`${id}-mode`} className="travel-label">이동수단</label>
        <select id={`${id}-mode`} value={mode} onChange={(event) => setMode(event.target.value as TravelMode)} className="travel-select">
          {travelModes.map((value) => <option key={value} value={value}>{modeLabels[value]}</option>)}
        </select>
        <PlacePicker location={origin?.name ?? initialOriginQuery} place={origin} label="출발지" fieldName="routeOriginQuery" placeFieldName="routeOriginPlace" onChange={setOrigin} />
        {!origin && <p className="place-help">출발지는 검색 결과에서 선택해야 경로를 저장할 수 있어요.</p>}
        <p className="travel-label">중간 방문지 <span className="place-optional">{waypoints.length} / {MAX_WAYPOINTS}</span></p>
        <ol className="travel-edit-stops">{waypoints.map((point, index) => <li key={`${point.id}:${index}`}>
          <span>{index + 1}. {point.name}<small>{point.address}</small></span>
          <div><button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`${point.name} 앞으로`}>↑</button>
            <button type="button" disabled={index === waypoints.length - 1} onClick={() => move(index, 1)} aria-label={`${point.name} 뒤로`}>↓</button>
            <button type="button" onClick={() => { setWaypoints(waypoints.filter((_, i) => i !== index)); setNotice(''); }} aria-label={`${point.name} 방문지 삭제`}>삭제</button></div>
        </li>)}</ol>
        {waypoints.length < MAX_WAYPOINTS && !adding && <button type="button" className="travel-button" onClick={() => setAdding(true)}>+ 중간 방문지 추가</button>}
        {adding && <div className="travel-add-stop"><PlacePicker key={searchVersion} label="추가할 방문지 검색" fieldName="routeStopQuery" placeFieldName="routeStopPlace" onChange={(value) => {
          if (!value) return;
          setWaypoints((items) => [...items, value].slice(0, MAX_WAYPOINTS)); setAdding(false); setSearchVersion((v) => v + 1); setNotice('');
        }} /><button type="button" className="travel-button" onClick={() => setAdding(false)}>추가 취소</button></div>}
        <p className="travel-destination">도착 · {destination.name}</p>
        {origin && waypoints.length >= 2 && <>
          <button type="button" className="travel-button" onClick={() => {
            const next = suggestWaypointOrder({ origin, waypoints, mode }, destination);
            const changed = next.some((item, index) => item !== waypoints[index]);
            setWaypoints(next); setNotice(changed ? '중간 방문지의 순서를 바꿨어요. 일정 저장을 눌러야 반영돼요.' : '현재 순서가 직선거리 기준으로 가장 짧아요.');
          }}>방문 순서 제안 적용</button>
          <p className="place-help">출발·도착 고정, 직선거리 기준 제안이에요. 도로·교통·예약 시간은 반영하지 않으니 순서를 확인해 주세요.</p>
        </>}
        {notice && <p className="place-help" role="status">{notice}</p>}
        <p className="place-help">경로는 일정 저장 후 조회할 수 있어요. 대중교통은 방문지 사이의 구간별 경로를 비교해요.</p>
      </>}
    </div>}
  </>;
}
