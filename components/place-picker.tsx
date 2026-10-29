'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { kakaoSearchUrl, type KakaoPlace } from '@/lib/kakao-place';
import { kakaoErrorMessage, searchKakaoPlaces } from '@/lib/kakao-maps';

export function PlacePicker({ location = '', place = null, label = '장소', fieldName = 'location', placeFieldName = 'place', onChange }: {
  location?: string; place?: KakaoPlace | null; label?: string; fieldName?: string; placeFieldName?: string;
  onChange?: (place: KakaoPlace | null) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState(location);
  const [selected, setSelected] = useState(place);
  const [result, setResult] = useState<{ places: KakaoPlace[]; page: number; last: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const resultsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLButtonElement>(null);
  const searchUrl = kakaoSearchUrl(query);
  useEffect(() => () => { generation.current += 1; }, []);

  async function search(page = 1) {
    if (!query.trim()) return;
    const request = ++generation.current;
    setLoading(true); setError(''); setResult(null);
    try {
      const data = await searchKakaoPlaces(query, page);
      if (request === generation.current) setResult(data);
    } catch (reason) {
      if (request === generation.current) setError(kakaoErrorMessage(reason));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }

  function changeQuery(value: string) {
    generation.current += 1;
    setQuery(value); setSelected(null); setResult(null); setLoading(false); setError('');
    onChange?.(null);
  }

  return <div className="place-picker">
    <label htmlFor={id}>{label}</label>
    <div className="place-search-row">
      <input id={id} name={fieldName} value={query} maxLength={120} autoComplete="off"
        placeholder="장소 이름 검색 또는 직접 입력" aria-describedby={`${id}-help`}
        onChange={(event) => changeQuery(event.target.value)} onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') { event.preventDefault(); if (!loading) void search(); }
          if (event.key === 'ArrowDown' && result?.places.length) { event.preventDefault(); resultsRef.current?.querySelector('button')?.focus(); }
          if (event.key === 'Escape' && result) { event.preventDefault(); event.stopPropagation(); setResult(null); }
        }} />
      <button ref={searchRef} type="button" className="place-search-button" disabled={loading || !query.trim()} onClick={() => void search()}>
        {loading ? '검색 중…' : '장소 검색'}
      </button>
    </div>
    <input type="hidden" name={placeFieldName} value={JSON.stringify(selected)} />
    <p id={`${id}-help`} className="place-help">검색하면 검색어가 카카오에 전달돼요. 주소까지 확인한 뒤 선택해 주세요.</p>
    {selected && <div className="place-selection">
      <div><span className="place-selected-label">카카오맵 장소 선택됨</span><p>{selected.address || selected.name}</p></div>
      <button type="button" onClick={() => { setSelected(null); onChange?.(null); searchRef.current?.focus(); }} aria-label="선택한 지도 장소 해제">해제</button>
    </div>}
    <div role="status" aria-live="polite">
      {loading && <p className="place-help">장소를 찾고 있어요.</p>}
      {error && <p className="place-error">{error}</p>}
      {result && <p className="place-help">{result.places.length ? `${result.page}페이지 · ${result.places.length}개 장소에서 선택하세요.` : '검색 결과가 없어요. 지역명과 장소 이름을 함께 입력해 보세요.'}</p>}
    </div>
    {result && result.places.length > 0 && <div ref={resultsRef} className="place-results" aria-label="카카오 장소 검색 결과">
      <ul>{result.places.map((item) => <li key={item.id}>
        <button type="button" onClick={() => {
          generation.current += 1;
          setSelected(item); setQuery(item.name); setResult(null); setError('');
          onChange?.(item);
          searchRef.current?.focus();
        }}><strong>{item.name}</strong><span>{item.address || '주소 정보 없음'}</span></button>
      </li>)}</ul>
      {result.last > 1 && <nav className="place-pagination" aria-label="장소 검색 페이지">
        <button type="button" disabled={result.page <= 1} onClick={() => void search(result.page - 1)}>이전</button>
        <span>{result.page} / {result.last}</span>
        <button type="button" disabled={result.page >= result.last} onClick={() => void search(result.page + 1)}>다음</button>
      </nav>}
    </div>}
    {searchUrl && <a className="place-external" href={searchUrl} target="_blank" rel="noopener noreferrer">카카오맵에서 검색 ↗</a>}
  </div>;
}
