'use client';

import { useState } from 'react';
import { GROWTH_CHAPTERS, PRACTICE_BADGES, growthJourney } from '@/lib/growth-journey';
import { LEVEL_THRESHOLDS } from '@/lib/progression';

export function GrowthCollection({ totalXp, activeDays }: { totalXp: number; activeDays: number }) {
  const [exploringChapter, setExploringChapter] = useState<number | null>(null);
  const journey = growthJourney(totalXp);
  const chapter = GROWTH_CHAPTERS[exploringChapter ?? journey.chapter.index];
  const earnedBadges = PRACTICE_BADGES.filter((badge) => activeDays >= badge.days);
  const nextBadge = PRACTICE_BADGES.find((badge) => activeDays < badge.days);

  return <>
    <details className="growth-journey">
      <summary><span>50레벨 성장 여정<small>앞으로 만날 레벨과 칭호를 살펴보세요.</small></span><span>칭호 {journey.earnedTitles.length}/10</span></summary>
      <div className="growth-chapter-picker" aria-label="살펴볼 성장 챕터">{GROWTH_CHAPTERS.map((item) => <button type="button" key={item.index} aria-pressed={chapter.index === item.index} aria-controls="growth-chapter-detail" className={journey.level >= item.endLevel ? 'is-earned' : journey.chapter.index === item.index ? 'is-current' : ''} onClick={() => setExploringChapter(item.index)}>
        <span className="growth-chapter-number">{String(item.index + 1).padStart(2,'0')}</span><strong>{item.name}</strong><small>Lv. {item.startLevel}–{item.endLevel}</small><span className="growth-chapter-state">{journey.level >= item.endLevel ? '칭호 획득 ✓' : journey.chapter.index === item.index ? '지금 여기' : '미리 보기'}</span>
      </button>)}</div>
      <section id="growth-chapter-detail" className="growth-chapter-detail" aria-label={`${chapter.name} 세부 레벨`}>
        <div className="growth-chapter-heading"><div><span>CHAPTER {String(chapter.index + 1).padStart(2,'0')}</span><h3>{chapter.name}</h3></div>{exploringChapter !== null && <button type="button" className="text-button" onClick={() => setExploringChapter(null)}>내 위치로</button>}</div>
        <p>{chapter.description}</p>
        <ol className="growth-level-list">{chapter.levels.map((name, i) => {
          const level = chapter.startLevel + i;
          const reached = journey.level >= level;
          return <li key={level} aria-current={journey.level === level ? 'step' : undefined} className={reached ? 'is-reached' : ''}>
            <span className="growth-level-number">{level}</span><span><strong>{name}</strong><small>누적 {LEVEL_THRESHOLDS[level - 1].toLocaleString()} XP{level === chapter.endLevel ? ' · 칭호 획득' : ''}</small></span><span>{journey.level === level ? '현재' : reached ? '도달 ✓' : '미도달'}</span>
          </li>;
        })}</ol>
        <p className="growth-chapter-prize">Lv. {chapter.endLevel} 칭호 · <strong>{chapter.title}</strong><span>{journey.level >= chapter.endLevel ? '획득했어요' : '도달하면 획득 · 추가 XP 보상은 없어요'}</span></p>
      </section>
    </details>
    <section className="growth-practice" aria-labelledby="practice-badges-title">
      <div className="growth-practice-heading"><h3 id="practice-badges-title">실천일 배지</h3><span>{earnedBadges.length} / {PRACTICE_BADGES.length}개</span></div>
      <p>누적 {activeDays}일 실천 · 연속으로 하지 않아도 괜찮아요.</p>
      <div className="practice-badge-grid">{PRACTICE_BADGES.map((badge) => <article key={badge.days} className={activeDays >= badge.days ? 'is-earned' : ''}>
        <span className="practice-badge-number" aria-hidden="true">{badge.days}<small>DAY{badge.days > 1 ? 'S' : ''}</small></span><strong>{badge.name}</strong><span>{badge.description}</span><small>{activeDays >= badge.days ? '획득 ✓' : `${badge.days - activeDays}일 더 실천하면 획득`}</small>
      </article>)}</div>
      <p className="growth-next-practice">{nextBadge ? `다음 배지 ‘${nextBadge.name}’까지 ${nextBadge.days - activeDays}일 남았어요.` : '실천일 배지를 모두 모았어요. 쌓아 온 기록은 계속 남아요.'}</p>
    </section>
  </>;
}
