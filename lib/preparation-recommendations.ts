import { getSeoulDate } from './recurrence';
import { daysBetween, relevantOccurrenceDate, reminderTime, type EventDuration } from './event-duration';

export const recommendationProfiles = [
  { id: 'auto', label: '일정에 맞게 자동 선택' },
  { id: 'birthday', label: '생일·생신' },
  { id: 'anniversary', label: '결혼·연애 기념일' },
  { id: 'celebration', label: '기타 기념일' },
  { id: 'wedding', label: '결혼식 참석' },
  { id: 'event', label: '행사·공연' },
  { id: 'travel', label: '여행' },
  { id: 'meeting', label: '회의·미팅' },
  { id: 'deadline', label: '마감·제출' },
  { id: 'outing', label: '야외 활동' },
  { id: 'general', label: '일반 일정' },
] as const;
export type RecommendationProfile = typeof recommendationProfiles[number]['id'];
type ConcreteProfile = Exclude<RecommendationProfile, 'auto'>;
export type RecommendationEvent = EventDuration & { title: string; category: string; location: string; hasTravelPlan: boolean };
export type RecommendationRule = { id: string; title: string; reason: string; offsetMinutes: number; priority: '먼저 준비' | '확인할 일'; aliases: string[] };
export type Recommendation = RecommendationRule & { recommendedAt: string; timing: string; timingState: 'now' | 'upcoming' | 'passed'; preparationId: number | null; state: 'available' | 'added' | 'dismissed' | 'removed' };
export type RecommendationSnapshot = {
  token: string; configuredProfile: RecommendationProfile; profile: ConcreteProfile; profileLabel: string; basis: string;
  occurrenceDate: string; generatedAt: string; recurring: boolean; items: Recommendation[]; enabled: boolean;
};
export function isRecommendationProfile(value: unknown): value is RecommendationProfile {
  return recommendationProfiles.some((profile) => profile.id === value);
}
/** Preserve identities when a seeded/manual equivalent is deleted, even after a profile change. */
export function recommendationKeysForTitle(title: string) {
  const value = normalizePreparationTitle(title);
  const extras = [
    { id: 'location-route', title: '저장한 동선과 이동수단 확인하기', aliases: ['이동 경로와 출발 시간 확인하기', '장소와 이동 계획 정하기', '출발 시간 확인하기'] },
    // Retired suggestion: keep identity matching for existing user records only.
    { id: 'location-weather', title: '장소의 최신 날씨 확인하기', aliases: ['출발 전 날씨 확인하기'] },
    { id: 'duration-items', title: '여러 날 사용할 물품과 일정 확인하기', aliases: [] },
  ];
  return [...new Set([...Object.values(catalog).flat(), ...extras].filter((item) => [item.title, ...item.aliases].some((name) => normalizePreparationTitle(name) === value)).map((item) => item.id))];
}
const rule = (id: string, title: string, reason: string, days: number, aliases: string[] = [], priority: RecommendationRule['priority'] = '먼저 준비'): RecommendationRule =>
  ({ id, title, reason, offsetMinutes: Math.round(days * 1440), aliases, priority });
