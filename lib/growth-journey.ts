import { growthLevel, LEVEL_THRESHOLDS, type CompletionKind, type ProgressSummary } from './progression';

/** Display-only milestones; all authoritative XP rules and saved records stay unchanged. */
export const GROWTH_CHAPTERS = [
  { name: '첫 페이지', title: '첫 장을 연 사람', description: '완벽한 계획보다 작은 약속 하나로 시작해요.', levels: ['빈칸의 가능성', '첫 계획', '작은 시작', '다시 한 번', '약속의 첫 장'] },
  { name: '작은 약속', title: '약속 지킴이', description: '하나씩 지킨 약속이 나만의 속도를 만들어요.', levels: ['하루 한 조각', '체크의 즐거움', '이어지는 약속', '나만의 속도', '약속 지킴이'] },
  { name: '하루의 리듬', title: '리듬 메이커', description: '작은 실천에서 편안한 리듬을 찾아요.', levels: ['리듬 찾기', '하루 조율', '작은 반복', '익숙한 실천', '리듬 메이커'] },
  { name: '준비의 여유', title: '준비의 달인', description: '미리 챙긴 준비가 하루에 여유를 더해요.', levels: ['미리 생각하기', '한발 앞의 준비', '빈틈 살피기', '여유 만들기', '준비의 달인'] },
  { name: '나만의 방식', title: '나만의 플래너', description: '남의 기준보다 나에게 맞는 계획을 찾아가요.', levels: ['우선순위 찾기', '내일 그리기', '나다운 계획', '균형 잡기', '나만의 플래너'] },
  { name: '꾸준함의 힘', title: '꾸준한 실천가', description: '쉬어 가도 괜찮아요. 다시 시작한 날도 소중해요.', levels: ['다시 시작하기', '조용한 꾸준함', '쌓이는 기록', '흔들려도 한 걸음', '꾸준한 실천가'] },
  { name: '계획과 실행', title: '실행 설계자', description: '생각을 행동으로 옮기는 감각을 쌓아요.', levels: ['생각을 행동으로', '작은 일 끝내기', '흐름 이어가기', '실행의 감각', '실행 설계자'] },
  { name: '하루의 설계', title: '하루의 설계자', description: '할 일과 쉴 틈을 함께 담는 하루를 그려 봐요.', levels: ['하루를 그리다', '여백을 남기다', '계획을 다듬다', '나에게 맞추다', '하루의 설계자'] },
  { name: '나답게 이어가기', title: '균형 있는 계획가', description: '계획이 달라져도 내 속도로 다시 이어 가요.', levels: ['무리하지 않는 계획', '유연한 실천', '다시 잡은 리듬', '오래가는 습관', '균형 있는 계획가'] },
  { name: 'J에게 도착', title: '나만의 J', description: '쌓아 온 기록으로 나만의 J를 향해 걸어가요.', levels: ['나를 믿는 계획', '일상의 동반자', '깊어진 실천', 'J에게 한 걸음', '나만의 J'] },
].map((chapter, index) => ({ ...chapter, index, startLevel: index * 5 + 1, endLevel: (index + 1) * 5, threshold: LEVEL_THRESHOLDS[(index + 1) * 5 - 1] }));

export const PRACTICE_BADGES = [
  { days: 1, name: '첫 발자국', description: '처음으로 실천한 날' },
  { days: 7, name: '일곱 번의 약속', description: '누적 7일 실천' },
  { days: 30, name: '서른 날의 기록', description: '누적 30일 실천' },
  { days: 100, name: '백일의 꾸준함', description: '누적 100일 실천' },
] as const;

export function growthJourney(totalXp: number) {
  const xp = Number.isFinite(totalXp) ? Math.max(0, Math.floor(totalXp)) : 0;
  const growth = growthLevel(xp);
  const chapter = GROWTH_CHAPTERS[Math.floor((growth.level - 1) / 5)];
  const nextMilestone = GROWTH_CHAPTERS.find((item) => item.endLevel > growth.level) ?? null;
  const earnedTitles = GROWTH_CHAPTERS.filter((item) => item.endLevel <= growth.level);
  return { ...growth, xp, chapter, levelName: chapter.levels[(growth.level - 1) % 5], nextMilestone, earnedTitles,
    milestoneRemaining: nextMilestone ? Math.max(0, nextMilestone.threshold - xp) : 0 };
}

export type GrowthFeedback = { heading: string; detail: string; level: number; stage: string; highlight: boolean };

/** Invoke only on a confirmed completion, never from a progress-refresh effect. */
export function growthCompletionFeedback(before: ProgressSummary | null, after: ProgressSummary, kind: CompletionKind, awardedXp: number): GrowthFeedback | null {
  if (!Number.isFinite(awardedXp) || awardedXp <= 0) return null;
  const current = growthJourney(after.totalXp);
  const previousLevel = before ? growthJourney(before.totalXp).level : current.level;
  const title = before ? current.earnedTitles.findLast((item) => item.endLevel > previousLevel) : undefined;
  const badge = before ? PRACTICE_BADGES.findLast((item) => before.activeDays < item.days && after.activeDays >= item.days) : undefined;
  const levelUp = current.level > previousLevel;
  const heading = title ? `새 칭호 · ${title.title}` : levelUp ? `레벨 업! Lv. ${current.level} ${current.levelName}` : badge ? `${badge.name} 배지를 얻었어요` : '작은 실천을 하나 더 쌓았어요';
  const goalReached = before && (before.day !== after.day || !before.goal.achieved) && after.goal.achieved;
  // awardedXp excludes the separate goal bonus. Never label this as the total reward.
  return { heading, level: current.level, stage: current.stage, highlight: !!title || levelUp || !!badge,
    detail: `${kind === 'event' ? '계획' : '준비'} 완료 +${awardedXp} XP${goalReached ? ' · 오늘 목표도 달성했어요.' : ' · 오늘의 실천을 기록했어요.'}` };
}
