'use client';

import { useEffect, useRef, useState } from 'react';
import { AppIcon } from './calendar-workspace';
import { recommendationProfiles, type RecommendationSnapshot } from '@/lib/preparation-recommendations';
import type { PreparationItem } from './preparation-editor';
import { AnniversaryPlan } from './anniversary-plan';

type Action = { action: 'adopt' | 'dismiss'; ruleId: string; timing?: string } | { action: 'profile'; profile: string } | { action: 'restore' };
type ApiResult = { snapshot?: RecommendationSnapshot; error?: string; outcome?: string; preparation?: { id: number; title: string; timing: string } };
export function PreparationRecommendations({ eventId, refreshKey, now, reminderOffsets, reminderBusy, onAdopt, onReminder, onFeedback, onCreate, preparations = [], onChecklist = () => {} }: {
  eventId?: number; refreshKey: string; now: number; reminderOffsets: number[]; reminderBusy: boolean;
  onAdopt: (item: Omit<PreparationItem, 'complete'>) => void;
  onReminder: (id: string, offset: number) => Promise<void>; onFeedback: (message: string) => void; onCreate: () => void;
  preparations?: Array<{id?:number;meta:string}>; onChecklist?: ()=>void;
}) {
  const [snapshot, setSnapshot] = useState<RecommendationSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [version, setVersion] = useState(0);
  const generation = useRef(0);
  const locked = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!eventId) return;
    const controller = new AbortController();
    const requests = generation;
    const request = ++requests.current;
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setError(null);
      void fetch(`/api/events/${eventId}/recommendations`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => { const body = await response.json() as ApiResult; if (!response.ok || !body.snapshot) throw new Error(body.error || '추천을 불러오지 못했어요.'); return body.snapshot; })
      .then((result) => { if (request === generation.current) setSnapshot(result); })
      .catch((failure) => { if (request === generation.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : '추천을 불러오지 못했어요.'); })
      .finally(() => { if (request === generation.current) setLoading(false); });
    });
    return () => { controller.abort(); requests.current++; };
  }, [eventId, refreshKey, version]);

  async function change(action: Action) {
    if (!eventId || !snapshot || locked.current || loading) return;
    locked.current = true;
    setBusy('ruleId' in action ? action.ruleId : action.action);
    setError(null);
    const request = ++generation.current;
    try {
      const response = await fetch(`/api/events/${eventId}/recommendations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...action, token: snapshot.token }) });
      const result = await response.json() as ApiResult;
      if (!response.ok) {
        if (alive.current && request === generation.current && result.snapshot) setSnapshot(result.snapshot);
        throw new Error(result.error || '저장 결과를 확인하지 못했어요. 다시 불러와 주세요.');
      }
      // The captured callback updates only the original event, even after navigation.
      if (result.preparation) onAdopt({ id: result.preparation.id, label: result.preparation.title, meta: result.preparation.timing, tone: 'later' });
      if (alive.current && request === generation.current && result.snapshot) setSnapshot(result.snapshot);
      onFeedback(action.action === 'adopt' ? result.outcome === 'existing' ? '이미 준비 목록에 있는 항목이에요.' : '준비 목록에 담았어요. 알림은 별도로 선택해 주세요.' : action.action === 'dismiss' ? '이 일정에서 추천을 숨겼어요.' : action.action === 'restore' ? '숨긴 추천을 다시 볼 수 있어요.' : '준비 목적에 맞춰 추천을 바꿨어요.');
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : '저장하지 못했어요. 다시 불러와 주세요.');
    } finally { locked.current = false; if (alive.current) setBusy(null); }
  }

  if (!eventId) return <section className="recommendations-panel" aria-label="맞춤 준비 추천"><h3>맞춤 준비 추천</h3><p className="recommendation-help">내 일정을 저장하면 제목·날짜·장소에 맞는 준비를 추천해요.</p><button type="button" className="text-button" onClick={onCreate}>내 일정 추가<AppIcon name="plus" size={16} /></button></section>;
  const items = snapshot?.items.filter((item) => item.state !== 'dismissed') ?? [];
  const hiddenCount = snapshot?.items.filter((item) => item.state === 'dismissed').length ?? 0;
  const available = items.filter((item) => item.state === 'available').length;
  const ordered = [...items].sort((a, b) => Number(a.state !== 'available') - Number(b.state !== 'available'));
  const formatDate = (value: string) => new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date(value));
  return <section className="recommendations-panel" aria-labelledby="recommendations-title" aria-busy={loading || !!busy}>
    <div className="recommendation-heading"><span className="recommendation-icon"><AppIcon name="leaf" size={21} /></span><div><h3 id="recommendations-title" tabIndex={-1}>맞춤 준비 추천</h3><p>필요한 준비만 골라 담으세요.</p></div><button type="button" className="text-button" disabled={loading || !!busy} onClick={() => setVersion((value) => value + 1)}>새로고침</button></div>
    <p className="recommendation-help">제목과 일정 정보를 활용한 규칙 기반 추천이에요. AI가 생성한 정보나 예약 가능 여부는 아니에요.</p>
    {loading && <p className="recommendation-status" role="status">일정에 맞는 준비를 확인하고 있어요…</p>}
    {error && <p className="editor-error" role="alert">{error}<button type="button" className="text-button" disabled={!!busy || loading} onClick={() => setVersion((value) => value + 1)}>다시 불러오기</button></p>}
    {snapshot && <>
      <label className="recommendation-profile">준비 목적<select value={snapshot.configuredProfile} disabled={!!busy || loading} onChange={(event) => void change({ action: 'profile', profile: event.target.value })}>{recommendationProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>
      <div className="recommendation-context"><strong>{snapshot.profileLabel}</strong><p>{snapshot.basis}</p><span>{snapshot.occurrenceDate.replaceAll('-', '. ')} 시작 회차 · 한국 시간</span></div>
      <p className="recommendation-help">{snapshot.recurring ? '준비 항목과 알림은 반복 일정 전체에, 완료 체크는 회차별로 적용돼요.' : '준비 목록에 담아도 완료 처리나 알림 발송은 되지 않아요.'}</p>
      <div className="recommendation-count"><span>추가할 수 있는 준비 {available}개</span>{hiddenCount > 0 && <button type="button" disabled={!!busy || loading} onClick={() => void change({ action: 'restore' })}>숨긴 추천 {hiddenCount}개 복원</button>}</div>
      {['birthday','anniversary','celebration'].includes(snapshot.profile) && <AnniversaryPlan items={snapshot.items} preparations={preparations} busy={!!busy||loading||!!error} onAdopt={(ruleId,timing)=>void change({action:'adopt',ruleId,timing})} onChecklist={onChecklist} />}
      {items.length === 0 && <p className="editor-empty">모든 추천을 숨겼어요. 위의 복원 버튼으로 다시 볼 수 있어요.</p>}
      <details className="recommendation-catalog" open={!['birthday','anniversary','celebration'].includes(snapshot.profile)}><summary>추천별 설명 · 알림 설정</summary>
      <div className="recommendation-list">{(expanded ? ordered : ordered.slice(0, 4)).map((item) => {
        const past = Date.parse(item.recommendedAt) <= now;
        const reminderAdded = reminderOffsets.includes(item.offsetMinutes);
        return <article key={item.id} className={`recommendation-card is-${item.state}`}>
          <div className="recommendation-card-top"><span>{item.priority}</span><span>{item.state === 'added' ? '준비 목록에 있음' : item.state === 'removed' ? '삭제한 준비' : past ? '지금 확인해 보세요' : item.timing}</span></div>
          <h4>{item.title}</h4><p>{item.reason}</p>
          <div className="recommendation-due">추천 준비 시점 · {formatDate(item.recommendedAt)}{past && <small>권장 시점은 지났지만 준비 목록에는 담을 수 있어요.</small>}</div>
          {item.state === 'removed' ? <p className="recommendation-help">이 추천으로 담았던 준비를 삭제했어요. 중복 기록을 막기 위해 자동으로 다시 담지 않아요.</p> : <div className="recommendation-actions"><button type="button" className="recommendation-adopt" disabled={item.state === 'added' || !!busy || loading || !!error} onClick={() => void change({ action: 'adopt', ruleId: item.id })}><AppIcon name={item.state === 'added' ? 'check' : 'plus'} size={16} />{busy === item.id ? '저장 중…' : item.state === 'added' ? '담아 둔 준비' : '준비 목록에 담기'}</button>{item.state === 'available' && <button type="button" aria-label={`${item.title} 추천 숨기기`} disabled={!!busy || loading || !!error} onClick={() => void change({ action: 'dismiss', ruleId: item.id })}>숨기기</button>}</div>}
          {item.state !== 'removed' && <div className="recommendation-reminder"><AppIcon name="bell" size={15} /><span>{reminderAdded ? `${item.timing} 알림 설정됨` : past ? '지난 추천 시점은 알림을 추가하지 않아요.' : '이 준비 시점을 잊지 않으려면'}</span>{!past && !reminderAdded && <button type="button" disabled={reminderBusy || !!busy || loading || !!error} onClick={() => { if (Date.parse(item.recommendedAt) <= Date.now()) { setVersion((value) => value + 1); return; } void onReminder(item.id, item.offsetMinutes); }}>알림 추가</button>}</div>}
        </article>;
      })}</div>
      {items.length > 4 && <button type="button" className="recommendation-expand" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? '간단히 보기' : `추천 ${items.length}개 모두 보기`}<AppIcon name={expanded ? 'left' : 'right'} size={16} /></button>}
      </details>
    </>}
  </section>;
}
