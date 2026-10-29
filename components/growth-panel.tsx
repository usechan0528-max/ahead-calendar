'use client';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { DAILY_XP_CAP, FINAL_XP, MAX_LEVEL, XP_REWARDS, type ProgressSummary } from '@/lib/progression';
import { growthJourney } from '@/lib/growth-journey';
import { GrowthCollection } from './growth-collection';
import { AppIcon } from './calendar-workspace';

type GrowthProps = {
  progress: ProgressSummary | null; error: string | null; busy: boolean;
  onGoal: (target: number) => Promise<void>; onRetry: () => void;
};

export function GrowthPanel({ progress, error, busy, onGoal, onRetry }: GrowthProps) {
  const record = useRef<HTMLElement>(null);
  useEffect(() => {
    if (window.location.hash !== '#growth-record') return;
    const frame = requestAnimationFrame(() => {
      // The section survives loading -> ready; a temporary child link does not.
      record.current?.focus({ preventScroll: true }); record.current?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  if (!progress) return <section ref={record} id="growth-record" tabIndex={-1} className="growth-panel growth-loading" aria-label="나의 성장"><p role={error ? 'alert' : 'status'}>{error ?? '나의 실천 기록을 불러오는 중이에요…'}</p>{error && <button type="button" className="text-button" onClick={onRetry}>다시 시도</button>}<Link href="/growth" className="growth-detail-link">성장 상세<AppIcon name="right" size={16} /></Link></section>;
  const growth = growthJourney(progress.totalXp);
  const final = growth.level === MAX_LEVEL;
  return <section ref={record} id="growth-record" tabIndex={-1} className="growth-panel growth-compact" aria-labelledby="growth-summary-title">
    <div className="growth-compact-heading"><h2 id="growth-summary-title">나의 성장</h2><Link href="/growth" className="growth-detail-link">성장 상세<AppIcon name="right" size={16} /></Link></div>
    <div className="growth-main">
      <div className="growth-stage" aria-label={`${growth.stage} 단계`}>{growth.stage}<small>Lv. {growth.level}</small></div>
      <div className="growth-summary"><h3>{growth.levelName}</h3><div className="growth-meter"><progress max={1} value={growth.progress} aria-label={final ? '최종 레벨 도달' : `레벨 ${growth.level + 1}까지 ${growth.remaining} XP`} /><span>{final ? '50레벨 여정 완주' : `다음 레벨까지 ${growth.remaining.toLocaleString()} XP`}</span></div></div>
    </div>
    <div className="growth-today">
      <strong>오늘의 목표</strong>
      <label className="daily-goal-label"><span className="sr-only">오늘 완료할 계획 수</span><select aria-label="오늘 완료할 계획 수" aria-describedby={progress.goal.locked ? 'growth-goal-locked' : undefined} value={progress.goal.target} disabled={busy || progress.goal.locked} onChange={(event) => void onGoal(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}개</option>)}</select></label>
      <div className="growth-goal-status"><div className="growth-goal-steps" role="img" aria-label={`목표 ${progress.goal.target}개 중 ${Math.min(progress.goal.count, progress.goal.target)}개 달성`}>{Array.from({ length: progress.goal.target }, (_, i) => <span key={i} className={i < progress.goal.count ? 'is-done' : ''} aria-hidden="true">{i < progress.goal.count ? <AppIcon name="check" size={16} /> : i + 1}</span>)}</div><span>{progress.goal.achieved ? '목표 달성 ✓' : `${progress.goal.count} / ${progress.goal.target}개 완료`}</span></div>
      {progress.goal.locked && <Link id="growth-goal-locked" className="growth-lock-hint" href="/growth#daily-goal-guide">첫 완료 후 고정<AppIcon name="right" size={14} /></Link>}
      <p className="growth-daily-xp">오늘 {progress.todayXp} / {DAILY_XP_CAP} XP{progress.todayXp >= DAILY_XP_CAP && <span>오늘 XP 달성</span>}</p>
    </div>
    {error && <p role="alert" className="growth-error">{error} <button type="button" className="text-button" onClick={onRetry}>다시 불러오기</button></p>}
  </section>;
}

export function GrowthDetails({ progress, error, busy, onGoal, onRetry }: GrowthProps) {
  if (!progress) return <section id="growth-record" tabIndex={-1} className="growth-panel growth-loading" aria-label="나의 성장"><p role={error ? 'alert' : 'status'}>{error ?? '나의 실천 기록을 불러오는 중이에요…'}</p>{error && <button type="button" className="text-button" onClick={onRetry}>다시 시도</button>}</section>;
  const growth = growthJourney(progress.totalXp);
  const latestTitle = growth.earnedTitles.at(-1);
  const final = growth.level === MAX_LEVEL;
  return <section id="growth-record" tabIndex={-1} className="growth-panel growth-passport" aria-label="나의 성장">
    <div className="growth-passport-cover">
    <div className="growth-cover-top"><span>TO J · 나의 성장 기록</span><span>CHAPTER {String(growth.chapter.index + 1).padStart(2, '0')} / 10</span></div>
    <div className="growth-main">
      <div className="growth-stage" aria-label={`${growth.stage} 단계`}>{growth.stage}<small>Lv. {growth.level}</small></div>
      <div className="growth-summary"><p className="growth-eyebrow">{growth.chapter.name}</p><h2>{growth.levelName}</h2>
        <p className="growth-story">{final ? '나만의 J에 도착했어요. 이후의 실천과 경험치도 계속 기록돼요.' : growth.chapter.description}</p>
        <div className="growth-meter"><progress max={1} value={growth.progress} aria-label={final ? '최종 레벨 도달' : `레벨 ${growth.level + 1}까지 ${growth.remaining} XP`} /><span>{final ? '50레벨 여정 완주' : `Lv. ${growth.level + 1}까지 ${growth.remaining.toLocaleString()} XP`}</span></div>
        <p className="growth-total">누적 {progress.totalXp.toLocaleString()} XP · J 도착 {FINAL_XP.toLocaleString()} XP</p>
      </div>
    </div>
    <div className="growth-current-title"><AppIcon name="check" size={16} /><span>{latestTitle ? `획득한 칭호 · ${latestTitle.title}` : '첫 칭호를 향해 출발했어요'}</span><span>{growth.earnedTitles.length} / 10</span></div>
    </div>
    <div className="growth-next-reward"><span className="growth-reward-marker" aria-hidden="true">{growth.nextMilestone ? String(growth.nextMilestone.index + 1).padStart(2, '0') : 'J'}</span><div><p>{growth.nextMilestone ? '다음에 얻을 칭호' : '모든 성장 칭호를 모았어요'}</p><strong>{growth.nextMilestone?.title ?? '나만의 J'}</strong><span>{growth.nextMilestone ? `Lv. ${growth.nextMilestone.endLevel} · ${growth.milestoneRemaining.toLocaleString()} XP 남았어요` : '레벨은 50으로 유지되고 실천 기록은 계속 쌓여요.'}</span></div></div>
    <div className="growth-today"><div><strong>오늘의 작은 목표</strong><p>오늘 처음 완료한 계획 <b>{progress.goal.count}</b> / {progress.goal.target}개</p></div>
      <label className="daily-goal-label">오늘 목표<select aria-label="오늘 완료할 계획 수" value={progress.goal.target} disabled={busy || progress.goal.locked} onChange={(event) => void onGoal(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}개</option>)}</select></label>
      <div className="growth-goal-steps" role="img" aria-label={`목표 ${progress.goal.target}개 중 ${Math.min(progress.goal.count, progress.goal.target)}개 달성`}>{Array.from({length:progress.goal.target}, (_, i) => <span key={i} className={i < progress.goal.count ? 'is-done' : ''} aria-hidden="true">{i < progress.goal.count ? <AppIcon name="check" size={16} /> : i + 1}</span>)}</div>
      <span className={`goal-state ${progress.goal.achieved ? 'is-achieved' : ''}`}>{progress.goal.achieved ? '오늘의 약속 달성 ✓' : `${Math.max(0, progress.goal.target - progress.goal.count)}개 더 실천하면 목표 달성`}</span>
      <p className="growth-daily-xp">오늘 {progress.todayXp} / {DAILY_XP_CAP} XP <span>{progress.todayXp >= DAILY_XP_CAP ? '경험치를 모두 모았어요. 이후 실천도 기록돼요.' : `목표 보너스 최대 ${XP_REWARDS.goal} XP · 하루 상한 내 지급`}</span></p>
      <p id="daily-goal-guide" tabIndex={-1} className="growth-goal-note">{progress.goal.locked ? '오늘 첫 계획을 완료해 목표가 고정됐어요. 체크를 취소해도 처음 실천한 기록은 남아요.' : '오늘 지킬 수 있는 만큼 정하세요. 첫 계획 완료 뒤에는 오늘 목표가 고정돼요.'}</p>
    </div>
    <GrowthCollection totalXp={progress.totalXp} activeDays={progress.activeDays} />
    <details className="growth-rules"><summary>경험치는 어떻게 쌓이나요?</summary>
      <div className="growth-reward-rules"><span>계획 첫 완료 <b>+{XP_REWARDS.event} XP</b></span><span>준비 첫 완료 <b>+{XP_REWARDS.preparation} XP</b></span><span>오늘 목표 달성 <b>+{XP_REWARDS.goal} XP</b></span></div>
      <p>보너스를 포함해 한국 시간 기준 하루 최대 {DAILY_XP_CAP} XP예요. 남은 한도만큼만 지급될 수 있어요. 칭호와 배지는 추가 경험치를 주지 않아요.</p>
      <p>완료 취소는 체크 상태만 되돌려요. 이미 얻은 경험치는 유지되며 같은 회차를 다시 완료해도 추가 지급되지 않아요. 상한에 도달해 0 XP로 기록된 완료도 다시 지급되지 않아요.</p>
      <p>총 50레벨, P · P+ · PJ · J− · J로 성장해요. 하루 40 XP면 약 300일, 최대 속도라도 200일이 필요해요. 쉬는 날 감점은 없어요.</p>
      <p>실천일은 계획이나 준비를 처음 완료한 한국 날짜의 누적 기록이에요. 칭호는 경험치로 얻는 성장 표현이며 특정 행동을 검증한 자격이 아니에요. MBTI 유형의 우열이 아닌 나만의 계획 습관을 표현해요.</p>
    </details>
    {error && <p role="alert" className="growth-error">{error} <button type="button" onClick={onRetry}>다시 불러오기</button></p>}
  </section>;
}
