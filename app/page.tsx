'use client';

import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { getSeoulDate, nextOccurrenceDate } from '@/lib/recurrence';
import { AppIcon, CalendarWorkspace } from '@/components/calendar-workspace';
import { calendarDateLabel } from '@/lib/calendar-view';
import { savedCalendarDate } from '@/lib/calendar-reveal';
import { INITIAL_REMINDER_PREFERENCE_KEY, matchReminderPreset, parseInitialReminderChoice, readInitialReminderPreference, type InitialReminderChoice, type ReminderRule } from '@/lib/reminder-settings';
import { InitialReminderField } from '@/components/initial-reminder-field';
import { PreparationEditor } from '@/components/preparation-editor';
import { PreparationRecommendations } from '@/components/preparation-recommendations';
import { PreparationField, PreparationPreference } from '@/components/preparation-preference';
import { ReminderRuleList } from '@/components/reminder-rule-list';
import { EventTimeFields } from '@/components/event-time-fields';
import { EventEditorDialog } from '@/components/event-editor-dialog';
import { EditorSection } from '@/components/editor-section';
import { SavedEventGuide } from '@/components/saved-event-guide';
import { EventActionGuide } from '@/components/event-action-guide';
import { DailyReview } from '@/components/daily-review';
import { ResumeCard } from '@/components/resume-card';
import { SnoozeControls } from '@/components/snooze-controls';
import { RESUME_KEY, readResumeBookmark, notificationDestination, type DetailDestination, type ResumeBookmark, type SnoozeMinutes } from '@/lib/user-journey';
import { getCategoryTheme } from '@/lib/design-tokens';
import { MAX_CATEGORY_LENGTH, parseEventCategory } from '@/lib/event-category';
import { EventCategoryField } from '@/components/event-category-field';
import { useCategoryColors } from '@/components/use-category-colors';
import { growthJourney, growthCompletionFeedback, type GrowthFeedback as GrowthFeedbackNotice } from '@/lib/growth-journey';
import { GrowthFeedback } from '@/components/growth-feedback';
import { PreparationBand, UpcomingStrip, WorkspaceOverview, nextActionRow, workspaceNavigation, type WorkspaceView } from '@/components/workspace-overview';
import { GrowthPanel } from '@/components/growth-panel';
import { useGrowth } from '@/components/use-growth';
import { EventLocationFields } from '@/components/event-location-fields';
import { EventPlace } from '@/components/event-place';
import type { KakaoPlace } from '@/lib/kakao-place';
import { parseTravelPlan, type TravelPlan } from '@/lib/travel-plan';
import { daysBetween, formatEventRange, occurrenceDayStatus, relevantOccurrenceDate, reminderTime } from '@/lib/event-duration';
import { relevantResolvedOccurrence, resolveOccurrence, type OccurrenceChanges, type OccurrenceOverride } from '@/lib/occurrences';
import { OccurrenceEditor } from '@/components/occurrence-editor';
import { NotificationDiagnostics } from '@/components/notification-diagnostics';
import { useNotificationDiagnostics } from '@/components/use-notification-diagnostics';
import { browserPlatform, notificationDiagnosis, withPushTimeout } from '@/lib/notification-diagnostics';
import { MobileNavigation } from '@/components/mobile-navigation';
import { useMobileViewport } from '@/components/use-mobile-viewport';
import { useConnectionStatus } from '@/components/use-connection-status';
import { useAccountProfile } from '@/components/use-account-profile';
import { eventPayloadHash } from '@/lib/event-save';
import { parseEventInput } from '@/lib/event-input';
import { parseInitialReminderOffsets } from '@/lib/reminder-settings';
import { EventDraftStorage } from '@/components/event-draft-storage';
import { captureDraftValues, draftInitial, eventDraftKey, loadLatestEventDraft, writeEventDraft, type CreationAttempt, type DraftValues, type EventDraft } from '@/lib/event-draft-storage';

type ScheduleItem = {
  id: number;
  storageId?: number;
  eventDate: string;
  eventTime: string;
  allDay?: boolean;
  allDayReminderTime?: string;
  endDate?: string | null;
  endTime?: string | null;
  title: string;
  eyebrow: string;
  date: string;
  day: string;
  time: string;
  category: string;
  accent: string;
  text?: string;
  soft: string;
  dday: string;
  note: string;
  isSample?: boolean;
  location?: string;
  place?: KakaoPlace | null;
  travelPlan?: TravelPlan | null;
  recurrence: EventRecurrence;
  recurrenceInterval: number;
  recurrenceDay: number | null;
  recurrenceUntil?: string | null;
  occurrenceOverrides?: OccurrenceOverride[];
  revision?: number;
  reminderPreset: ReminderPreset | 'custom' | 'none';
  reminderRules?: ReminderRule[];
  reminders: string[];
  deliveries: DeliveryItem[];
  preparations: { id?: number; label: string; meta: string; tone: 'now' | 'soon' | 'later' }[];
  preparationsEnabled?: boolean;
};

type ReminderPreset = 'minimal' | 'standard' | 'thorough';
type EventRecurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

type DeliveryItem = {
  id: number;
  status: string;
  sentAt: string;
};

type EventRecommendation = {
  id: string;
  kind: '준비' | '정보' | '알림';
  title: string;
  reason: string;
  offsetMinutes: number;
};

type PushJob = {
  id: number;
  kind: string;
  status: string;
  scheduledFor: string;
  sentAt: string | null;
  acknowledgedAt: string | null;
  error: string | null;
  originalDate: string | null;
  offsetMinutes: number | null;
};

type PushTest = {
  scheduleId: number;
  scheduleTitle: string;
  job: PushJob;
};

const weekdayOptions = [
  { value: 1, label: '월요일' },
  { value: 2, label: '화요일' },
  { value: 3, label: '수요일' },
  { value: 4, label: '목요일' },
  { value: 5, label: '금요일' },
  { value: 6, label: '토요일' },
  { value: 0, label: '일요일' },
];

const reminderPresetOptions: Array<{
  id: ReminderPreset;
  label: string;
  description: string;
}> = [
  { id: 'minimal', label: '최소', description: '1일 전' },
  { id: 'standard', label: '기본', description: '3번 알림' },
  { id: 'thorough', label: '꼼꼼하게', description: '6번 알림' },
];

const initialSchedules: ScheduleItem[] = [
  {
    id: 1,
    eventDate: '2026-09-07',
    eventTime: '08:00',
    title: '민지 생일',
    eyebrow: '소중한 사람',
    date: '9월 7일',
    day: '월요일',
    time: '하루 종일',
    category: '기념일',
    accent: '#986b3e',
    soft: '#f4ecdf',
    dday: getDday('2026-09-07', 'yearly', 1, null),
    note: '올해는 미리 준비해서 여유 있게 축하해 주세요.',
    isSample: true,
    recurrence: 'yearly',
    recurrenceInterval: 1,
    recurrenceDay: null,
    reminderPreset: 'standard',
    reminders: ['7일 전 오전 9:00', '3일 전 오후 7:00', '당일 오전 8:00'],
    deliveries: [],
    preparations: [
      { label: '선물 아이디어 살펴보기', meta: '오늘 준비하면 배송이 여유로워요', tone: 'now' },
      { label: '저녁 식사 장소 정하기', meta: '주말 전 예약을 추천해요', tone: 'soon' },
      { label: '축하 메시지 보내기', meta: '9월 7일 오전 8시에 알려드려요', tone: 'later' },
    ],
  },
  {
    id: 2,
    eventDate: '2026-09-13',
    eventTime: '13:30',
    title: '선우의 결혼식',
    eyebrow: '초대받은 행사',
    date: '9월 13일',
    day: '일요일',
    time: '오후 1:30',
    category: '행사',
    accent: '#657993',
    soft: '#e9eef3',
    dday: getDday('2026-09-13'),
    note: '교통과 준비물을 일정에 맞춰 순서대로 알려드릴게요.',
    isSample: true,
    location: '아모리스 역삼',
    recurrence: 'none',
    recurrenceInterval: 1,
    recurrenceDay: null,
    reminderPreset: 'standard',
    reminders: ['7일 전 오전 10:00', '1일 전 오후 6:00', '2시간 전'],
    deliveries: [],
    preparations: [
      { label: '참석 여부 확인하기', meta: '이번 주 안에 확인해 주세요', tone: 'now' },
      { label: '축의금과 복장 준비하기', meta: '약 30분이 필요해요', tone: 'soon' },
      { label: '출발 시간 확인하기', meta: '당일 교통 상황을 반영해 알려드려요', tone: 'later' },
    ],
  },
  {
    id: 3,
    eventDate: '2026-09-18',
    eventTime: '07:10',
    title: '제주 가을 여행',
    eyebrow: '나의 계획',
    date: '9월 18일',
    day: '금요일',
    time: '오전 7:10',
    category: '여행',
    accent: '#54794f',
    soft: '#e8f0e2',
    dday: getDday('2026-09-18'),
    note: '항공편, 이동 계획과 준비물을 한 흐름으로 관리해요.',
    isSample: true,
    location: '김포공항 국내선',
    recurrence: 'none',
    recurrenceInterval: 1,
    recurrenceDay: null,
    reminderPreset: 'standard',
    reminders: ['14일 전 오전 9:00', '3일 전 오후 8:00', '3시간 전'],
    deliveries: [],
    preparations: [
      { label: '숙소 예약 확인하기', meta: '무료 취소 기한은 D-10이에요', tone: 'now' },
      { label: '여행 일정에 맞춰 짐 싸기', meta: 'D-3에 필요한 준비물을 점검해요', tone: 'soon' },
      { label: '온라인 체크인하기', meta: '출발 24시간 전에 알려드려요', tone: 'later' },
    ],
  },
];

type StoredEventResponse = {
  id: number;
  title: string;
  category: string;
  event_date: string;
  event_time: string;
  all_day: number;
  all_day_reminder_time: string;
  end_date: string | null;
  end_time: string | null;
  location: string;
  place?: KakaoPlace | null;
  travelPlan?: TravelPlan | null;
  note: string;
  preparations_enabled: number;
  recurrence: EventRecurrence;
  recurrence_interval: number;
  recurrence_day: number | null;
  recurrence_until: string | null;
  occurrenceOverrides: OccurrenceOverride[];
  notification_revision: number;
  preparations: Array<{
    id: number;
    title: string;
    timing: string;
    status: 'pending' | 'complete';
  }>;
  reminders: Array<{
    id: number;
    offset_minutes: number;
    repeat_until_ack: number;
  }>;
  deliveries: Array<{
    id: number;
    status: string;
    sent_at: string;
  }>;
};

function getSeoulToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const year = value('year');
  const month = value('month');
  const day = value('day');
  return { year, month, day, iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}