const gift = rule('celebration-gift', '축하 방법이나 선물 정하기', '예산과 상대의 취향을 먼저 생각하고, 필요하다면 배송 일정을 확인해요.', 14, ['선물이나 축하 방법 정하기', '선물 아이디어 살펴보기']);
const message = rule('celebration-message', '마음을 전할 메시지 준비하기', '기억에 남는 순간이나 전하고 싶은 말을 짧게 적어 보세요.', 1, ['전할 메시지 미리 적어두기', '축하 메시지 보내기']);
const reservations = rule('celebration-booking', '식사·케이크 예약 확인하기', '함께할 사람과 시간을 정한 뒤 필요한 예약이 있는지 확인해요.', 7, ['예약과 필요한 준비 확인하기', '저녁 식사 장소 정하기']);
const catalog: Record<ConcreteProfile, RecommendationRule[]> = {
  birthday: [gift, reservations, message, rule('birthday-date', '생일 날짜와 축하 시간 확인하기', '양력·음력 여부와 상대가 편한 시간을 직접 확인해요. 날짜 변환은 자동으로 하지 않아요.', 21)],
  anniversary: [rule('anniversary-plan', '함께 보내고 싶은 하루 정하기', '두 사람의 일정과 원하는 분위기를 먼저 맞춰 보세요.', 21), gift, reservations, message],
  celebration: [gift, reservations, message],
  wedding: [rule('wedding-invitation', '청첩장과 예식 정보 확인하기', '예식 날짜·시각·홀 이름과 참석 안내를 확인해요.', 7, ['참석 여부 확인하기']), rule('wedding-gift', '축하할 마음과 필요한 물품 준비하기', '축하 방식은 본인의 상황에 맞게 정하고, 필요한 물품을 챙겨요.', 3), rule('wedding-outfit', '예식에 맞는 복장 준비하기', '예식 장소와 안내에 맞는 옷과 신발을 미리 준비해요.', 2, ['복장과 준비물 챙기기'])],
  event: [rule('event-rsvp', '참석 여부와 행사 안내 확인하기', '주최자가 안내한 입장 시각·장소·변경 사항을 확인해요.', 7, ['참석 여부 확인하기', '참석 여부와 안내 다시 확인하기']), rule('event-ticket', '입장권과 예약 내역 준비하기', '입장권이 필요한 행사라면 예약 내역과 확인 방법을 준비해요.', 1), rule('event-items', '필요한 준비물 챙기기', '행사 안내를 기준으로 필요한 물품과 복장을 확인해요.', 3, ['복장과 준비물 챙기기'])],
  travel: [rule('travel-bookings', '예약 내역 확인하기', '교통·숙소 예약 날짜와 이용 시간을 서로 비교해 보세요.', 14, ['예약 내역 한 번에 확인하기']), rule('travel-packing', '여행 일정에 맞춰 짐 싸기', '여행 기간과 예정한 활동에 맞춰 필요한 옷과 물품을 준비해요.', 3, ['날씨에 맞춰 짐 싸기']), rule('travel-checkin', '체크인과 출발 시간 확인하기', '예약처가 안내한 수속·체크인 시간과 이동 시간을 확인해요.', 1, ['체크인과 출발 동선 확인하기']), rule('travel-documents', '필요한 신분증과 여행 서류 확인하기', '여행지와 이용할 교통수단의 공식 안내에서 필요한 서류를 확인해요.', 21)],
  meeting: [rule('meeting-agenda', '회의 안건과 목표 정리하기', '이번 만남에서 결정하거나 확인할 내용을 먼저 적어 보세요.', 2), rule('meeting-materials', '공유할 자료와 질문 준비하기', '관련 자료를 모으고 참석자에게 확인할 질문을 정리해요.', 1, ['필요한 자료 먼저 모으기']), rule('meeting-connection', '참석자와 접속·방문 방법 확인하기', '온라인이면 접속 링크를, 대면이면 장소와 방문 안내를 확인해요.', .125, ['장소와 참여자 다시 확인하기'])],
  deadline: [rule('deadline-requirements', '제출 기준과 마감 시각 확인하기', '안내된 형식·제출 경로·마감 시각을 원문에서 확인해요.', 7), rule('deadline-draft', '초안과 필요한 자료 준비하기', '빠진 자료를 찾을 시간을 남겨 두고 초안을 완성해요.', 3, ['필요한 자료 먼저 모으기']), rule('deadline-review', '최종 내용과 첨부파일 검토하기', '파일명·버전·첨부 누락을 확인하고 여유 있게 제출해요.', 1), rule('deadline-receipt', '제출 완료 여부 확인하기', '실제로 제출한 뒤 접수 화면이나 확인 메일을 확인해요.', 0, [], '확인할 일')],
  outing: [rule('outing-equipment', '활동에 필요한 장비와 물품 준비하기', '예정한 활동과 장소에 맞춰 준비물을 확인해요.', 2), rule('outing-plan', '활동이 어려울 때의 대안 정하기', '예정한 활동이 어려워질 때 이용할 다른 장소나 일정 변경 방법을 생각해요.', 1, ['날씨가 바뀔 때의 대안 정하기'])],
  general: [rule('general-materials', '필요한 자료 먼저 모으기', '이 일정에 필요한 문서나 물품을 미리 모아 두세요.', 3, ['필요한 준비 확인하기']), rule('general-details', '시간과 참여자 다시 확인하기', '함께하는 사람과 약속한 시간·방법이 맞는지 확인해요.', 1, ['장소와 참여자 다시 확인하기']), rule('general-final', '마지막 준비 확인하기', '시작 전에 준비한 내용과 빠진 것이 없는지 살펴보세요.', 1 / 12)],
};

