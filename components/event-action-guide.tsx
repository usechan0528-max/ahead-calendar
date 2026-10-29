'use client';

import type { OccurrenceCompletion } from '@/lib/progression';
import { AppIcon } from './calendar-workspace';

export function EventActionGuide({ isSample, hasOccurrence, occurrence, preparationsEnabled, preparationCount, completedPreparationCount, busy, error, next, onPrepare, onComplete, onToday, onNext, onCreate, onRetry }: {
  isSample: boolean; hasOccurrence: boolean; occurrence: OccurrenceCompletion | null;
  preparationsEnabled: boolean; preparationCount: number; completedPreparationCount: number;
  busy: boolean; error: string | null; next: { title: string; range: string } | null;
  onPrepare: () => void; onComplete: (complete: boolean) => void; onToday: () => void;
  onNext: () => void; onCreate: () => void; onRetry: () => void;
}) {
  const remaining = Math.max(0, preparationCount - completedPreparationCount);
  const done = !isSample && hasOccurrence && !!occurrence?.complete;
  const ready = !isSample && hasOccurrence && !!occurrence?.canCompleteEvent;
  const title = isSample ? '내 일정으로 시작해 보세요' : !hasOccurrence ? '선택할 회차가 없어요' : error ? '완료 기록을 다시 확인해 주세요' : !occurrence ? '완료 기록을 확인하고 있어요' : done ? '이 회차를 완료했어요' : ready ? '실천했다면 완료로 기록해요' : '일정 시작 전이에요';

  return <section id="event-action-guide" className={`event-action-guide${done ? ' is-complete' : ''}`} tabIndex={-1} aria-labelledby="event-action-title" aria-busy={busy}>
    <p className="event-action-label"><AppIcon name={done ? 'check' : 'leaf'} size={17} />{done ? '실천 기록' : '지금 할 수 있는 일'}</p>
    <h3 id="event-action-title">{title}</h3>
    {isSample ? <><p>예시는 경험치를 주지 않아요. 내 일정을 추가하면 준비와 완료 기록이 저장돼요.</p><button type="button" className="primary-button" onClick={onCreate}>내 일정 만들기<AppIcon name="plus" size={17} /></button></>
      : !hasOccurrence ? <><p>지난 기록은 유지돼요. 아래에서 반복 종료일과 변경·취소 내역을 확인할 수 있어요.</p><button type="button" className="text-button" onClick={onToday}>오늘로 돌아가기<AppIcon name="arrow" size={17} /></button></>
      : error ? <><p role="alert">{error}</p><div className="event-action-buttons"><button type="button" className="primary-button" disabled={busy} onClick={onRetry}>다시 불러오기</button><button type="button" className="text-button" onClick={onToday}>오늘로 돌아가기</button></div></>
      : !occurrence ? <p role="status">잠시만 기다려 주세요. 확인이 끝나면 가능한 행동을 안내할게요.</p>
      : done ? <>
        <p>완료 기록을 저장했어요. 오늘의 다른 계획도 확인해 보세요.</p>
        <div className="event-action-buttons"><button type="button" className="primary-button" onClick={onToday}>오늘로 돌아가기<AppIcon name="arrow" size={17} /></button>
          {next && <button type="button" className="text-button" onClick={onNext}>다음 일정 보기<AppIcon name="right" size={17} /></button>}</div>
        {next && <p className="event-action-next"><span>진행 중 · 다가오는 일정</span><strong>{next.title}</strong><span>{next.range}</span></p>}
        <details className="event-action-undo"><summary>잘못 체크했나요?</summary><p>체크를 취소해도 획득한 경험치는 유지돼요. 다시 완료해도 중복 지급되지 않아요.</p><button type="button" className="text-button" disabled={busy} onClick={() => onComplete(false)}>{busy ? '기록 중…' : '완료 체크 취소'}</button></details>
      </> : <>
        <p>{ready ? '실제로 마친 계획만 체크해 주세요.' : '일정 시작 시각부터 완료할 수 있어요.'}</p>
        {preparationsEnabled && <p className="event-action-preparations">{preparationCount === 0 ? '필요한 준비만 골라 담거나 직접 추가할 수 있어요.' : remaining ? `담은 준비 ${preparationCount}개 중 ${remaining}개가 남았어요.` : `담은 준비 ${preparationCount}개를 모두 마쳤어요.`}{ready && preparationCount > 0 && remaining > 0 ? ' 준비가 남아 있어도 계획은 완료할 수 있어요.' : ''}</p>}
        <div className="event-action-buttons">
          {ready && <button type="button" className="primary-button" disabled={busy} onClick={() => onComplete(true)}><AppIcon name="check" size={17} />{busy ? '기록 중…' : '이 계획 완료하기'}</button>}
          {preparationsEnabled && <button type="button" className={ready ? 'text-button' : 'primary-button'} disabled={busy} onClick={onPrepare}>{preparationCount === 0 ? '준비 항목 고르기' : remaining && occurrence.canCompletePreparation ? '준비 이어하기' : '준비 확인하기'}<AppIcon name="right" size={17} /></button>}
          {!ready && <button type="button" className="text-button" onClick={onToday}>오늘로 돌아가기<AppIcon name="arrow" size={17} /></button>}
        </div>
      </>}
  </section>;
}