function getIsoWeekday(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function getUpcomingDate(
  eventDate: string,
  recurrence: EventRecurrence = 'none',
  recurrenceInterval = 1,
  recurrenceDay: number | null = null,
) {
  return nextOccurrenceDate({ eventDate, recurrence, recurrenceInterval, recurrenceDay }, getSeoulDate()) ?? eventDate;
}

function getDday(
  eventDate: string,
  recurrence: EventRecurrence = 'none',
  recurrenceInterval = 1,
  recurrenceDay: number | null = null,
) {
  const upcomingDate = getUpcomingDate(
    eventDate,
    recurrence,
    recurrenceInterval,
    recurrenceDay,
  );
  const [year, month, day] = upcomingDate.split('-').map(Number);
  const today = getSeoulToday();
  const base = Date.UTC(today.year, today.month - 1, today.day);
  const target = Date.UTC(year, month - 1, day);
  const daysAway = Math.round((target - base) / 86_400_000);
  return daysAway === 0 ? 'D-day' : daysAway > 0 ? `D-${daysAway}` : `D+${Math.abs(daysAway)}`;
}

function formatRecurrence(schedule: Pick<ScheduleItem, 'recurrence' | 'recurrenceInterval' | 'recurrenceDay' | 'eventDate'>) {
  const interval = schedule.recurrenceInterval;
  if (schedule.recurrence === 'none') return null;
  if (schedule.recurrence === 'daily') return interval === 1 ? '매일' : `${interval}일마다`;
  if (schedule.recurrence === 'weekly') {
    const weekday = weekdayOptions.find(
      (option) => option.value === (schedule.recurrenceDay ?? getIsoWeekday(schedule.eventDate)),
    )?.label ?? '요일 미지정';
    return interval === 1 ? `매주 ${weekday}` : `${interval}주마다 ${weekday}`;
  }
  if (schedule.recurrence === 'monthly') {
    const day = schedule.recurrenceDay ?? Number(schedule.eventDate.slice(8, 10));
    return interval === 1 ? `매월 ${day}일` : `${interval}개월마다 ${day}일`;
  }
  return interval === 1 ? '매년' : `${interval}년마다`;
}

function getRecurrenceUnitLabel(recurrence: EventRecurrence) {
  if (recurrence === 'daily') return '일마다';
  if (recurrence === 'weekly') return '주마다';
  if (recurrence === 'monthly') return '개월마다';
  if (recurrence === 'yearly') return '년마다';
  return '';
}

function getRecurrenceHint(recurrence: EventRecurrence) {
  if (recurrence === 'daily') return '선택한 날짜부터 설정한 일 간격으로 반복해요.';
  if (recurrence === 'weekly') return '몇 주마다 반복할지와 요일을 함께 선택해요.';
  if (recurrence === 'monthly') return '해당 날짜가 없는 달에는 그 달의 마지막 날로 맞춰요.';
  if (recurrence === 'yearly') return '선택한 월과 날짜를 기준으로 설정한 연수마다 반복해요.';
  return '반복이 필요한 일정에만 설정하면 돼요.';
}

function formatReminder(offsetMinutes: number) {
  if (offsetMinutes === 0) return '시작 시각';
  if (offsetMinutes % 10080 === 0) return `${offsetMinutes / 10080}주 전`;
  if (offsetMinutes % 1440 === 0) return `${offsetMinutes / 1440}일 전`;
  if (offsetMinutes % 60 === 0) return `${offsetMinutes / 60}시간 전`;
  return `${offsetMinutes}분 전`;
}

function formatDeliveryTime(sentAt: string) {
  const utcDate = new Date(`${sentAt.replace(' ', 'T')}Z`);
  if (Number.isNaN(utcDate.getTime())) return sentAt;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(utcDate);
}

function preparationKey(scheduleId: number, item: { id?: number; label: string }) {
  return `${scheduleId}:${item.id ?? item.label}`;
}

function toScheduleItem(event: StoredEventResponse): ScheduleItem {
  const upcomingEventDate = relevantOccurrenceDate({ eventDate: event.event_date, eventTime: event.event_time,
    recurrence: event.recurrence, recurrenceInterval: event.recurrence_interval || 1, recurrenceDay: event.recurrence_day ?? null,
    allDay: !!event.all_day, endDate: event.end_date, endTime: event.end_time });
  const [, month, day] = upcomingEventDate.split('-').map(Number);
  const eventDay = new Date(`${upcomingEventDate}T12:00:00+09:00`);
  const [hour, minute] = event.event_time.split(':').map(Number);
  const formattedTime = `${hour < 12 ? '오전' : '오후'} ${hour % 12 || 12}:${String(minute).padStart(2, '0')}`;

  return {
    id: 100_000 + event.id,
    storageId: event.id,
    eventDate: event.event_date,
    eventTime: event.event_time,
    allDay: !!event.all_day,
    allDayReminderTime: event.all_day_reminder_time ?? '09:00',
    endDate: event.end_date,
    endTime: event.end_time,
    title: event.title,
    eyebrow: '내가 등록한 일정',
    date: `${month}월 ${day}일`,
    day: eventDay.toLocaleDateString('ko-KR', { weekday: 'long', timeZone: 'Asia/Seoul' }),
    time: event.all_day ? '종일' : formattedTime,
    category: event.category,
    ...getCategoryTheme(event.category),
    dday: getDday(
      event.event_date,
      event.recurrence,
      event.recurrence_interval || 1,
      event.recurrence_day ?? null,
    ),
    note: event.note || '',
    preparationsEnabled: event.preparations_enabled !== 0,
    location: event.location || undefined,
    place: event.place ?? null,
    travelPlan: event.travelPlan ?? null,
    recurrence: event.recurrence,
    recurrenceInterval: event.recurrence_interval || 1,
    recurrenceDay: event.recurrence_day ?? null,
    recurrenceUntil: event.recurrence_until,
    occurrenceOverrides: event.occurrenceOverrides ?? [],
    revision: event.notification_revision,
    reminderPreset: matchReminderPreset(event.reminders),
    reminderRules: event.reminders,
    reminders: event.reminders.map((reminder) => formatReminder(reminder.offset_minutes)),
    deliveries: event.deliveries.map((delivery) => ({
      id: delivery.id,
      status: delivery.status,
      sentAt: delivery.sent_at,
    })),
    preparations: event.preparations.map((item, index) => ({
      id: item.id,
      label: item.title,
      meta: item.timing,
      tone: index === 0 ? 'now' : index === 1 ? 'soon' : 'later',
    })),
  };
}

function sortSchedules(items: ScheduleItem[]) {
  return [...items].sort((first, second) => relevantOccurrenceDate(first).localeCompare(relevantOccurrenceDate(second)));
}

function getDefaultEventDate() {
  return getSeoulDate();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function normalizePushJob(value: unknown): PushJob | null {
  if (!isRecord(value)) return null;

  const id = Number(value.id);
  const scheduledFor = getString(value.scheduledFor) ?? getString(value.scheduled_for);
  if (!Number.isInteger(id) || id < 1 || !scheduledFor) return null;

  return {
    id,
    kind: getString(value.kind) ?? 'test',
    status: getString(value.status) ?? 'scheduled',
    scheduledFor,
    sentAt: getString(value.sentAt) ?? getString(value.sent_at),
    acknowledgedAt:
      getString(value.acknowledgedAt) ??
      getString(value.acknowledged_at) ??
      getString(value.ackedAt) ??
      getString(value.acked_at),
    error: getString(value.error) ?? getString(value.last_error),
    originalDate: getString(value.original_occurrence_date),
    offsetMinutes: typeof value.reminder_offset_minutes === 'number' ? value.reminder_offset_minutes : null,
  };
}

function parseServerTimestamp(value: string) {
  const isoValue = value.includes('T') ? value : value.replace(' ', 'T');
  const includesTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(isoValue);
  return new Date(includesTimeZone ? isoValue : `${isoValue}Z`);
}

function formatPushTime(value: string) {
  const date = parseServerTimestamp(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatPushCountdown(value: string, now: number) {
  const target = parseServerTimestamp(value).getTime();
  if (Number.isNaN(target)) return null;

  const remainingSeconds = Math.max(0, Math.ceil((target - now) / 1_000));
  if (remainingSeconds === 0) return now - target > 90_000 ? '발송 지연 · 상태 확인 필요' : '발송 대기 중';

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return minutes > 0 ? `${minutes}분 ${String(seconds).padStart(2, '0')}초 뒤` : `${seconds}초 뒤`;
}

function getPushStatus(status: string) {
  if (status === 'cancelled') {
    return { label: '취소됨', detail: '일정·알림 설정이 바뀌었거나 발송 가능 시간이 지나 취소됐어요.', dot: 'bg-[#657260]', badge: 'bg-[#f1f1ec] text-[#686a64]' };
  }
  if (status === 'unconfirmed') {
    return { label: '결과 확인 필요', detail: '발송 결과를 확인하지 못했어요. 중복 알림을 막기 위해 자동으로 다시 보내지 않습니다.', dot: 'bg-[#c78138]', badge: 'bg-[#fff0dc] text-[#8a5b28]' };
  }
  if (status === 'processing') {
    return {
      label: '발송 준비 중',
      detail: '예약 시간이 되어 알림을 안전하게 보내고 있어요.',
      dot: 'bg-[#c78138]',
      badge: 'bg-[#fff0dc] text-[#8a5b28]',
    };
  }
  if (status === 'sent') {
    return {
      label: '발송 요청 수락',
      detail: '푸시 서비스가 요청을 받았어요. 알림에서 확인하거나 10분 미룰 수 있어요.',
      dot: 'bg-[#36876f]',
      badge: 'bg-[#e4f3ed] text-[#286c59]',
    };
  }
  if (status === 'acked' || status === 'acknowledged') {
    return {
      label: '확인됨',
      detail: '알림에서 확인한 상태가 저장됐어요.',
      dot: 'bg-[#36876f]',
      badge: 'bg-[#e4f3ed] text-[#286c59]',
    };
  }
  if (status === 'failed') {
    return {
      label: '실패',
      detail: '알림을 보내지 못했어요. 브라우저 권한을 확인한 뒤 다시 예약해 주세요.',
      dot: 'bg-[#bd5b4d]',
      badge: 'bg-[#f8e9e5] text-[#9b4d42]',
    };
  }
  return {
    label: '예약됨',
    detail: '예정 시각부터 약 1분 안에 발송을 시도해요. 기기의 네트워크와 알림 설정에 따라 도착이 늦어질 수 있어요.',
    dot: 'bg-[#7c6ab5]',
    badge: 'bg-[#eeeafb] text-[#665492]',
  };
}

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const output = new Uint8Array(buffer);

  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index);
  }

  return output;
}

function isPushTerminal(status: string) {
  return status === 'sent' || status === 'failed' || status === 'unconfirmed' || status === 'acked' || status === 'acknowledged' || status === 'cancelled';
}

export default function Home() {
  useMobileViewport();
  const isOffline = !useConnectionStatus();
  const account = useAccountProfile(true);
  const [storedSchedules, setSchedules] = useState(initialSchedules);
  const categoryColors = useCategoryColors();
  const schedules = useMemo(() => storedSchedules.map(item => ({ ...item, ...getCategoryTheme(item.category, categoryColors.colors[item.category]) })), [storedSchedules, categoryColors.colors]);
  const [selectedId, setSelectedId] = useState(1);
  const [selectedOccurrence, setSelectedOccurrence] = useState<{ id: number; date: string } | null>(null);
  const selectionRef = useRef({ id: selectedId, date: selectedOccurrence?.date });
  useLayoutEffect(() => { selectionRef.current = { id: selectedId, date: selectedOccurrence?.date }; }, [selectedId, selectedOccurrence?.date]);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('today');
  const [savedGuide, setSavedGuide] = useState<{ id: number; date: string } | null>(null);
  const [recoveryContext, setRecoveryContext] = useState<{id:number;date:string}|null>(null);
  const [resumeBookmark, setResumeBookmark] = useState<ResumeBookmark|null>(null);
  const resumeRead = useRef(false);
  const [notificationEntry, setNotificationEntry] = useState<{id:number;jobId:number;date:string}|null>(null);
  const [notificationEntryStatus, setNotificationEntryStatus] = useState<'loading'|'ready'|'unavailable'|'error'>('loading');
  const [notificationRequestVersion, setNotificationRequestVersion] = useState(0);
  const notificationMutationVersion = useRef(0);
  const [newEventDraft, setNewEventDraft] = useState<{title:string;note:string}|null>(null);
  const [eventScope, setEventScope] = useState('');
  const [pendingCreation, setPendingCreation] = useState<CreationAttempt | null>(null);
  const [creationRecovery, setCreationRecovery] = useState<'deleted' | 'account' | 'conflict' | null>(null);
  const previousEventScope = useRef('');
  const latestEventScope = useRef('');
  const [draftCandidate, setDraftCandidate] = useState<EventDraft | null>(null);
  const [restoredDraft, setRestoredDraft] = useState<DraftValues | null>(null);
  const [draftKept, setDraftKept] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const [editorDraftId, setEditorDraftId] = useState('');
  const restoredInitial = restoredDraft ? draftInitial(restoredDraft) : null;
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailFocusRequest, setDetailFocusRequest] = useState<{ target: string } | null>(null);
  const handledDetailFocus = useRef<{ request: { target: string } | null; id: number; date: string } | null>(null);
  const [calendarReveal, setCalendarReveal] = useState<{ date: string; sequence: number } | null>(null);
  const selectedTriggerRef = useRef<HTMLElement | null>(null);
  const editorTriggerRef = useRef<HTMLElement | null>(null);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsLoadError, setEventsLoadError] = useState(false);
  const [eventsVersion, setEventsVersion] = useState(0);
  const [detailView, setDetailView] = useState<'preparation' | 'reminders'>('preparation');
  const detailScrollRef = useRef<HTMLElement>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduleItem | null>(null);
  const [occurrenceAction, setOccurrenceAction] = useState<'edit' | 'cancel' | null>(null);
  const [occurrenceBusy, setOccurrenceBusy] = useState(false);
  const occurrenceBusyRef = useRef(false);
  const [occurrenceError, setOccurrenceError] = useState<string | null>(null);
  const [draftRecurrence, setDraftRecurrence] = useState<EventRecurrence>('none');
  const [draftEventDate, setDraftEventDate] = useState('');
  const [draftInterval, setDraftInterval] = useState('1');
  const [draftDay, setDraftDay] = useState<string | null>(null);
  const [draftCategory, setDraftCategory] = useState<ScheduleItem['category']>('일정');
  const [initialReminderChoice, setInitialReminderChoice] = useState<InitialReminderChoice | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduleItem | null>(null);
  const [completed, setCompleted] = useState<string[]>([]);
  const [isSampleMode, setIsSampleMode] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const [reminderBusy, setReminderBusy] = useState(false);
  const reminderBusyRef = useRef(false);
  const [refreshingScheduleIds, setRefreshingScheduleIds] = useState<Set<number>>(() => new Set());
  const [preferencePendingIds, setPreferencePendingIds] = useState<Set<number>>(() => new Set());
  const scheduleRefreshVersions = useRef(new Map<number, number>());
  const [isSchedulingPush, setIsSchedulingPush] = useState(false);
  const pushBusyRef = useRef(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const diagnostics = useNotificationDiagnostics(isSchedulingPush);
  const { permission: notificationPermission, setPermission: setNotificationPermission, device: pushDevice, setDevice: setPushDevice } = diagnostics;
  const deviceLoaded = diagnostics.deviceState === 'ready';
  const schedulerReady = diagnostics.server === 'ready';
  const deviceDiagnosis = notificationDiagnosis(diagnostics);
  const modalOpen = isAdding || !!editingSchedule || !!deleteTarget || !!occurrenceAction || !!draftCandidate;
  const [pushTest, setPushTest] = useState<PushTest | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushPollWarning, setPushPollWarning] = useState<string | null>(null);
  const [pushNow, setPushNow] = useState(() => Date.now());
  const pushIdempotencyKeys = useRef(new Map<string, string>());
  const [nextReminder, setNextReminder] = useState<{ eventId: number; at: string | null } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | GrowthFeedbackNotice | null>(null);
  const selectedMaster = useMemo(
    () => schedules.find((item) => item.id === selectedId) ?? schedules[0],
    [schedules, selectedId],
  );
  const defaultEventDate = useMemo(() => getDefaultEventDate(), []);
  const activeWorkspace = workspaceNavigation.find((item) => item.id === workspaceView)!;
  const nextResolved = relevantResolvedOccurrence(selectedMaster, getSeoulDate(new Date(pushNow)), new Date(pushNow));
  const selectedResolved = (selectedOccurrence?.id === selectedMaster.id
    ? resolveOccurrence(selectedMaster, selectedOccurrence.date) : null) ?? nextResolved
    ?? (selectedMaster.recurrence === 'none' ? resolveOccurrence(selectedMaster, selectedMaster.eventDate) : null);
  const selected = selectedResolved?.event ?? selectedMaster;
  const selectedViewDate = selectedResolved?.originalDate ?? selectedMaster.eventDate;
  const selectedDisplayDate = selectedResolved?.start ?? selectedMaster.eventDate;
  const selectedUpcomingDate = nextResolved?.start ?? selectedDisplayDate;
  const growth = useGrowth(selectedResolved ? selected.storageId : undefined, selectedViewDate, pushNow);
  const currentGrowth = growth.progress ? growthJourney(growth.progress.totalXp) : null;
  const isPreparationComplete = (item: ScheduleItem['preparations'][number]) => selected.isSample
    ? completed.includes(preparationKey(selected.id, item)) : !!item.id && !!growth.occurrence?.completedPreparationIds.includes(item.id);
  const continuation = growth.occurrence?.complete && selected.storageId && growth.progress && !eventsLoading && !eventsLoadError
    ? nextActionRow(schedules, pushNow, growth.progress.completedEvents, { eventId: selected.storageId, date: selectedViewDate }) : null;
  const visiblePushTest = pushTest?.scheduleId === selected.id ? pushTest : null;
  const entryJob = notificationEntry?.id === selected.id && notificationEntry.date === selectedViewDate
    && visiblePushTest?.job.id === notificationEntry.jobId && (visiblePushTest.job.kind !== 'reminder' || visiblePushTest.job.originalDate === selectedViewDate) ? visiblePushTest.job : null;
  const entryDestination = entryJob ? notificationDestination({kind: entryJob.kind, offset: entryJob.offsetMinutes, preparationsEnabled: selected.preparationsEnabled !== false, hasLocation: !!selected.location}) : 'summary';
  const visiblePushStatus = visiblePushTest ? getPushStatus(visiblePushTest.job.status) : null;
  const visiblePushCountdown =
    visiblePushTest?.job.status === 'scheduled'
      ? formatPushCountdown(visiblePushTest.job.scheduledFor, pushNow)
      : null;
  const activePushJobId = pushTest?.job.id ?? null;
  const activePushJobStatus = pushTest?.job.status ?? null;
  const activePushScheduledFor = pushTest?.job.scheduledFor ?? null;

  function openCreate(date?: string, resume?: EventDraft, skipDraft = false) {
    if (!resume && !skipDraft) {
      if (pendingCreation?.scope === eventScope) { openCreate(undefined, { version: 1, draftId: pendingCreation.requestId, scope: pendingCreation.scope, savedAt: Date.now(), values: pendingCreation.values, pending: pendingCreation }, true); return; }
      try {
        const draft = loadLatestEventDraft(localStorage, eventScope);
        if (draft) { setDraftCandidate(draft); return; }
      } catch { /* Optional device storage. */ }
    }
    const values = resume?.values;
    setDraftCandidate(null); setRestoredDraft(values ?? null); setDraftKept(resume ? pendingCreation ? draftKept : true : false);
    if (resume && resume.scope !== eventScope) { setFeedback('계정이 바뀌었어요. 현재 계정에서 다시 시작해 주세요.'); return; }
    setPendingCreation(resume?.pending ?? null); setCreationRecovery(null); setEditorVersion(version => version + 1);
    setEditorDraftId(resume?.draftId ?? crypto.randomUUID());
    setNewEventDraft(null);
    try { setInitialReminderChoice(readInitialReminderPreference(window.localStorage.getItem(INITIAL_REMINDER_PREFERENCE_KEY))); }
    catch { setInitialReminderChoice(null); }
    editorTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSaveError(null);
    setEditingSchedule(null);
    setDraftRecurrence('none');
    setDraftInterval('1'); setDraftDay(null); setDraftCategory('일정');
    setDraftEventDate(typeof date === 'string' ? date : getSeoulDate());
    if (values) {
      setNewEventDraft({ title: values.title ?? '', note: values.note ?? '' });
      setInitialReminderChoice(draftInitial(values).reminders);
      setDraftEventDate(values.date ?? getSeoulDate());
      setDraftRecurrence((values.recurrence ?? 'none') as EventRecurrence);
      setDraftInterval(values.recurrenceInterval ?? '1'); setDraftDay(values.recurrenceDay ?? null); setDraftCategory(values.category ?? '일정');
    }
    setIsAdding(true);
  }

  function isScheduleEditBlocked(scheduleId: number) {
    return reminderBusy || occurrenceBusy || preferencePendingIds.has(scheduleId) || refreshingScheduleIds.has(scheduleId);
  }

  function openEdit(schedule: ScheduleItem) {
    if (isScheduleEditBlocked(schedule.id)) { setFeedback('최신 일정 정보를 확인 중이에요. 잠시 뒤 다시 열어 주세요.'); return; }
    setSavedGuide(null);
    editorTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSaveError(null);
    setIsAdding(false);
    setDraftRecurrence(schedule.recurrence);
    setDraftInterval(String(schedule.recurrenceInterval)); setDraftDay(schedule.recurrenceDay === null ? null : String(schedule.recurrenceDay)); setDraftCategory(schedule.category);
    setDraftEventDate(schedule.eventDate);
    setEditingSchedule(schedule);
  }

  function closeEditor() {
    setIsAdding(false);
    setEditingSchedule(null);
    setDraftRecurrence('none');
    setDraftEventDate('');
    setSaveError(null);
    restoreEditorFocus();
  }

  function openOccurrenceEditor(action: 'edit' | 'cancel') {
    if (isScheduleEditBlocked(selectedMaster.id)) return;
    editorTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOccurrenceError(null); setOccurrenceAction(action);
  }

  function closeOccurrenceEditor() {
    setOccurrenceAction(null);
    restoreEditorFocus();
  }

  function restoreEditorFocus() {
    requestAnimationFrame(() => {
      const trigger = editorTriggerRef.current;
      if (trigger?.isConnected && trigger.getClientRects().length) trigger.focus();
      else detailScrollRef.current?.focus();
    });
  }

  useLayoutEffect(() => {
    if (previousEventScope.current && eventScope && previousEventScope.current !== eventScope) {
      setIsAdding(false); setEditingSchedule(null); setPendingCreation(null); setCreationRecovery(null);
      setDraftCandidate(null); setRestoredDraft(null); setNewEventDraft(null); setDraftKept(false); setSaveError(null);
      setFeedback('계정이 바뀌어 이전 계정의 작성 화면을 닫았어요.');
    }
    previousEventScope.current = eventScope;
  }, [eventScope]);

  useEffect(() => {
    detailScrollRef.current?.scrollTo({ top: 0 });
  }, [selectedId, selectedViewDate, detailView]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/events')
      .then(async (response) => {
        if (!response.ok) throw new Error('events-unavailable');
        return (await response.json()) as { events: StoredEventResponse[]; accountScope: string };
      })
      .then(({ events, accountScope }) => {
        if (cancelled) return;
        latestEventScope.current = accountScope;
        setEventScope(accountScope);
        setEventsLoading(false);
        // Read a local navigation hint only after the owned event list has loaded.
        if (!resumeRead.current && !new URLSearchParams(window.location.search).has('event')) {
          try { setResumeBookmark(readResumeBookmark(window.localStorage.getItem(RESUME_KEY))); } catch { /* Browsing remains available without storage. */ }
        }
        resumeRead.current = true;
        setEventsLoadError(false);
        if (events.length === 0) {
          setSchedules(initialSchedules); setIsSampleMode(true); setSelectedId(initialSchedules[0].id);
          setSelectedOccurrence(null); setCompleted([]); setDetailOpen(false);
          return;
        }
        const storedSchedules = sortSchedules(events.map(toScheduleItem));
        setSchedules(storedSchedules);
        const eventFromUrl = Number(new URLSearchParams(window.location.search).get('event'));
        const occurrenceFromUrl = new URLSearchParams(window.location.search).get('occurrence');
        const linkedEvent = storedSchedules.find((item) => item.storageId === eventFromUrl);
        if (linkedEvent && occurrenceFromUrl && resolveOccurrence(linkedEvent, occurrenceFromUrl)) {
          setSelectedOccurrence({ id: linkedEvent.id, date: occurrenceFromUrl });
        }
        setSelectedId(storedSchedules.find((item) => item.storageId === eventFromUrl)?.id ?? storedSchedules[0].id);
        setIsSampleMode(false);
        if (eventFromUrl && storedSchedules.some((item) => item.storageId === eventFromUrl)) {
          setDetailOpen(true);
          if (new URLSearchParams(window.location.search).has('pushActionFailed')) setDetailView('reminders');
          const jobId = Number(new URLSearchParams(window.location.search).get('notificationJob'));
          const linkedOccurrence = linkedEvent && (occurrenceFromUrl ? resolveOccurrence(linkedEvent,occurrenceFromUrl) : relevantResolvedOccurrence(linkedEvent));
          if (linkedEvent && linkedOccurrence && Number.isSafeInteger(jobId) && jobId > 0) {
            setNotificationEntry({id:linkedEvent.id,jobId,date:linkedOccurrence.originalDate});
            setNotificationEntryStatus('loading');
            setDetailFocusRequest({target:new URLSearchParams(window.location.search).has('pushActionFailed')?'device-reminder-settings':'notification-entry'});
          } else if (occurrenceFromUrl && !linkedOccurrence) setFeedback('알림의 회차가 변경되었거나 취소됐어요. 현재 일정 정보를 확인해 주세요.');
        }
        setCompleted(
          events.flatMap((event) =>
            event.preparations
              .filter((item) => item.status === 'complete')
              .map((item) => preparationKey(100_000 + event.id, { id: item.id, label: item.title })),
          ),
        );
      })
      .catch(() => { if (!cancelled) { setEventsLoading(false); setEventsLoadError(true); } });
    return () => {
      cancelled = true;
    };
  }, [eventsVersion]);

  useEffect(() => {
    if (!deleteTarget) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? []);
    if (deleteTarget) focusable()[0]?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const elements = focusable();
        const first = elements[0];
        const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        return;
      }
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      setDeleteTarget(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', closeOnEscape); previousFocus?.focus(); };
  }, [deleteTarget]);

  useEffect(() => {
    if (!detailOpen || isAdding || editingSchedule || deleteTarget || occurrenceAction || savedGuide) return;
    const handled = handledDetailFocus.current;
    if (handled?.request === detailFocusRequest && handled.id === selectedId && handled.date === selectedViewDate) return;
    const frame = window.requestAnimationFrame(() => {
      handledDetailFocus.current = { request: detailFocusRequest, id: selectedId, date: selectedViewDate };
      const target = detailFocusRequest && document.getElementById(detailFocusRequest.target);
      const destination = target ?? document.getElementById('event-details');
      destination?.focus({ preventScroll: true });
      if (target) target.scrollIntoView({ block: 'start', behavior: 'instant' });
      else if (window.matchMedia('(max-width: 1199px)').matches) window.scrollTo({ top: 0, behavior: 'instant' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detailOpen, selectedId, selectedViewDate, detailFocusRequest, isAdding, editingSchedule, deleteTarget, occurrenceAction, savedGuide]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const receiveJobUpdate = (event: MessageEvent<unknown>) => {
      if (!isRecord(event.data) || event.data.type !== 'ahead:notification-job-updated') return;
      const job = normalizePushJob(event.data.job);
      if (!job) return;
      notificationMutationVersion.current += 1;
      setNotificationRequestVersion(value => value + 1);
      setPushTest((current) =>
        current?.job.id === job.id ? { ...current, job } : current,
      );
      setPushNow(Date.now());
      setPushPollWarning(null);
    };

    navigator.serviceWorker.addEventListener('message', receiveJobUpdate);
    return () => navigator.serviceWorker.removeEventListener('message', receiveJobUpdate);
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('pushActionFailed')) {
      window.requestAnimationFrame(() => setPushError('알림의 확인·미루기가 반영되지 않았어요. 로그인 후 아래 버튼으로 다시 시도해 주세요.'));
    }
  }, []);

  useEffect(() => {
    if (!selected.storageId) return;
    const controller = new AbortController();
    const query = new URLSearchParams(window.location.search);
    const requestedJob = Number(query.get('notificationJob'));
    const hasRequestedJob = Number(query.get('event')) === selected.storageId && Number.isSafeInteger(requestedJob) && requestedJob > 0;
    const refresh = () => {
      const mutationVersion = notificationMutationVersion.current;
      const options = { cache: 'no-store' as const, signal: controller.signal };
      const summary = fetch(`/api/events/${selected.storageId}/notifications${pushDevice ? '?subscriptionId=' + pushDevice.id : ''}`, options)
        .then((response) => { if (!response.ok) throw new Error('reminder-status-failed'); return response.json(); });
      const detail = hasRequestedJob ? fetch(`/api/notifications/jobs/${requestedJob}`, options)
        .then((response) => { if (response.status === 404) return null; if (!response.ok) throw new Error('notification-detail-failed'); return response.json(); }) : summary;
      Promise.all([summary, detail]).then(([eventSummary, result]) => {
          if (controller.signal.aborted || mutationVersion !== notificationMutationVersion.current) return;
          setNextReminder({ eventId: selected.storageId!, at: isRecord(eventSummary) && isRecord(eventSummary.nextReminder) ? getString(eventSummary.nextReminder.scheduled_for) : null });
          const job = isRecord(result) && isRecord(result.job) && Number(result.job.event_id) === selected.storageId ? normalizePushJob(result.job) : null;
          if (hasRequestedJob) setNotificationEntryStatus(job && (job.kind !== 'reminder' || job.originalDate === selectedViewDate) ? 'ready' : 'unavailable');
          setPushTest((current) => workspaceView === 'notifications' && !detailOpen && current && current.job.id !== job?.id ? current : job
            ? !hasRequestedJob && current?.scheduleId === selected.id && current.job.id > job.id ? current : { scheduleId: selected.id, scheduleTitle: selected.title, job }
            : current?.scheduleId === selected.id ? null : current);
        }).catch(() => { if (!controller.signal.aborted && mutationVersion === notificationMutationVersion.current) { setNextReminder(null); if (hasRequestedJob) setNotificationEntryStatus('error'); } });
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [selected.storageId, selected.id, selected.title, selectedViewDate, selected.reminders, pushDevice, growth.occurrence?.complete, notificationRequestVersion, workspaceView, detailOpen]);

  useEffect(() => {
    if (!activePushJobId || !activePushJobStatus || isPushTerminal(activePushJobStatus)) return;

    let cancelled = false;
    let timer: number | undefined;
    const controller = new AbortController();

    const poll = async () => {
      const mutationVersion = notificationMutationVersion.current;
      try {
        const response = await fetch(`/api/notifications/jobs/${activePushJobId}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (cancelled || mutationVersion !== notificationMutationVersion.current) return;
        if (response.status === 401 || response.status === 404) {
          setPushPollWarning('상태를 확인하려면 로그인 상태와 일정이 남아 있는지 확인해 주세요.');
          return;
        }
        if (!response.ok) throw new Error('push-status-failed');

        const result: unknown = await response.json();
        const job = isRecord(result) ? normalizePushJob(result.job) : null;
        if (!job) throw new Error('push-status-invalid');
        if (cancelled || mutationVersion !== notificationMutationVersion.current) return;

        setPushTest((current) =>
          current?.job.id === job.id ? { ...current, job } : current,
        );
        setPushPollWarning(null);
        if (!isPushTerminal(job.status)) timer = window.setTimeout(poll, 4_000);
      } catch (error) {
        if (cancelled || mutationVersion !== notificationMutationVersion.current || (error instanceof DOMException && error.name === 'AbortError')) return;
        setPushPollWarning('예약 상태를 다시 확인하고 있어요. 알림 예약은 그대로 유지됩니다.');
        timer = window.setTimeout(poll, 6_000);
      }
    };

    timer = window.setTimeout(poll, 3_000);
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [activePushJobId, activePushJobStatus, notificationRequestVersion]);

  useEffect(() => {
    const active = activePushJobId && activePushJobStatus === 'scheduled' && activePushScheduledFor;
    const timer = window.setInterval(() => setPushNow(Date.now()), active ? 1_000 : 60_000);
    return () => window.clearInterval(timer);
  }, [activePushJobId, activePushJobStatus, activePushScheduledFor]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    if (pendingCreation && !editingSchedule) { await retryCreation(); return; }
    if (!navigator.onLine) { setSaveError('인터넷에 다시 연결한 뒤 저장해 주세요. 입력한 내용은 이 화면을 닫기 전까지 남아 있어요.'); return; }
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') || '새로운 중요 일정');
    const category = parseEventCategory(form.get('category'));
    if (!category) { setSaveError(`일정 종류를 1~${MAX_CATEGORY_LENGTH}자로 입력해 주세요.`); return; }
    const eventDate = String(form.get('date') || defaultEventDate);
    const eventTime = String(form.get('time') || editingSchedule?.eventTime || '09:00');
    const allDay = form.has('allDay');
    const preparationsEnabled = form.has('preparationsEnabled');
    let initialReminders: InitialReminderChoice | null = null;
    if (!editingSchedule) {
      try { initialReminders = parseInitialReminderChoice(JSON.parse(String(form.get('initialReminderChoice') ?? 'null'))); }
      catch { /* The field below explains malformed input without discarding the draft. */ }
      if (!initialReminders) {
        const options = event.currentTarget.querySelector<HTMLDetailsElement>('.initial-reminder-field details');
        if (options) options.open = true;
        setSaveError('알림 시점을 확인해 주세요. 중복 없이 0~365일 범위로 설정할 수 있어요.'); return;
      }
    }
    const allDayReminderTime = String(form.get('allDayReminderTime') || '09:00');
    const endDate = form.has('hasEnd') ? String(form.get('endDate') || '') : allDay ? eventDate : null;
    const endTime = !allDay && endDate ? String(form.get('endTime') || '') : null;
    if (endDate && (endDate < eventDate || daysBetween(eventDate, endDate) > 366 || (!allDay && `${endDate}T${endTime}` <= `${eventDate}T${eventTime}`))) {
      setSaveError('종료는 시작보다 뒤여야 하며, 날짜 간격은 최대 366일이에요.');
      return;
    }
    const location = String(form.get('location') || '');
    const place = JSON.parse(String(form.get('place') || 'null')) as KakaoPlace | null;
    const rawTravelPlan: unknown = JSON.parse(String(form.get('travelPlan') || 'null'));
    const travelPlan = rawTravelPlan === null ? null : parseTravelPlan(rawTravelPlan);
    if (rawTravelPlan !== null && (!place || !travelPlan)) {
      setSaveError('이동 경로의 출발지와 도착지는 장소 검색 결과에서 선택해 주세요.');
      return;
    }
    const note = String(form.get('note') || '');
    const recurrence = String(form.get('recurrence') || 'none') as EventRecurrence;
    const recurrenceInterval =
      recurrence === 'none' ? 1 : Number(form.get('recurrenceInterval') || 1);
    const recurrenceDay =
      recurrence === 'weekly'
        ? Number(form.get('recurrenceDay') ?? getIsoWeekday(eventDate))
        : recurrence === 'monthly'
          ? Number(form.get('recurrenceDay') || eventDate.slice(8, 10))
          : null;

    const payload = {
          ...(editingSchedule ? { revision: editingSchedule.revision } : {}),
          title,
          category,
          eventDate,
          eventTime,
          allDay,
          preparationsEnabled,
          ...(!editingSchedule && initialReminders ? { initialReminderOffsets: initialReminders.offsets, seedPreparations: false } : {}),
          allDayReminderTime,
          endDate,
          endTime,
          location,
          place,
          travelPlan,
          note,
          recurrence,
          recurrenceInterval,
          recurrenceDay,
          recurrenceUntil: recurrence === 'none' ? null : String(form.get('recurrenceUntil') || '') || null,
    };
    if (!editingSchedule) {
      if (!eventScope) { setSaveError('계정 정보를 확인 중이에요. 잠시 후 다시 저장해 주세요.'); return; }
      const requestId = editorDraftId || crypto.randomUUID();
      const attempt: CreationAttempt = { requestId, scope: eventScope, payload: JSON.stringify({ ...payload, requestId }), values: captureDraftValues(form), reminders: initialReminders!, remember: form.has('rememberInitialReminders') };
      setPendingCreation(attempt);
      // Persist the request identity before sending, so a lost response remains retry-safe after reload.
      if (draftKept) {
        try { writeEventDraft(localStorage, { version: 1, draftId: requestId, scope: eventScope, savedAt: Date.now(), values: attempt.values, pending: attempt }); }
        catch { setPendingCreation(null); setSaveError('임시 보관을 갱신하지 못했어요. 임시 보관을 끈 뒤 저장하거나 브라우저 저장소를 확인해 주세요.'); return; }
      }
      await submitCreation(attempt); return;
    }
    savingRef.current = true; setIsSaving(true); setSaveError(null);
    let storedEvent: StoredEventResponse;
    try {
      const response = await fetch(`/api/events/${editingSchedule.storageId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(response.status === 409 || response.status === 428 ? body.error : '저장하지 못했어요. 날짜와 입력 내용을 확인해 주세요.');
      }
      const result = (await response.json()) as { event: StoredEventResponse };
      if (!result.event) throw new Error('missing-event');
      storedEvent = result.event;
    } catch (error) {
      setSaveError(error instanceof TypeError ? '연결 문제로 저장 결과를 확인하지 못했어요. 다시 연결한 뒤 일정이 저장됐는지 확인하고 재시도해 주세요.' : error instanceof Error ? error.message : '저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
      savingRef.current = false;
      setIsSaving(false);
      return;
    }

    finishSave(storedEvent, initialReminders, form.has('rememberInitialReminders'));
  }

  async function retryCreation() {
    if (!pendingCreation || savingRef.current || isOffline) return;
    await submitCreation(pendingCreation, true);
  }

  async function submitCreation(attempt: CreationAttempt, recover = false) {
    savingRef.current = true; setIsSaving(true); setSaveError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      if (recover) {
        const check = await fetch(`/api/events?requestId=${attempt.requestId}`, { cache: 'no-store', signal: controller.signal, headers: { 'x-toj-event-account': attempt.scope } });
        const known = await check.json() as { state?: string; event?: StoredEventResponse; error?: string; payloadHash?: string };
        if (latestEventScope.current !== attempt.scope) return;
        if (check.status === 410) { setCreationRecovery('deleted'); throw new Error(known.error ?? '이미 삭제된 일정이에요.'); }
        if (check.status === 409) { setCreationRecovery('account'); throw new Error(known.error ?? '계정이 바뀌었어요.'); }
        if (!check.ok) throw new Error(known.error ?? '저장 상태를 확인하지 못했어요.');
        if (known.state === 'saved' && known.event) {
          const payload = JSON.parse(attempt.payload);
          const expected = await eventPayloadHash({ input: parseEventInput(payload), offsets: parseInitialReminderOffsets(payload.initialReminderOffsets) ?? null, seed: payload.seedPreparations ?? true });
          if (latestEventScope.current !== attempt.scope) return;
          if (known.payloadHash !== expected) { setCreationRecovery('conflict'); throw new Error('다른 탭에서 이 초안의 다른 내용을 먼저 저장했어요. 현재 변경 내용은 유지했어요. 별도 일정으로 이어 쓸 수 있어요.'); }
          setPendingCreation(null); setCreationRecovery(null);
          try { localStorage.removeItem(eventDraftKey(attempt.scope, attempt.requestId)); } catch { /* Receipt protects subsequent recovery. */ }
          finishSave(known.event, null, false); return;
        }
        if (known.state !== 'missing') throw new Error('저장 상태를 확인하지 못했어요.');
      }
      const response = await fetch('/api/events', { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', 'x-toj-event-save': '1', 'x-toj-event-account': attempt.scope }, body: attempt.payload });
      const body = await response.json() as { event?: StoredEventResponse; error?: string; code?: string };
      if (latestEventScope.current !== attempt.scope) return;
      if (!response.ok || !body.event) {
        if ([400, 403, 415].includes(response.status)) {
          setPendingCreation(null);
          if (draftKept) try { localStorage.removeItem(eventDraftKey(attempt.scope, attempt.requestId)); writeEventDraft(localStorage, { version: 1, draftId: attempt.requestId, scope: attempt.scope, savedAt: Date.now(), values: attempt.values, pending: null }); } catch { /* The old request is safe to resolve. */ }
          throw new Error(body.error ?? '입력 내용을 확인해 주세요.');
        }
        // Account changes and deleted/replaced requests must not mint another key implicitly.
        if (response.status === 409 || response.status === 410) {
          if (response.status === 410) setCreationRecovery('deleted');
          else if (body.code === 'account_changed') setCreationRecovery('account');
          else if (body.code === 'request_changed') { setCreationRecovery('conflict'); throw new Error('다른 탭에서 이 초안의 다른 내용을 먼저 저장했어요. 현재 변경 내용은 유지했어요. 별도 일정으로 이어 쓸 수 있어요.'); }
          throw new Error(body.error ?? '현재 계정과 일정 상태를 확인해 주세요.');
        }
        throw new Error('저장 결과를 아직 확인하지 못했어요. 아래 버튼으로 안전하게 다시 확인해 주세요.');
      }
      setPendingCreation(null);
      try { localStorage.removeItem(eventDraftKey(attempt.scope, attempt.requestId)); } catch { /* Replaying a retained receipt cannot duplicate an event. */ }
      finishSave(body.event, attempt.reminders, attempt.remember);
    } catch (error) {
      if (latestEventScope.current !== attempt.scope) return;
      setSaveError(controller.signal.aborted ? '응답이 늦어 저장 결과를 확인하지 못했어요. 아래 버튼으로 안전하게 다시 확인해 주세요.' : error instanceof TypeError ? '연결이 끊겨 저장 결과를 확인하지 못했어요. 연결 후 아래 버튼으로 확인해 주세요.' : error instanceof Error ? error.message : '저장 결과를 다시 확인해 주세요.');
    } finally { window.clearTimeout(timeout); savingRef.current = false; setIsSaving(false); }
  }

  function finishSave(storedEvent: StoredEventResponse, initialReminders: InitialReminderChoice | null, remember: boolean) {
    let preferenceSaved = true;
    if (!editingSchedule && initialReminders) {
      try {
        if (remember) window.localStorage.setItem(INITIAL_REMINDER_PREFERENCE_KEY, JSON.stringify({ version: 1, ...initialReminders }));
        else if (initialReminderChoice) window.localStorage.removeItem(INITIAL_REMINDER_PREFERENCE_KEY);
      } catch { preferenceSaved = false; }
    }
    const saved = toScheduleItem(storedEvent);
    setSchedules((items) =>
      sortSchedules(
        editingSchedule
          ? items.map((item) => (item.id === editingSchedule.id ? saved : item))
          : isSampleMode
            ? [saved]
            : [...items.filter(item => item.id !== saved.id), saved],
      ),
    );
    setSelectedId(saved.id);
    const savedOccurrence = (editingSchedule ? resolveOccurrence(saved, selectedViewDate) : null) ?? relevantResolvedOccurrence(saved);
    const savedDate = savedOccurrence?.originalDate ?? savedCalendarDate(saved, editingSchedule, selectedViewDate, pushNow);
    setSelectedOccurrence({ id: saved.id, date: savedDate });
    if (saved.storageId) {
      try { window.localStorage.setItem(RESUME_KEY,JSON.stringify({version:1,eventId:saved.storageId,originalDate:savedDate,section:'summary'})); } catch { /* Optional navigation preference. */ }
    }
    setResumeBookmark(null);
    setCalendarReveal((current) => ({ date: savedOccurrence?.start ?? savedDate, sequence: (current?.sequence ?? 0) + 1 }));
    setDetailOpen(true);
    setDetailFocusRequest(null);
    setRecoveryContext(null); setNotificationEntry(null);
    setDetailView('preparation');
    setIsSampleMode(false);
    setSavedGuide(editingSchedule ? null : { id: saved.id, date: savedDate });
    savingRef.current = false;
    setIsSaving(false);
    closeEditor();
    requestAnimationFrame(() => {
      const destination = !editingSchedule ? document.getElementById('saved-event-guide') : detailScrollRef.current;
      destination?.focus({ preventScroll: true });
      detailScrollRef.current?.scrollTo({ top: 0 });
      if (window.matchMedia('(max-width: 1199px)').matches) window.scrollTo({ top: 0, behavior: 'instant' });
    });
    setFeedback(!preferenceSaved ? '일정은 저장했지만, 이 브라우저에 기본 알림 설정을 기억하지 못했어요.' : editingSchedule ? '일정을 수정했어요.' : initialReminders?.mode === 'none' ? '자동 알림 없이 일정을 저장했어요.' : `일정과 알림 ${saved.reminderRules?.length ?? 0}개를 저장했어요.`);
    growth.refresh();
  }

  async function handleDelete() {
    if (!deleteTarget?.storageId) return;
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/events/${deleteTarget.storageId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('delete-failed');
      const remaining = schedules.filter((item) => item.id !== deleteTarget.id);
      if (remaining.length === 0) {
        setSchedules(initialSchedules);
        setSelectedId(initialSchedules[0].id);
        setIsSampleMode(true);
      } else {
        setSchedules(remaining);
        setSelectedId(remaining[0].id);
      }
      setDeleteTarget(null);
      setFeedback('일정을 삭제했어요.');
      growth.refresh();
    } catch {
      setFeedback('일정을 삭제하지 못했어요.');
    } finally {
      setIsDeleting(false);
    }
  }

  async function togglePreparation(
    scheduleId: number,
    item: ScheduleItem['preparations'][number],
  ) {
    if (item.id && selected.storageId) {
      const completing = !isPreparationComplete(item);
      const before = growth.progress;
      const result = await growth.complete('preparation', item.id, completing);
      if (result) setFeedback(completing ? growthCompletionFeedback(before, result.progress, 'preparation', result.awardedXp) ?? '이 회차의 준비 기록을 저장했어요. 경험치는 첫 완료에 한 번 지급돼요.' : '준비 완료 체크를 취소했어요. 획득한 경험치는 유지돼요.');
      return;
    }
    const key = preparationKey(scheduleId, item);
    const wasComplete = completed.includes(key);
    setCompleted((items) =>
      wasComplete ? items.filter((value) => value !== key) : [...items, key],
    );

    setFeedback('예시 일정이에요. 내 일정을 추가하면 완료 상태가 자동 저장돼요.');
  }

  function beginReminderChange() {
    if (reminderBusyRef.current) return false;
    reminderBusyRef.current = true;
    setReminderBusy(true);
    return true;
  }

  function endReminderChange() {
    reminderBusyRef.current = false;
    setReminderBusy(false);
  }

  function applyReminderRules(scheduleId: number, rules: ReminderRule[]) {
    const changedEventId = schedules.find((item) => item.id === scheduleId)?.storageId;
    setSchedules((items) => items.map((item) => item.id === scheduleId ? {
      ...item, reminderRules: rules, reminderPreset: matchReminderPreset(rules),
      reminders: rules.map((rule) => formatReminder(rule.offset_minutes)),
    } : item));
    setNextReminder((current) => current?.eventId === changedEventId ? null : current);
    refreshStoredSchedule(scheduleId, changedEventId);
  }

  function refreshStoredSchedule(scheduleId: number, changedEventId?: number) {
    if (!changedEventId) return;
    const version = (scheduleRefreshVersions.current.get(scheduleId) ?? 0) + 1;
    scheduleRefreshVersions.current.set(scheduleId, version);
    setRefreshingScheduleIds((ids) => new Set(ids).add(scheduleId));
    // Refresh the full snapshot: attaching a newer revision to stale fields is unsafe.
    void fetch('/api/events', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error('schedule-refresh-failed');
      const body = await response.json() as { events: StoredEventResponse[] };
      const refreshed = body.events.find((item) => item.id === changedEventId);
      if (refreshed) setSchedules((items) => items.map((item) => item.id === scheduleId && (item.revision ?? 0) <= refreshed.notification_revision ? toScheduleItem(refreshed) : item));
    }).catch(() => { setFeedback('변경은 저장됐지만 최신 일정을 불러오지 못했어요. 새로고침 후 수정해 주세요.'); })
      .finally(() => {
        if (scheduleRefreshVersions.current.get(scheduleId) === version) setRefreshingScheduleIds((ids) => { const next = new Set(ids); next.delete(scheduleId); return next; });
      });
  }

  async function changeReminderPreset(preset: ReminderPreset) {
    if (!selected.storageId) {
      setFeedback('내 일정을 먼저 추가하면 알림 강도를 저장할 수 있어요.');
      return;
    }

    if (!beginReminderChange()) return;
    try {
      const response = await fetch(`/api/events/${selected.storageId}/reminders`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preset }),
      });
      if (!response.ok) throw new Error('preset-failed');
      const result = (await response.json()) as { reminders: ReminderRule[] };
      applyReminderRules(selected.id, result.reminders);
      setFeedback(`${reminderPresetOptions.find((item) => item.id === preset)?.label} 알림으로 저장했어요.`);
    } catch { setFeedback('알림 설정을 저장하지 못했어요.'); }
    finally { endReminderChange(); }
  }

  async function addRecommendationReminder(recommendation: EventRecommendation) {
    if (!selected.storageId) {
      setFeedback('내 일정을 추가하면 추천 시점을 알림으로 저장할 수 있어요.');
      openCreate();
      return;
    }

    if (!beginReminderChange()) return;
    try {
      const response = await fetch(`/api/events/${selected.storageId}/reminders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ offsetMinutes: recommendation.offsetMinutes }),
      });
      if (!response.ok) throw new Error('recommendation-reminder-failed');
      const result = (await response.json()) as { reminders: ReminderRule[] };
      applyReminderRules(selected.id, result.reminders);
      setFeedback(`${formatReminder(recommendation.offsetMinutes)} 알림을 추가했어요.`);
    } catch {
      setFeedback('추천 알림을 저장하지 못했어요.');
    } finally {
      endReminderChange();
    }
  }

  async function schedulePushTest(mode: 'immediate' | 'scheduled' | 'enable' = 'scheduled', target = selected) {
    if (pushBusyRef.current || isSchedulingPush) return;
    if (!target.storageId && mode !== 'enable') {
      setFeedback('테스트할 내 일정을 먼저 추가해 주세요.');
      openCreate();
      return;
    }
    const iosTab = browserPlatform(navigator.userAgent, navigator.maxTouchPoints) === 'ios' && !window.matchMedia('(display-mode: standalone)').matches && !(navigator as Navigator & { standalone?: boolean }).standalone;
    if (iosTab) {
      setPushError('iPhone·iPad에서는 홈 화면에 추가한 J에게를 열고 알림을 켜 주세요. 알림 메뉴에 설치 안내가 있어요.');
      return;
    }
    if (!('Notification' in window)) {
      setPushError('이 환경은 웹 알림을 지원하지 않아요. 알림 메뉴의 설치·수신 안내를 확인해 주세요.');
      return;
    }
    if (!window.isSecureContext) {
      setPushError('알림은 안전한 HTTPS 주소에서만 사용할 수 있어요. 배포된 사이트 주소에서 열어 주세요.');
      return;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushError('이 브라우저는 백그라운드 알림을 지원하지 않아요. 최신 Chrome에서 다시 시도해 주세요.');
      return;
    }
    if (Notification.permission === 'denied') {
      setNotificationPermission('denied');
      setPushError('알림이 차단되어 있어요. 주소창 왼쪽의 사이트 설정에서 알림을 허용한 뒤 새로고침해 주세요.');
      return;
    }

    const eventStorageId = target.storageId;
    const requestKey = `${eventStorageId}:${mode}`;
    let idempotencyKey = pushIdempotencyKeys.current.get(requestKey);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      pushIdempotencyKeys.current.set(requestKey, idempotencyKey);
    }

    pushBusyRef.current = true;
    diagnostics.cancelReads();
    setIsSchedulingPush(true);
    setPushError(null);
    setPushPollWarning(null);
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission !== 'granted') {
        setPushError(
          permission === 'denied'
            ? '알림이 차단되어 있어요. 주소창 왼쪽의 사이트 설정에서 알림을 허용한 뒤 새로고침해 주세요.'
            : '예약 알림을 받으려면 브라우저의 알림 허용을 선택해 주세요.',
        );
        return;
      }

      await withPushTimeout(navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      }));
      const readyRegistration = await withPushTimeout(navigator.serviceWorker.ready);

      const publicKeyResponse = await fetch('/api/push/public-key', { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
      if (!publicKeyResponse.ok) {
        throw new Error(
          publicKeyResponse.status === 503
            ? '알림 서버를 준비하는 중이에요. 잠시 후 다시 시도해 주세요.'
            : '알림 연결 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
        );
      }
      const publicKeyResult: unknown = await publicKeyResponse.json();
      const ready = isRecord(publicKeyResult) && isRecord(publicKeyResult.scheduler) && publicKeyResult.scheduler.ready === true;
      diagnostics.setServer(ready ? 'ready' : 'delayed');
      if (mode === 'scheduled' && !ready) {
        throw new Error('예약 알림 연결이 아직 완료되지 않았어요. 지금 테스트는 사용할 수 있어요.');
      }
      const publicKey = isRecord(publicKeyResult)
        ? getString(publicKeyResult.publicKey) ?? getString(publicKeyResult.public_key)
        : null;
      if (!publicKey) {
        throw new Error('알림 서버 설정을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
      }

      let subscription = await withPushTimeout(readyRegistration.pushManager.getSubscription());
      if (subscription?.expirationTime != null && subscription.expirationTime <= Date.now()) {
        await withPushTimeout(subscription.unsubscribe()); subscription = null;
      }
      if (!subscription) {
        subscription = await withPushTimeout(readyRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));
      }

      const subscriptionResponse = await fetch('/api/push/subscriptions', {
        method: 'POST',
        signal: AbortSignal.timeout(12_000),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!subscriptionResponse.ok) {
        throw new Error(
          subscriptionResponse.status === 401
            ? '로그인 상태가 만료됐어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.'
            : '이 브라우저를 알림 수신 기기로 등록하지 못했어요. 다시 시도해 주세요.',
        );
      }
      const savedSubscription = await subscriptionResponse.json();
      const subscriptionId = isRecord(savedSubscription) && isRecord(savedSubscription.subscription) ? Number(savedSubscription.subscription.id) : NaN;
      if (!Number.isSafeInteger(subscriptionId) || subscriptionId < 1) throw new Error('기기 등록 결과를 확인하지 못했어요.');
      setPushDevice({ id: subscriptionId, enabled: isRecord(savedSubscription) && isRecord(savedSubscription.subscription) && !!savedSubscription.subscription.reminders_enabled_at });
      diagnostics.setDeviceState('ready');
      if (mode === 'enable') {
        await updateDevicePreference(subscriptionId, true);
        pushIdempotencyKeys.current.delete(requestKey);
        return;
      }

      const response = await fetch(`/api/events/${eventStorageId}/notifications/schedule-test`, {
        method: 'POST',
        signal: AbortSignal.timeout(12_000),
        headers: { 'Idempotency-Key': idempotencyKey, 'content-type': 'application/json' },
        body: JSON.stringify({ subscriptionId, mode }),
      });
      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? '선택한 일정을 찾지 못했어요. 페이지를 새로고침해 주세요.'
            : '테스트 알림을 예약하지 못했어요. 잠시 후 다시 시도해 주세요.',
        );
      }
      const result: unknown = await response.json();
      const job = isRecord(result) ? normalizePushJob(result.job) : null;
      if (!job) throw new Error('예약 결과를 확인하지 못했어요. 다시 시도해 주세요.');

      pushIdempotencyKeys.current.delete(requestKey);
      notificationMutationVersion.current += 1;
      setNotificationRequestVersion(value => value + 1);
      setPushNow(() => Date.now());
      setPushTest({ scheduleId: target.id, scheduleTitle: target.title, job });
      setFeedback(mode === 'scheduled' ? '약 2분 뒤 테스트 알림을 예약했어요.' : '테스트 발송 결과를 확인해 주세요.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setPushError('브라우저가 알림 등록을 차단했어요. 사이트 설정에서 알림을 허용한 뒤 다시 시도해 주세요.');
      } else if (error instanceof DOMException && error.name === 'NotSupportedError') {
        setPushError('이 환경에서는 백그라운드 알림을 사용할 수 없어요. 최신 Chrome에서 다시 시도해 주세요.');
      } else {
        setPushError(
          error instanceof Error
            ? error.message
            : '테스트 알림을 예약하지 못했어요. 잠시 후 다시 시도해 주세요.',
        );
      }
    } finally {
      pushBusyRef.current = false;
      setIsSchedulingPush(false);
    }
  }

  async function updateDevicePreference(subscriptionId: number, enabled: boolean) {
    const response = await fetch('/api/push/subscriptions', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(12_000),
      body: JSON.stringify({ subscriptionId, enabled }),
    });
    if (!response.ok) throw new Error('기기의 일정 알림 설정을 저장하지 못했어요. 다시 시도해 주세요.');
    const result = await response.json();
    if (!isRecord(result) || !isRecord(result.subscription)) throw new Error('기기 설정 결과를 확인하지 못했어요.');
    setPushDevice({ id: subscriptionId, enabled: !!result.subscription.reminders_enabled_at });
    setFeedback(enabled ? '이 기기에서 내 일정의 알림을 받아요.' : '이 기기의 일정 알림을 껐어요.');
  }

  async function toggleDeviceReminders() {
    if (pushBusyRef.current || isSchedulingPush) return;
    if (!pushDevice?.enabled) { await schedulePushTest('enable'); return; }
    pushBusyRef.current = true;
    diagnostics.cancelReads();
    setIsSchedulingPush(true);
    setPushError(null);
    try { await updateDevicePreference(pushDevice.id, false); }
    catch (error) { setPushError(error instanceof Error ? error.message : '다시 시도해 주세요.'); }
    finally { pushBusyRef.current = false; setIsSchedulingPush(false); }
  }

  async function updatePushJob(action: 'ack' | 'snooze', minutes: SnoozeMinutes = 10) {
    if (!visiblePushTest || isSchedulingPush) return;
    const actionSelection = selectionRef.current;
    const actionJobId = visiblePushTest.job.id;
    notificationMutationVersion.current += 1;
    setIsSchedulingPush(true);
    try {
      const response = await fetch(`/api/notifications/jobs/${visiblePushTest.job.id}/${action}`, { method: 'POST', ...(action === 'snooze' ? {headers:{'content-type':'application/json'},body:JSON.stringify({minutes})} : {}) });
      if (!response.ok) throw new Error('알림 상태를 변경하지 못했어요. 로그인 상태를 확인해 주세요.');
      const result = await response.json();
      const job = isRecord(result) ? normalizePushJob(result.job) : null;
      if (job) setPushTest(current => current?.job.id === actionJobId && current.scheduleId === visiblePushTest.scheduleId ? { ...current, job } : current);
      if (selectionRef.current === actionSelection) {
        if (job) setFeedback(action === 'snooze' ? `${minutes}분 뒤 다시 알리도록 요청했어요. 일정 날짜와 시간은 그대로예요.` : '알림을 확인했어요. 계획 완료와는 별도예요.');
        setPushNow(Date.now());
        setPushError(null);
      }
    } catch (error) {
      if (selectionRef.current === actionSelection) setPushError(error instanceof Error ? error.message : '다시 시도해 주세요.');
    } finally {
      notificationMutationVersion.current += 1;
      setNotificationRequestVersion(value => value + 1);
      setIsSchedulingPush(false);
    }
  }

  function navigateWorkspace(view: WorkspaceView) {
    setSavedGuide(null);
    setDetailFocusRequest(null);
    setRecoveryContext(null); setNotificationEntry(null);
    setWorkspaceView(view);
    setDetailOpen(false);
    if (view === 'notifications') setDetailView('reminders');
    else setDetailView('preparation');
    window.requestAnimationFrame(() => {
      document.getElementById('workspace-title')?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
  }

  async function changeOccurrence(action: 'edit' | 'cancel' | 'restore', originalDate: string, changes?: OccurrenceChanges) {
    if (!selectedMaster.storageId || occurrenceBusyRef.current || isScheduleEditBlocked(selectedMaster.id)) return;
    occurrenceBusyRef.current = true; setOccurrenceBusy(true); setOccurrenceError(null);
    const selectionAtStart = selectionRef.current;
    try {
      const response = await fetch(`/api/events/${selectedMaster.storageId}/occurrences`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, originalDate, changes, revision: selectedMaster.revision }),
      });
      const body = await response.json() as { event?: StoredEventResponse; error?: string };
      if (!response.ok || !body.event) throw new Error(body.error ?? '저장하지 못했어요. 다시 시도해 주세요.');
      const saved = toScheduleItem(body.event);
      setSchedules((items) => items.map((item) => item.id === saved.id ? saved : item));
      const resolved = resolveOccurrence(saved, originalDate) ?? relevantResolvedOccurrence(saved);
      if (selectionRef.current.id === selectionAtStart.id && selectionRef.current.date === selectionAtStart.date) {
        setSelectedOccurrence(resolved ? { id: saved.id, date: resolved.originalDate } : null);
        if (resolved) setCalendarReveal((current) => ({ date: resolved.start, sequence: (current?.sequence ?? 0) + 1 }));
      }
      if (action !== 'restore') closeOccurrenceEditor();
      setNextReminder(null); growth.refresh();
      setFeedback(action === 'cancel' ? '이번 회차와 남은 알림을 취소했어요. 완료 기록과 경험치는 유지돼요.' : action === 'restore' ? '원래 일정으로 복구했어요.' : '이번 회차만 수정했어요. 알림도 새 시간에 맞췄어요.');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '저장하지 못했어요.';
      setOccurrenceError(message);
      if (action === 'edit') throw reason;
    } finally { occurrenceBusyRef.current = false; setOccurrenceBusy(false); }
  }

  function selectSchedule(scheduleId: number, date: string, destination: DetailDestination = 'summary') {
    setSavedGuide(null);
    selectedTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedId(scheduleId);
    setSelectedOccurrence({ id: scheduleId, date });
    setDetailOpen(true);
    setPushError(null);
    setRecoveryContext(null); setNotificationEntry(null); setResumeBookmark(null);
    setDetailView(destination === 'reminders' ? 'reminders' : 'preparation');
    setDetailFocusRequest({ target: destination === 'preparations' ? 'preparation-checklist-title' : destination === 'reminders' ? 'device-reminder-settings' : destination === 'place' ? 'event-place-section' : 'event-details' });
    rememberLocation(scheduleId,date,destination);
  }

  function rememberLocation(id:number,date:string,section:DetailDestination) {
    const item = schedules.find(item=>item.id===id);
    if (!item?.storageId || item.isSample || !resolveOccurrence(item,date)) return;
    try { window.localStorage.setItem(RESUME_KEY,JSON.stringify({version:1,eventId:item.storageId,originalDate:date,section})); } catch { /* Optional device-local navigation only. */ }
  }

  function dismissResume() {
    setResumeBookmark(null);
    try { window.localStorage.removeItem(RESUME_KEY); } catch { setFeedback('이 브라우저의 기억을 지우지 못했어요. 브라우저 저장소 설정을 확인해 주세요.'); }
  }

  function openRecovery(id:number,date:string) {
    selectSchedule(id,date);
    setRecoveryContext({id,date});
    setDetailFocusRequest({target:'recovery-actions'});
  }

  function openFollowup() {
    const suffix = ' · 후속 연락';
    const title = `${selected.title.slice(0,100-suffix.length)}${suffix}`;
    const note = `${formatEventRange(selected,selectedDisplayDate)}의 기념일을 위한 후속 계획이에요. 원래 기념일 날짜는 바꾸지 않아요.`.slice(0,500);
    openCreate(getSeoulDate());
    setNewEventDraft({title,note});
  }

  function focusDestination(destination:DetailDestination) {
    setDetailView(destination==='reminders'?'reminders':'preparation');
    setDetailFocusRequest({target:destination==='preparations'?'preparation-checklist-title':destination==='place'?'event-place-section':destination==='reminders'?'device-reminder-settings':'event-action-guide'});
    rememberLocation(selected.id,selectedViewDate,destination);
  }

  function focusPreparations() {
    setSavedGuide(null);
    setDetailView('preparation');
    setDetailFocusRequest({ target: selected.preparations.length === 0 && nextResolved?.originalDate === selectedViewDate ? 'recommendations-title' : 'preparation-checklist-title' });
    rememberLocation(selected.id,selectedViewDate,'preparations');
  }

  async function completeSelectedEvent(complete: boolean) {
    if (selected.isSample || !selectedResolved || isScheduleEditBlocked(selected.id) || growth.busy || growth.error || !growth.occurrence || (complete && !growth.occurrence.canCompleteEvent)) return;
    const selectionAtStart = selectionRef.current;
    const before = growth.progress;
    const result = await growth.complete('event', 0, complete);
    if (!result) {
      if (selectionRef.current === selectionAtStart) setDetailFocusRequest({ target: 'event-action-guide' });
      return;
    }
    setFeedback(result.occurrence.complete ? growthCompletionFeedback(before, result.progress, 'event', result.awardedXp) ?? '이 회차를 완료했어요. 경험치는 첫 완료에 한 번 지급돼요.' : '완료 체크를 취소했어요. 획득한 경험치는 유지돼요.');
    if (selectionRef.current === selectionAtStart) {
      setSavedGuide(null);
      setDetailFocusRequest({ target: 'event-action-guide' });
    }
  }

  function closeDetails() {
    setSavedGuide(null);
    setDetailOpen(false);
    window.requestAnimationFrame(() => selectedTriggerRef.current?.isConnected
      ? selectedTriggerRef.current.focus() : document.getElementById('workspace-title')?.focus());
  }

  function openNotificationDiagnostics() {
    navigateWorkspace('notifications');
    requestAnimationFrame(() => {
      const heading = document.getElementById('notification-diagnostics-title');
      heading?.focus({ preventScroll: true }); heading?.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
  }

  return (
    <div className={`app-shell ${detailOpen ? 'has-open-detail' : ''} ${workspaceView !== 'calendar' && !detailOpen ? 'has-focused-workspace' : ''}`}>
      <a href="#workspace-main" className="skip-link">본문으로 바로가기</a>
      <aside className="app-sidebar" aria-label="나의 공간" inert={modalOpen}>
        <button type="button" className="brand" onClick={() => navigateWorkspace('today')} aria-label="J에게 오늘">
          <span className="brand-mark">J</span><span>J에게<small>TO J, WITH CARE</small></span>
        </button>
        <p className="nav-label">MY SPACE</p>
        <nav className="side-navigation" aria-label="주 메뉴">{workspaceNavigation.map((item) => <button type="button" key={item.id} aria-current={workspaceView === item.id ? 'page' : undefined} onClick={() => navigateWorkspace(item.id)}><AppIcon name={item.icon} /><span>{item.label}</span></button>)}</nav>
        <Link href="/growth" className="sidebar-growth" aria-label="나의 성장 상세 보기">
          <AppIcon name="leaf" size={26} /><p>작은 준비가 쌓이면<br />하루가 여유로워져요.</p>
          {currentGrowth ? <><span className="sidebar-growth-level">{currentGrowth.stage}<small>Lv. {currentGrowth.level}<span className="sidebar-growth-title">{currentGrowth.levelName}</span></small></span><progress max={1} value={currentGrowth.progress} aria-label="현재 레벨 진행률" /><small>{currentGrowth.level === 50 ? 'J에 도착했어요' : `다음 레벨까지 ${currentGrowth.remaining} XP`}</small></> : <small>나의 실천 기록 보기 <AppIcon name="arrow" size={14} /></small>}
        </Link>
        <Link href="/profile" className="sidebar-footer profile-entry" aria-label="내 프로필 설정"><span aria-hidden="true">{account.snapshot?.profile?.nickname.slice(0, 1) ?? <AppIcon name="person" size={19} />}</span><div>{account.snapshot?.profile?.nickname ?? '내 프로필'}<small>{account.snapshot?.profile ? `@${account.snapshot.profile.username}` : '아이디·닉네임 설정'}</small></div></Link>
      </aside>
      <header className="app-header" inert={modalOpen}>
        <div className="app-header-inner">
          {detailOpen ? <button type="button" className="mobile-detail-back" onClick={closeDetails} aria-label={`${activeWorkspace.label} 화면으로 돌아가기`}><AppIcon name="left" size={22} /><span>{activeWorkspace.label}</span></button> : <button type="button" className="mobile-brand brand" onClick={() => navigateWorkspace('today')}><span className="brand-mark">J</span>J에게</button>}
          <p className="breadcrumb">나의 공간<span>/ {activeWorkspace.label}</span></p>
          <div className="header-actions">
            <Link href="/profile" className="header-profile" aria-label="내 프로필 설정"><AppIcon name="person" size={20} /></Link>
            <button type="button" className="header-notification" onClick={openNotificationDiagnostics} aria-label="알림 상태 점검 보기"><AppIcon name="bell" size={20} /><span className={deviceDiagnosis.tone === 'good' ? 'device-on' : 'device-off'}>{deviceDiagnosis.tone === 'good' ? '수신 설정됨' : !diagnostics.browser || diagnostics.deviceState === 'checking' || diagnostics.server === 'checking' ? '확인 중' : deviceDiagnosis.tone === 'warning' ? '알림 점검' : '알림 꺼짐'}</span></button>
            <button type="button" onClick={() => openCreate()} className="primary-button desktop-create"><AppIcon name="plus" size={19} /><span>일정 추가</span></button>
          </div>
        </div>
      </header>

      <main id="workspace-main" className="app-layout" tabIndex={-1} inert={modalOpen}>
        {isOffline && <div className="connection-notice" role="status"><strong>인터넷 연결이 끊겼어요</strong><p>화면의 정보가 최신이 아닐 수 있어요. 변경 사항은 자동 저장되지 않으니 다시 연결한 뒤 저장해 주세요.</p></div>}
        <div className="workspace-heading">
          <div><h1 id="workspace-title" tabIndex={-1}>{activeWorkspace.label}</h1><p className="workspace-description">{activeWorkspace.description}</p></div>
          <span className="date-pill">{calendarDateLabel(getSeoulDate(new Date(pushNow)))}</span>
        </div>
        {eventsLoading && <p className="workspace-status" role="status">저장한 일정을 불러오고 있어요…</p>}
        {eventsLoadError && <div className="workspace-status is-error" role="alert"><span>저장한 일정을 불러오지 못했어요. 현재 화면은 예시일 수 있어요.</span><button type="button" className="text-button" onClick={() => { setEventsLoading(true); setEventsLoadError(false); setEventsVersion((value) => value + 1); }}>다시 시도</button></div>}
        <div className="workspace-stack">
          <div hidden={workspaceView !== 'notifications'}>
            <NotificationDiagnostics {...diagnostics} busy={isSchedulingPush} error={pushError}
              events={schedules.filter(item => !!item.storageId).map(item => ({ id: item.id, title: item.title }))} eventsReady={!eventsLoading && !eventsLoadError}
              onRefresh={() => void diagnostics.refresh()} onToggle={() => void toggleDeviceReminders()} onCreate={() => openCreate()}
              onTest={(mode, id) => { const target = schedules.find(item => item.id === id && item.storageId); if (target) void schedulePushTest(mode, target); }}
              latestTest={pushTest && pushTest.job.kind !== 'reminder' ? { title: pushTest.scheduleTitle, status: getPushStatus(pushTest.job.status).label, detail: getPushStatus(pushTest.job.status).detail, scheduledFor: formatPushTime(pushTest.job.scheduledFor) } : null}
              testWarning={pushPollWarning} onTestRefresh={() => { setPushPollWarning(null); setNotificationRequestVersion(value => value + 1); }}
              onTestDetails={() => { const target = schedules.find(item => item.id === pushTest?.scheduleId); if (pushTest && target) selectSchedule(target.id, pushTest.job.originalDate ?? relevantResolvedOccurrence(target, getSeoulDate())?.originalDate ?? target.eventDate, 'reminders'); }}
            />
          </div>
          <div hidden={workspaceView !== 'calendar'}>
            <PreparationBand schedules={schedules} now={pushNow} completedEvents={growth.progress?.completedEvents} onSelect={(id, date) => selectSchedule(id, date, 'preparations')} />
            <CalendarWorkspace key={calendarReveal?.sequence ?? 0} schedules={schedules} selectedId={selectedId} selectedDate={selectedViewDate} reveal={calendarReveal} now={pushNow} isSampleMode={isSampleMode} onSelect={selectSchedule} onCreate={openCreate} completedEvents={growth.progress?.completedEvents} colorSettings={categoryColors} isOffline={isOffline} onBulkChanged={() => { setEventsVersion(value => value + 1); growth.refresh(); setNextReminder(null); setNotificationRequestVersion(value => value + 1); }} />
            <UpcomingStrip schedules={schedules} now={pushNow} onSelect={selectSchedule} completedEvents={growth.progress?.completedEvents} />
          </div>
          {workspaceView !== 'calendar' && <>
            {workspaceView === 'today' && resumeBookmark && !eventsLoading && !eventsLoadError && growth.progress && !growth.error && <ResumeCard bookmark={resumeBookmark} schedules={isSampleMode?[]:schedules} completed={growth.progress.completedEvents} onResume={selectSchedule} onDismiss={dismissResume} />}
            {workspaceView === 'today' && isSampleMode && !eventsLoading && !eventsLoadError ? <section className="first-plan-card" aria-labelledby="first-plan-title">
              <span className="first-plan-mark" aria-hidden="true">J</span><h2 id="first-plan-title">첫 계획을 담아 볼까요?</h2>
              <p>일정을 적고, 필요한 만큼 준비하고, 하나씩 실천해요.</p>
              <div><button type="button" className="primary-button" onClick={() => openCreate()}>첫 일정 만들기<AppIcon name="plus" size={17} /></button><button type="button" className="text-button" onClick={() => navigateWorkspace('calendar')}>예시 캘린더 둘러보기<AppIcon name="arrow" size={17} /></button></div>
              <small>알림 권한은 원할 때 설정할 수 있어요.</small>
            </section> : !eventsLoading && !eventsLoadError && <WorkspaceOverview view={workspaceView} schedules={isSampleMode ? [] : schedules} now={pushNow} selectedId={selectedId} onSelect={(id, date) => selectSchedule(id, date, workspaceView === 'notifications' ? 'reminders' : 'summary')} onPrepare={(id, date) => selectSchedule(id, date, 'preparations')} onCreate={openCreate} deviceLoaded={deviceLoaded} deviceEnabled={!!pushDevice?.enabled} onDeviceSettings={openNotificationDiagnostics} hideDeviceCard completedEvents={growth.progress?.completedEvents ?? []} accountScope={eventScope} completionVersion={growth.revision} onCompletionChanged={growth.refresh} onSchedulesReload={() => { setEventsVersion(value => value + 1); growth.refresh(); }} offline={isOffline} />}
            {workspaceView === 'today' && !isSampleMode && !eventsLoading && !eventsLoadError && <DailyReview key={getSeoulDate(new Date(pushNow))} schedules={schedules} progress={growth.progress} error={growth.error} now={pushNow} onSelect={(id,date,prepare)=>selectSchedule(id,date,prepare?'preparations':'summary')} onRecover={openRecovery} onRetry={growth.refresh} />}
            {workspaceView === 'today' && !eventsLoading && <GrowthPanel progress={growth.progress} error={growth.error} busy={growth.busy} onGoal={growth.setGoal} onRetry={growth.refresh} />}
          </>}
        </div>

        <aside ref={detailScrollRef} id="event-details" className="detail-panel" aria-label="선택한 일정 상세" tabIndex={-1}>
          {savedGuide?.id === selected.id && savedGuide.date === selectedViewDate && <SavedEventGuide title={selected.title} preparationsEnabled={selected.preparationsEnabled !== false} reminderCount={selected.reminderRules?.length ?? 0} deviceLoaded={deviceLoaded} deviceEnabled={!!pushDevice?.enabled && notificationPermission === 'granted'} event={selected} offsets={selected.reminderRules?.map(rule => rule.offset_minutes)} now={pushNow}
            onPrepare={focusPreparations}
            onReminders={() => { setSavedGuide(null); setDetailView('reminders'); setDetailFocusRequest({ target: 'device-reminder-settings' }); }}
            onDone={() => navigateWorkspace('today')} />}
          <div className="detail-header">
            <button type="button" className="detail-back text-button" onClick={closeDetails}><AppIcon name="left" size={18} />돌아가기</button>
          <div className="detail-topline">
              <span className="detail-category" style={{ background: selected.soft, color: selected.text ?? selected.accent, borderLeft: `3px solid ${selected.accent}` }}>{selected.category}</span>
              <span className="detail-dday">{!selectedResolved ? '다가오는 회차 없음' : occurrenceDayStatus(selected, selectedDisplayDate, getSeoulDate(new Date(pushNow)), new Date(pushNow)) === 'ongoing' ? '진행 중' : getDday(selectedDisplayDate)}{selected.isSample ? ' · 예시' : ''}</span>
              {!selected.isSample && <div className="detail-edit-actions">
                <button type="button" disabled={isScheduleEditBlocked(selected.id)} onClick={() => openEdit(selectedMaster)}>{selectedMaster.recurrence === 'none' ? '수정' : '전체 수정'}</button>
                <button type="button" onClick={() => setDeleteTarget(selectedMaster)} className="delete-action">{selectedMaster.recurrence === 'none' ? '삭제' : '전체 삭제'}</button>
              </div>}
            </div>
            <h2>{selected.title}</h2>
            <p className="detail-date"><AppIcon name="calendar" size={17} /><span>{selectedResolved ? formatEventRange(selected, selectedDisplayDate) : '전체 반복 일정 · 아래에서 회차 변경 내역을 관리해요'}</span></p>
            {formatRecurrence(selectedMaster) && <p className="detail-recurrence">↻ {formatRecurrence(selectedMaster)}<span>{selectedMaster.recurrenceUntil ? `${calendarDateLabel(selectedMaster.recurrenceUntil)} 시작 회차까지` : '종료일 없음'}</span></p>}
            {notificationEntry?.id === selected.id && notificationEntry.date === selectedViewDate && <section id="notification-entry" tabIndex={-1} className="journey-action-card" aria-label="알림에서 이어하기"><h3>알림에서 이어하기</h3>
              {!entryJob ? <><p role="status">{notificationEntryStatus==='loading'?'알림 기록을 확인하고 있어요. 아래 일정 정보는 계속 확인할 수 있어요.':notificationEntryStatus==='error'?'알림 기록을 불러오지 못했어요. 일정 정보는 계속 확인할 수 있어요.':'이 회차에 연결할 알림 기록이 없어요. 현재 일정 내용을 확인해 주세요.'}</p>{notificationEntryStatus==='error' && <button type="button" className="text-button" onClick={()=>{setNotificationEntryStatus('loading');setNotificationRequestVersion(value=>value+1);}}>다시 확인</button>}<button type="button" className="text-button" onClick={()=>{setNotificationEntry(null);focusDestination('summary');}}>일정 내용 보기</button></> : <><p>{entryJob.kind!=='reminder'?'수신 확인을 위한 테스트 알림이에요.':entryJob.offsetMinutes===null?'저장한 일정 알림이에요.':entryJob.offsetMinutes>0?`${formatReminder(entryJob.offsetMinutes)}에 알려드리도록 설정한 알림이에요.`:'일정의 알림 기준 시각에 맞춘 알림이에요.'} 알림을 여는 것만으로 계획이 완료되지는 않아요.</p><button type="button" className="primary-button" onClick={()=>focusDestination(entryDestination)}>{entryDestination==='preparations'?'남은 준비 확인':entryDestination==='place'?'장소·경로 확인':entryDestination==='reminders'?'알림 상태 확인':'일정 내용 확인'}</button>
                {(entryJob.status==='sent'||entryJob.status==='unconfirmed') && <><button type="button" className="text-button" disabled={isSchedulingPush} onClick={()=>void updatePushJob('ack')}>알림 확인했어요</button><SnoozeControls disabled={isSchedulingPush||schedulerReady!==true} onSnooze={minutes=>void updatePushJob('snooze',minutes)} /></>}
                {entryJob.status==='scheduled' && <p>다시 알릴 예정 · {formatPushTime(entryJob.scheduledFor)}</p>}{entryJob.status==='acked' && <p>확인한 알림이에요.</p>}
              </>}{pushError&&<p role="alert">{pushError}</p>}</section>}
            {recoveryContext?.id === selected.id && recoveryContext.date === selectedViewDate && <section id="recovery-actions" tabIndex={-1} className="journey-action-card"><h3>이 일정을 어떻게 이어갈까요?</h3><p>실제로 마쳤다면 아래에서 완료로 기록해 주세요. 지난 계획을 오늘 처음 완료하면 경험치와 목표에는 오늘 기준으로 반영돼요.</p>
              <div>{selected.category==='기념일'?<button type="button" className="text-button" onClick={openFollowup}>날짜는 유지하고 후속 계획 만들기</button>:<button type="button" className="text-button" disabled={isScheduleEditBlocked(selected.id)} onClick={()=>selectedMaster.recurrence==='none'?openEdit(selectedMaster):openOccurrenceEditor('edit')}>{selectedMaster.recurrence==='none'?'날짜 다시 정하기':'이번 회차 날짜 다시 정하기'}</button>}<button type="button" className="text-button" onClick={()=>navigateWorkspace('today')}>그대로 두고 오늘로</button></div>
            </section>}
            {!(savedGuide?.id === selected.id && savedGuide.date === selectedViewDate) && <EventActionGuide
              isSample={!!selected.isSample} hasOccurrence={!!selectedResolved} occurrence={growth.occurrence}
              preparationsEnabled={selected.preparationsEnabled !== false} preparationCount={selected.preparations.length}
              completedPreparationCount={selected.preparations.filter(isPreparationComplete).length}
              busy={growth.busy || isScheduleEditBlocked(selected.id)} error={growth.error}
              next={continuation ? { title: continuation.item.title, range: formatEventRange(continuation.item, continuation.date) } : null}
              onPrepare={focusPreparations} onComplete={(complete) => void completeSelectedEvent(complete)} onToday={() => navigateWorkspace('today')}
              onNext={() => { if (continuation) { setDetailView('preparation'); selectSchedule(continuation.item.id, continuation.originalDate); } }}
              onCreate={() => openCreate()} onRetry={growth.refresh} />}
            {!selected.isSample && selectedMaster.recurrence !== 'none' && <section className="occurrence-controls" aria-label="반복 회차 관리">
              {selectedResolved && <>
                <p>{selectedMaster.occurrenceOverrides?.some((o) => o.originalDate === selectedViewDate && o.changes) ? `변경된 회차 · 원래 ${calendarDateLabel(selectedViewDate)}` : '선택한 회차만 변경할 수 있어요.'}</p>
                <div className="occurrence-actions">
                  <button type="button" disabled={isScheduleEditBlocked(selected.id)} onClick={() => openOccurrenceEditor('edit')}>이번 회차 수정</button>
                  <button type="button" disabled={isScheduleEditBlocked(selected.id)} onClick={() => openOccurrenceEditor('cancel')}>이번 회차 취소</button>
                </div>
              </>}
              {!!selectedMaster.occurrenceOverrides?.some((o) => o.cancelled || o.changes) && <details>
                <summary>변경·취소한 회차 {selectedMaster.occurrenceOverrides.filter((o) => o.cancelled || o.changes).length}개</summary>
                <ul>{selectedMaster.occurrenceOverrides.filter((o) => o.cancelled || o.changes).map((o) => <li key={o.originalDate}>
                  <span>{calendarDateLabel(o.originalDate)}<small>{o.cancelled ? '취소됨' : `→ ${calendarDateLabel(o.changes!.eventDate)} · ${o.changes!.title}`}{selectedMaster.recurrenceUntil && o.originalDate > selectedMaster.recurrenceUntil ? ' · 반복 종료일 이후' : ''}</small></span>
                  <button type="button" disabled={isScheduleEditBlocked(selected.id)} onClick={() => void changeOccurrence('restore', o.originalDate)}>원래대로</button>
                </li>)}</ul>
              </details>}
              {occurrenceError && !occurrenceAction && <p role="alert">{occurrenceError}</p>}
            </section>}
            {selected.allDay && <p className="detail-recurrence">알림 기준 · 시작일 {selected.allDayReminderTime ?? '09:00'} (한국 시간)</p>}
            {selected.location && <div id="event-place-section" tabIndex={-1}><EventPlace key={`${selected.id}:${JSON.stringify(selected.place)}:${JSON.stringify(selected.travelPlan)}`} location={selected.location} place={selected.place} travelPlan={selected.travelPlan} eventId={selected.storageId} /></div>}
            {selected.note && <p className="detail-note">{selected.note}</p>}

          </div>
          <div className="detail-tabs" aria-label="일정 상세 보기">
            <button type="button" aria-pressed={detailView === 'preparation'} aria-controls="preparation-content" onClick={() => { setDetailView('preparation'); rememberLocation(selected.id,selectedViewDate,selected.preparationsEnabled===false?'summary':'preparations'); }}><AppIcon name={selected.preparationsEnabled === false ? 'calendar' : 'check'} size={18} />{selected.preparationsEnabled === false ? '일정 정보' : <>준비<span>{selected.preparations.filter(isPreparationComplete).length}/{selected.preparations.length}</span></>}</button>
            <button type="button" aria-pressed={detailView === 'reminders'} aria-controls="reminders-content" onClick={() => { setDetailView('reminders'); rememberLocation(selected.id,selectedViewDate,'reminders'); }}><AppIcon name="bell" size={18} />알림<span>{selected.reminders.length}</span></button>
          </div>

          <div className="detail-content">
          {nextResolved && selectedViewDate !== nextResolved.originalDate && <p className="occurrence-notice">선택한 날짜의 반복 일정이에요. 추천과 알림은 현재 또는 다음 회차인 {calendarDateLabel(selectedUpcomingDate)} 기준으로 안내해요.</p>}
          {!nextResolved && <p className="occurrence-notice">{selectedMaster.recurrence === 'none' ? '지난 일정이에요. 완료 기록과 준비 항목은 계속 확인할 수 있어요.' : '다가오는 회차가 없어요. 지난 기록은 유지되며, 반복 종료일과 변경·취소 내역은 전체 일정에서 관리할 수 있어요.'}</p>}
          <div id="preparation-content" hidden={detailView !== 'preparation'}>
          <PreparationPreference key={`preference:${selected.id}`} eventId={selected.storageId} enabled={selected.preparationsEnabled !== false}
            disabled={isScheduleEditBlocked(selected.id)}
            onBusyChange={(busy) => setPreferencePendingIds((ids) => {
              const next = new Set(ids);
              if (busy) next.add(selected.id); else next.delete(selected.id);
              return next;
            })}
            onSaved={(enabled) => {
              setSchedules((items) => items.map((item) => item.id === selected.id ? { ...item, preparationsEnabled: enabled } : item));
              refreshStoredSchedule(selected.id, selected.storageId);
            }}
            onFeedback={setFeedback} />
          {selected.preparationsEnabled !== false && <>
          {!selected.isSample && <p className="editor-help">준비 완료는 선택한 회차에 기록돼요.</p>}
          <PreparationEditor key={`${selected.id}:${selectedViewDate}`} eventId={selected.storageId}
            completionDisabled={!selected.isSample && (growth.busy || !growth.occurrence)}
            canComplete={selected.isSample || !!growth.occurrence?.canCompletePreparation}
            items={selected.preparations.map((item) => ({ ...item, complete: isPreparationComplete(item) }))}
            onToggle={(item) => togglePreparation(selected.id, item)}
            onSaved={(saved) => {
              setSchedules((items) => items.map((item) => item.id === selected.id ? {
                ...item, preparations: item.preparations.some((prep) => prep.id === saved.id)
                  ? item.preparations.map((prep) => prep.id === saved.id ? { ...saved, tone: prep.tone } : prep)
                  : [...item.preparations, saved],
              } : item));
              setFeedback('준비 항목을 저장했어요.');
              growth.refresh();
            }}
            onDeleted={(id) => {
              setSchedules((items) => items.map((item) => item.id === selected.id ? { ...item, preparations: item.preparations.filter((prep) => prep.id !== id) } : item));
              setCompleted((items) => items.filter((key) => key !== `${selected.id}:${id}`));
              setFeedback('준비 항목을 삭제했어요.');
              growth.refresh();
            }}
          />
          </>}

          {nextResolved && selected.preparationsEnabled !== false && <PreparationRecommendations key={`recommendations:${selected.id}`} eventId={selected.storageId} now={pushNow}
            preparations={selected.preparations} onChecklist={()=>focusDestination('preparations')}
            refreshKey={JSON.stringify([selectedMaster.revision, selectedMaster.recurrenceUntil, selected.title, selected.category, selected.eventDate, selected.eventTime, selected.allDay, selected.allDayReminderTime, selected.endDate, selected.endTime, selected.location, selected.travelPlan, selected.recurrence, selected.recurrenceInterval, selected.recurrenceDay, selectedUpcomingDate, selected.preparations, selected.reminderRules])}
            reminderOffsets={selected.reminderRules?.map((rule) => rule.offset_minutes) ?? []} reminderBusy={reminderBusy}
            onAdopt={(saved) => {
              setSchedules((items) => items.map((item) => item.id === selected.id ? {
                ...item, preparations: item.preparations.some((prep) => prep.id === saved.id)
                  ? item.preparations.map((prep) => prep.id === saved.id ? { ...saved, tone: prep.tone } : prep)
                  : [...item.preparations, saved],
              } : item));
              growth.refresh();
            }}
            onReminder={(id, offsetMinutes) => addRecommendationReminder({ id, offsetMinutes, kind: '알림', title: '추천 준비', reason: '' })}
            onFeedback={setFeedback} onCreate={openCreate}
          />}
          </div>


          <section id="reminders-content" hidden={detailView !== 'reminders'}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">알림 설정</h3>
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${notificationPermission === 'granted' ? 'bg-[#e8f4ee] text-[#28745f]' : notificationPermission === 'denied' ? 'bg-[#f8ece9] text-[#a45448]' : 'bg-[#f1f1ec] text-[#7a7c75]'}`}>
                {notificationPermission === 'granted' ? '브라우저 허용됨' : notificationPermission === 'denied' ? '브라우저 차단됨' : '수신 테스트 전'}
              </span>
            </div>

            <div id="device-reminder-settings" tabIndex={-1} className="mt-4 rounded-[14px] border border-[#e2e7dc] bg-white p-4">
              <p className="text-sm font-semibold">이 기기의 일정 알림 · {diagnostics.deviceState === 'error' ? '확인 실패' : deviceLoaded ? pushDevice?.enabled ? '켜짐' : '꺼짐' : '확인 중'}</p>
              <button type="button" className="text-button" onClick={openNotificationDiagnostics}>기기 수신 점검·설치 안내</button>
              <p className="mt-2 text-sm leading-relaxed text-[#74766f]">켜면 내 모든 일정에 저장한 알림을 이 기기로 받아요. 페이지를 닫아도 발송하며, 한국 시간을 기준으로 해요.</p>
              <button type="button" aria-pressed={!!pushDevice?.enabled} disabled={isSchedulingPush || !deviceLoaded}
                onClick={toggleDeviceReminders}
                className="mt-3 w-full rounded-[12px] bg-[#294e3e] px-3 py-3 text-sm font-semibold text-white disabled:opacity-50">
                {isSchedulingPush ? '설정 저장 중…' : pushDevice?.enabled ? '이 기기의 일정 알림 끄기' : '이 기기에서 일정 알림 켜기'}
              </button>
              {pushDevice?.enabled && <p className="mt-2 text-sm leading-relaxed text-[#28745f]">
                {selected.reminders.length === 0 ? '이 일정에 저장된 알림이 없어요.' : schedulerReady !== true ? '자동 발송 연결 상태를 확인 중이에요.' : !nextReminder || nextReminder.eventId !== selected.storageId
                  ? '다음 알림의 예약 상태를 확인 중이에요.' : nextReminder.at
                    ? `이 일정의 다음 알림 · ${formatPushTime(nextReminder.at)}` : '24시간 이내 예약된 알림이 없어요. 다음 시점이 다가오면 자동으로 예약해요.'}
              </p>}
              <p className="mt-2 text-xs leading-relaxed text-[#74766f]">알림을 켜기 전에 지난 시각은 건너뛰어요. 각 시점에 한 번 보내며, 받은 알림에서 10분 미룰 수 있어요.</p>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {reminderPresetOptions.map((option) => {
                const isActive = selected.reminderPreset === option.id;
                return (
                  <button
                    type="button"
                    key={option.id}
                    aria-pressed={isActive}
                    disabled={reminderBusy}
                    onClick={() => changeReminderPreset(option.id)}
                    className={`rounded-[13px] border px-2 py-3 text-center transition disabled:cursor-wait disabled:opacity-60 ${isActive ? 'border-[#294e3e] bg-[#294e3e] text-white' : 'border-[#e2e7dc] bg-white text-[#686a64] hover:border-[#bfc0b8]'}`}
                  >
                    <span className="block text-sm font-semibold">{option.label}</span>
                    <span className={`mt-1 block text-xs ${isActive ? 'text-white/70' : 'text-[#74766f]'}`}>{option.description}</span>
                  </button>
                );
              })}
            </div>

            <p className="editor-help">프리셋을 선택하면 기존 시점 전체를 바꿔요. 현재: {selected.reminderPreset === 'none' ? '알림 없음' : selected.reminderPreset === 'custom' ? '직접 설정' : reminderPresetOptions.find((item) => item.id === selected.reminderPreset)?.label}</p>

            <ReminderRuleList key={`${selected.id}:${(selected.reminderRules ?? []).map((rule) => `${rule.id}-${rule.offset_minutes}`).join(',')}`}
              eventId={selected.storageId} rules={selected.reminderRules ?? []} fallback={selected.reminders}
              eventDate={nextResolved?.start ?? ''} eventTime={reminderTime(nextResolved?.event ?? selected)} allDay={!!(nextResolved?.event ?? selected).allDay} busy={reminderBusy}
              beginChange={beginReminderChange} endChange={endReminderChange}
              onChanged={(rules) => { applyReminderRules(selected.id, rules); setFeedback('알림 시점을 변경했어요.'); }}
            />

            <form className="mt-3" onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const offsetMinutes = Number(form.get('amount')) * Number(form.get('unit'));
              if (!Number.isSafeInteger(offsetMinutes) || offsetMinutes < 0 || offsetMinutes > 525600) {
                setFeedback('알림은 시작 시각부터 최대 365일 전까지 설정할 수 있어요.'); return;
              }
              void addRecommendationReminder({ id: 'custom', kind: '알림', title: '직접 지정', reason: '', offsetMinutes });
            }}>
              <label htmlFor="reminder-amount" className="text-sm font-semibold text-[#666862]">알림 시점 직접 추가</label>
              <div className="mt-2 flex gap-2">
                <input id="reminder-amount" name="amount" type="number" min="0" max="525600" step="1" defaultValue="10" required className="min-w-0 flex-1 rounded-lg border border-[#e2e7dc] bg-white px-3 py-2 text-sm" />
                <select name="unit" aria-label="알림 시간 단위" defaultValue="1" className="rounded-lg border border-[#e2e7dc] bg-white px-2 py-2 text-sm">
                  <option value="1">분 전</option><option value="60">시간 전</option><option value="1440">일 전</option>
                </select>
                <button type="submit" disabled={reminderBusy || !selected.storageId} className="rounded-lg border border-[#e2e7dc] bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50">추가</button>
              </div>
              <p className="mt-1 text-xs text-[#74766f]">{selected.allDay ? '0을 입력하면 시작일의 알림 기준 시각에 알려드려요.' : '0을 입력하면 일정 시작 시각에 알려드려요.'}</p>
            </form>

            <details className="detail-disclosure">
              <summary><span><strong>알림 수신 점검</strong><span className="disclosure-hint">테스트 알림으로 연결 확인</span></span><span className="disclosure-chevron">⌄</span></summary>
            <button
              type="button"
              disabled={isSchedulingPush}
              onClick={() => schedulePushTest('immediate')}
              aria-describedby="push-test-description"
              className="mt-4 w-full rounded-[13px] border border-[#d8d9d2] bg-white py-3 text-sm font-semibold disabled:cursor-wait disabled:opacity-60"
            >
              {isSchedulingPush ? '알림 연결하는 중…' : '지금 푸시 알림 테스트'}
            </button>
            <button type="button" disabled={isSchedulingPush || schedulerReady !== true} onClick={() => schedulePushTest('scheduled')} className="mt-2 w-full rounded-[13px] border border-[#d8d9d2] bg-white py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">
              약 2분 뒤 테스트 예약
            </button>
            <p id="push-test-description" className="mt-2 text-xs leading-relaxed text-[#74766f]">{schedulerReady === true ? '수신 확인용 테스트예요. 실제 일정 알림은 위에서 따로 켜 주세요.' : '예약 알림 연결 대기 중 · 지금 푸시 테스트는 가능해요.'} 연결 장애로 30분 넘게 지난 일정 알림은 보내지 않아요.</p>
            </details>

            {pushError && (
              <p role="alert" className="mt-3 rounded-[13px] bg-[#f8ece9] px-3.5 py-3 text-sm font-medium leading-relaxed text-[#9b5147]">
                {pushError}
              </p>
            )}

            {visiblePushTest && visiblePushStatus && (
              <section aria-live="polite" className="mt-4 rounded-[16px] border border-[#e2e7dc] bg-white p-4 shadow-[0_8px_20px_rgba(39,40,37,0.05)]">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[#555751]">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${visiblePushStatus.dot}`} />
                    <span className="truncate">{visiblePushTest.scheduleTitle} {visiblePushTest.job.kind === 'reminder' ? '알림' : '테스트'}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-sm font-bold ${visiblePushStatus.badge}`}>
                    {visiblePushStatus.label}
                  </span>
                </div>
                <div className="mt-3 flex items-end justify-between gap-3 border-t border-[#eeeeea] pt-3">
                  <div>
                    <p className="text-xs font-semibold text-[#657260]">발송 예정 · 한국 시간</p>
                    <p className="mt-1 text-sm font-semibold text-[#4d4f4a]">{formatPushTime(visiblePushTest.job.scheduledFor)}</p>
                  </div>
                  {visiblePushCountdown && (
                    <span className="shrink-0 text-sm font-bold tabular-nums text-[#665492]">{visiblePushCountdown}</span>
                  )}
                </div>
                <p className="mt-3 text-sm leading-relaxed text-[#7f817a]">{visiblePushStatus.detail}</p>
                {(visiblePushTest.job.status === 'sent' || visiblePushTest.job.status === 'unconfirmed') && (
                  <div className="mt-3 flex gap-2">
                    <button type="button" disabled={isSchedulingPush} onClick={() => updatePushJob('ack')} className="rounded-lg bg-[#294e3e] px-3 py-2 text-sm text-white disabled:opacity-50">확인</button>
                    <SnoozeControls disabled={isSchedulingPush || schedulerReady !== true} onSnooze={minutes=>void updatePushJob('snooze',minutes)} />
                  </div>
                )}
                {visiblePushTest.job.sentAt && (
                  <p className="mt-2 text-xs text-[#657260]">발송 요청 수락 · {formatPushTime(visiblePushTest.job.sentAt)}</p>
                )}
                {visiblePushTest.job.acknowledgedAt && (
                  <p className="mt-1 text-xs text-[#6f857d]">확인 · {formatPushTime(visiblePushTest.job.acknowledgedAt)}</p>
                )}
                {pushPollWarning && <p className="mt-2 text-xs leading-relaxed text-[#a06c37]">{pushPollWarning}</p>}
              </section>
            )}

            {selected.deliveries.length > 0 && (
              <div className="mt-5">
                <p className="text-[12px] font-semibold text-[#777972]">최근 알림 기록</p>
                <div className="mt-2 space-y-2">
                  {selected.deliveries.slice(0, 3).map((delivery) => (
                    <div key={delivery.id} className="flex items-center gap-2 text-[12px] text-[#657260]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#3e9b7c]" />
                      {delivery.status === 'accepted' ? '발송 요청 수락' : '브라우저 테스트'}
                      <span className="ml-auto">{formatDeliveryTime(delivery.sentAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
          </div>
        </aside>
      </main>
      <MobileNavigation view={workspaceView} detailOpen={detailOpen} hidden={modalOpen} onNavigate={navigateWorkspace} onCreate={() => openCreate()} />

      {!modalOpen && feedback && typeof feedback !== 'string' && <GrowthFeedback notice={feedback} onClose={() => setFeedback(null)} />}
      {!modalOpen && typeof feedback === 'string' && (
        <button
          type="button"
          onClick={() => setFeedback(null)}
          className="app-toast fixed bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-full bg-[#294e3e] px-4 py-3 text-[14px] font-semibold text-white shadow-2xl"
          aria-live="polite"
        >
          {feedback} <span className="ml-2 text-white/55">닫기</span>
        </button>
      )}

      {occurrenceAction === 'edit' && selectedResolved && <OccurrenceEditor originalDate={selectedViewDate} isOffline={isOffline}
        initial={{ title: selected.title, note: selected.note, eventDate: selectedDisplayDate, eventTime: selected.eventTime,
          allDay: !!selected.allDay, allDayReminderTime: selected.allDayReminderTime ?? '09:00', endDate: selected.endDate ?? null, endTime: selected.endTime ?? null }}
        onSave={(changes) => changeOccurrence('edit', selectedViewDate, changes)} onClose={closeOccurrenceEditor} />}
      {occurrenceAction === 'cancel' && <EventEditorDialog title="이번 회차 취소" isSaving={occurrenceBusy} isOffline={isOffline} onClose={closeOccurrenceEditor}
        onSubmit={(event) => { event.preventDefault(); void changeOccurrence('cancel', selectedViewDate); }}>
        <h2 className="text-[24px] font-semibold pr-12">이번 회차를 취소할까요?</h2>
        <p className="mt-4">{selected.title} · {calendarDateLabel(selectedDisplayDate)}</p>
        <p className="editor-help">이 회차만 달력에서 숨기고 남은 알림을 취소해요. 다른 회차, 완료 기록과 경험치는 유지돼요. 변경·취소 내역에서 복구할 수 있어요. 이미 발송된 알림은 회수할 수 없어요.</p>
        {occurrenceError && <p role="alert">{occurrenceError}</p>}
        <button type="submit" disabled={occurrenceBusy || isOffline} className="primary-button mt-5">{occurrenceBusy ? '취소 중…' : '이번 회차만 취소'}</button>
      </EventEditorDialog>}

      {draftCandidate && <EventEditorDialog title="이어서 작성할까요?" isSaving={false} onClose={() => setDraftCandidate(null)} onSubmit={event => event.preventDefault()}>
        <p className="editor-help">이 계정으로 이 기기에 보관한 새 일정이 있어요. 보관 후 7일이 지나면 복구하지 않아요.</p>
        <strong>{draftCandidate.values.title || '작성 중인 일정'}</strong>
        {draftCandidate.pending && <p className="editor-help">저장 결과를 확인하지 못한 일정이에요. 이어서 열면 중복 없이 확인할 수 있어요.</p>}
        <div className="draft-recovery-actions">
          <button type="button" className="primary-button" onClick={() => openCreate(undefined, draftCandidate, true)}>이어서 작성</button>
          {!draftCandidate.pending && <button type="button" className="text-button" onClick={() => {
            try { localStorage.removeItem(eventDraftKey(draftCandidate.scope, draftCandidate.draftId)); } catch { setFeedback('임시 보관 내용을 지우지 못했어요.'); return; }
            setDraftCandidate(null); openCreate(undefined, undefined, true);
          }}>임시 내용 버리고 새로 작성</button>}
        </div>
      </EventEditorDialog>}

      {(isAdding || editingSchedule) && (
        <EventEditorDialog key={editingSchedule?.id ?? `new-${editorVersion}`} title={editingSchedule ? '일정 수정' : '새 일정 추가'} isSaving={isSaving} isOffline={isOffline} error={saveError} onSubmit={handleSave} onClose={closeEditor} locked={!editingSchedule && !!pendingCreation} draftKept={!editingSchedule && draftKept}
          footer={<button disabled={isSaving || isOffline || (!editingSchedule && !eventScope)} type={pendingCreation && !editingSchedule ? 'button' : 'submit'} onClick={pendingCreation && !editingSchedule ? () => {
            if (creationRecovery === 'account') { window.location.reload(); return; }
            if (creationRecovery === 'conflict') {
              const forked: EventDraft = { version: 1, draftId: crypto.randomUUID(), scope: pendingCreation.scope, savedAt: Date.now(), values: pendingCreation.values, pending: null };
              if (draftKept) {
                try { writeEventDraft(localStorage, forked); localStorage.removeItem(eventDraftKey(pendingCreation.scope, pendingCreation.requestId)); }
                catch { setSaveError('새 초안을 임시 보관하지 못했어요. 입력 내용은 그대로 남아 있어요.'); return; }
              }
              openCreate(undefined, forked, true); return;
            }
            if (creationRecovery === 'deleted') {
              try { localStorage.removeItem(eventDraftKey(pendingCreation.scope, pendingCreation.requestId)); } catch { setSaveError('임시 기록을 지우지 못했어요. 브라우저 저장소를 확인해 주세요.'); return; }
              setPendingCreation(null); setCreationRecovery(null); closeEditor(); setFeedback('이미 삭제된 일정의 저장 요청을 닫았어요. 새 일정을 작성할 수 있어요.'); return;
            }
            void retryCreation();
          } : undefined} className="editor-save-button h-12 w-full rounded-[14px] bg-[#294e3e] text-[16px] font-semibold text-white disabled:cursor-wait disabled:opacity-60">{isSaving ? '저장 확인 중…' : isOffline ? '인터넷 연결 후 저장' : editingSchedule ? '수정 저장' : creationRecovery === 'account' ? '현재 계정으로 새로고침' : creationRecovery === 'deleted' ? '확인하고 닫기' : creationRecovery === 'conflict' ? '이 내용으로 별도 일정 작성' : pendingCreation ? '저장 결과 다시 확인' : '일정 저장'}</button>}>
            <label className="block">
              <span className="text-[14px] font-semibold text-[#666862]">무슨 일정인가요?</span>
              <input name="title" required maxLength={100} autoFocus defaultValue={editingSchedule?.title ?? newEventDraft?.title} placeholder="예: 아버지 생신, 제주 여행" className="mt-2 h-12 w-full rounded-[14px] border border-[#e2e7dc] bg-white px-4 text-sm outline-none transition placeholder:text-[#adafa8] focus:border-[#777972]" />
            </label>
            <EventTimeFields date={draftEventDate} onDateChange={setDraftEventDate} initial={editingSchedule ?? restoredInitial ?? undefined} />
            {!editingSchedule ? <InitialReminderField initial={initialReminderChoice} initialEditorDraft={restoredDraft?.initialReminderDraft} initialRemember={restoredDraft ? restoredDraft.rememberInitialReminders !== undefined : undefined} deviceLoaded={deviceLoaded} deviceEnabled={!!pushDevice?.enabled} /> : <p className="editor-help">알림 {editingSchedule.reminderRules?.length ?? 0}개는 유지돼요. 시점은 일정 상세의 ‘알림’에서 변경할 수 있어요.</p>}
            <p className="editor-options-heading">필요한 설정만 더하세요</p>
            <EditorSection title="일정 종류" summary={draftCategory.trim() || '직접 입력'}>
            <EventCategoryField value={draftCategory} onChange={setDraftCategory} colors={categoryColors.colors} />
            </EditorSection>
            <EditorSection title="장소·이동 경로" summary="장소 검색 · 자동차·도보·대중교통" initialOpen={!!editingSchedule?.location}>
            <EventLocationFields location={editingSchedule?.location ?? restoredDraft?.location} place={editingSchedule?.place ?? restoredInitial?.place} travelPlan={editingSchedule?.travelPlan ?? restoredInitial?.travelPlan} travelDraft={!editingSchedule ? restoredInitial?.travelDraft : undefined} initialOriginQuery={!editingSchedule ? restoredDraft?.routeOriginQuery : undefined} />
            </EditorSection>
            <PreparationField initialEnabled={editingSchedule ? editingSchedule.preparationsEnabled !== false : restoredInitial?.preparationsEnabled ?? true} />
            <EditorSection title="반복" initialOpen={!!editingSchedule && editingSchedule.recurrence !== 'none'} summary={formatRecurrence({ eventDate: draftEventDate, recurrence: draftRecurrence, recurrenceInterval: Number(draftInterval), recurrenceDay: draftDay === null ? null : Number(draftDay) }) ?? '반복 안 함'}>
            <section>
              <label className="block">
                <span className="text-[14px] font-semibold text-[#555751]">반복 주기</span>
                <select name="recurrence" value={draftRecurrence} onChange={(event) => { setDraftRecurrence(event.target.value as EventRecurrence); setDraftInterval('1'); setDraftDay(null); }} className="mt-2 h-11 w-full rounded-xl border border-[#e2e7dc] bg-white px-3 text-xs outline-none focus:border-[#777972]">
                  <option value="none">반복 안 함</option>
                  <option value="daily">일 단위</option>
                  <option value="weekly">주 단위</option>
                  <option value="monthly">월 단위</option>
                  <option value="yearly">년 단위</option>
                </select>
              </label>
              {draftRecurrence !== 'none' && (
                <div key={draftRecurrence} className={`mt-3 grid gap-3 ${draftRecurrence === 'weekly' || draftRecurrence === 'monthly' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  <label>
                    <span className="text-[12px] font-semibold text-[#777972]">
                      {draftRecurrence === 'yearly' ? '몇 년마다' : draftRecurrence === 'monthly' ? '몇 개월마다' : draftRecurrence === 'weekly' ? '몇 주마다' : '몇 일마다'}
                    </span>
                    <span className="mt-2 flex h-11 items-center overflow-hidden rounded-xl border border-[#e2e7dc] bg-white focus-within:border-[#777972]">
                      <input name="recurrenceInterval" type="number" min="1" max="99" required value={draftInterval} onChange={(event) => setDraftInterval(event.target.value)} className="h-full min-w-0 flex-1 bg-transparent px-3 text-xs outline-none" />
                      <span className="shrink-0 pr-3 text-[12px] text-[#657260]">{getRecurrenceUnitLabel(draftRecurrence)}</span>
                    </span>
                  </label>
                  {draftRecurrence === 'weekly' && (
                    <label>
                      <span className="text-[12px] font-semibold text-[#777972]">반복 요일</span>
                      <select name="recurrenceDay" required value={draftDay ?? getIsoWeekday(draftEventDate || defaultEventDate)} onChange={(event) => setDraftDay(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#e2e7dc] bg-white px-3 text-xs outline-none focus:border-[#777972]">
                        {weekdayOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {draftRecurrence === 'monthly' && (
                    <label>
                      <span className="text-[12px] font-semibold text-[#777972]">반복 날짜</span>
                      <span className="mt-2 flex h-11 items-center overflow-hidden rounded-xl border border-[#e2e7dc] bg-white focus-within:border-[#777972]">
                        <input name="recurrenceDay" type="number" min="1" max="31" required value={draftDay ?? Number((draftEventDate || defaultEventDate).slice(8, 10))} onChange={(event) => setDraftDay(event.target.value)} className="h-full min-w-0 flex-1 bg-transparent px-3 text-xs outline-none" />
                        <span className="shrink-0 pr-3 text-[12px] text-[#657260]">일</span>
                      </span>
                    </label>
                  )}
                </div>
              )}
              <p className="mt-3 text-[12px] leading-relaxed text-[#657260]">{getRecurrenceHint(draftRecurrence)}</p>
              {draftRecurrence !== 'none' && <label className="occurrence-field">반복 종료일 (선택)
                <input type="date" name="recurrenceUntil" min={draftEventDate || '1900-01-01'} max="9999-12-31" defaultValue={editingSchedule?.recurrenceUntil ?? restoredDraft?.recurrenceUntil ?? ''} />
                <small>비워 두면 계속 반복해요. 이 날짜에 시작하는 원래 회차까지 포함해요.</small>
              </label>}
              {!!editingSchedule?.occurrenceOverrides?.length && <p className="editor-help">회차별 변경 기록이 있어 시작일과 반복 규칙은 유지해 주세요. 종료일은 바꿀 수 있으며, 종료일 뒤의 기록도 삭제하지 않아요. 회차별로 수정한 내용은 전체 수정보다 우선해요.</p>}
            </section>
            </EditorSection>
            <EditorSection title="메모" initialOpen={!!editingSchedule?.note || !!newEventDraft?.note}>
            <label className="block">
              <span className="text-[14px] font-semibold text-[#666862]">메모 <span className="font-normal text-[#657260]">(선택)</span></span>
              <textarea name="note" defaultValue={editingSchedule?.note ?? newEventDraft?.note} maxLength={500} rows={3} placeholder="준비할 내용이나 기억해둘 정보를 적어주세요" className="mt-2 w-full resize-none rounded-xl border border-[#e2e7dc] bg-white px-3 py-3 text-xs leading-relaxed outline-none placeholder:text-[#adafa8] focus:border-[#777972]" />
            </label>
            </EditorSection>
            <p className="editor-save-note">{editingSchedule ? '기존 준비 기록과 알림은 유지돼요. 준비 표시 설정은 반복 일정 전체에 적용돼요.' : '준비 항목은 저장 후 필요한 것만 골라 담을 수 있어요.'}</p>
            {!editingSchedule && <EventDraftStorage scope={eventScope} draftId={editorDraftId} initialEnabled={draftKept} pending={pendingCreation} onSnapshot={() => {}} onEnabled={setDraftKept} />}
        </EventEditorDialog>
      )}

      {deleteTarget && (
        <div className="mobile-dialog-layer fixed inset-0 z-[60] grid place-items-center bg-[#25342e]/45 p-5 backdrop-blur-sm" onMouseDown={() => setDeleteTarget(null)} role="presentation">
          <section onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-[380px] rounded-[24px] bg-[#ffffff] p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="delete-event-title">
            <p className="text-[12px] font-bold text-[#a45a4f]">일정 삭제</p>
            <h2 id="delete-event-title" className="mt-2 text-[22px] font-semibold tracking-[-0.04em]">{deleteTarget.title}</h2>
            <p className="mt-3 text-[14px] leading-relaxed text-[#7f817a]">{deleteTarget.recurrence !== 'none' ? '모든 반복 회차와 회차별 변경 내역을 삭제해요. ' : ''}준비 체크리스트와 알림 기록도 함께 삭제돼요. 삭제한 일정은 되돌릴 수 없습니다.</p>
            <div className="mt-6 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setDeleteTarget(null)} className="h-11 rounded-[13px] border border-[#e2e7dc] bg-white text-[14px] font-semibold text-[#666862]">취소</button>
              <button type="button" disabled={isDeleting} onClick={handleDelete} className="h-11 rounded-[13px] bg-[#b8584c] text-[14px] font-semibold text-white disabled:cursor-wait disabled:opacity-60">{isDeleting ? '삭제하는 중…' : '삭제하기'}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