export function inferRecommendationProfile(event: RecommendationEvent, configured: RecommendationProfile) {
  if (configured !== 'auto') return { profile: configured, basis: '직접 선택한 준비 목적을 기준으로 추천해요.' };
  const title = event.title.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '');
  let profile: ConcreteProfile | null = null;
  // Anniversary takes precedence over the wedding-attendance pattern.
  if (/결혼기념|연애|사귄|사귄지|주년|백일|100일/.test(title)) profile = 'anniversary';
  else if (/생일|생신|birthday/.test(title)) profile = 'birthday';
  else if (/결혼식|예식|wedding/.test(title)) profile = 'wedding';
  else if (/회의|미팅|면담|meeting/.test(title)) profile = 'meeting';
  else if (/마감|제출|접수|deadline/.test(title)) profile = 'deadline';
  else if (/등산|캠핑|피크닉|야외|하이킹/.test(title)) profile = 'outing';
  else if (/여행|휴가|trip|travel/.test(title)) profile = 'travel';
  const fromTitle = !!profile;
  profile ??= event.category === '여행' ? 'travel' : event.category === '행사' ? 'event' : ['기념일', '생일', '결혼기념일'].includes(event.category) ? 'celebration' : 'general';
  return { profile, basis: fromTitle ? '일정 제목에서 준비 목적을 추정했어요. 다르면 직접 바꿀 수 있어요.' : '일정 종류를 기준으로 추천해요. 준비 목적을 고르면 더 구체적으로 볼 수 있어요.' };
}

export function recommendationTiming(offset: number) {
  return offset === 0 ? '시작 시각' : offset % 1440 === 0 ? `${offset / 1440}일 전` : offset % 60 === 0 ? `${offset / 60}시간 전` : `${offset}분 전`;
}

export function buildRecommendations(event: RecommendationEvent, configured: RecommendationProfile, now = new Date()) {
  const inferred = inferRecommendationProfile(event, configured);
  const date = relevantOccurrenceDate(event, getSeoulDate(now), now);
  const candidates = [...catalog[inferred.profile]];
  if (event.location.trim()) {
    candidates.push(event.hasTravelPlan
      ? rule('location-route', '저장한 동선과 이동수단 확인하기', '출발지와 이동 계획이 있어요. 지도에서 최신 경로를 조회하고 여유 시간을 더해요.', .125, ['이동 경로와 출발 시간 확인하기', '장소와 이동 계획 정하기', '출발 시간 확인하기'])
      : rule('location-route', '이동 경로와 출발 시간 확인하기', '저장한 장소까지 어떻게 이동할지 확인해요. 이동수단에 맞는 경로를 직접 선택할 수 있어요.', .125, ['장소와 이동 계획 정하기', '출발 시간 확인하기']));
  }
  if (event.endDate && daysBetween(event.eventDate, event.endDate) > 0) candidates.push(rule('duration-items', '여러 날 사용할 물품과 일정 확인하기', '종료 날짜가 있는 일정이에요. 머무는 기간에 필요한 물품과 중간 일정을 확인해요.', 2));
  const anchor = Date.parse(`${date}T${reminderTime(event)}:00+09:00`);
  return { ...inferred, profileLabel: recommendationProfiles.find((p) => p.id === inferred.profile)!.label, occurrenceDate: date,
    items: candidates.map((item) => {
      const due = anchor - item.offsetMinutes * 60000;
      const timingState = due < now.getTime() ? 'passed' as const : due - now.getTime() <= 86400000 ? 'now' as const : 'upcoming' as const;
      return { ...item, recommendedAt: new Date(due).toISOString(), timing: recommendationTiming(item.offsetMinutes), timingState };
    }).sort((a, b) => {
      const rank = { passed: 0, now: 1, upcoming: 2 };
      return rank[a.timingState] - rank[b.timingState] || a.recommendedAt.localeCompare(b.recommendedAt);
    }) };
}

export function normalizePreparationTitle(title: string) { return title.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase(); }
