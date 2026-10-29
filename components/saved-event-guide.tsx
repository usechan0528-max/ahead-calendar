'use client';

import { AppIcon } from './calendar-workspace';
import type { EventDuration } from '@/lib/event-duration';
import { previewReminders, reminderDateLabel } from '@/lib/reminder-preview';

export function SavedEventGuide({ title, preparationsEnabled, reminderCount, deviceLoaded, deviceEnabled, onPrepare, onReminders, onDone, event, offsets, now }: {
  title: string; preparationsEnabled: boolean; reminderCount: number; deviceLoaded: boolean; deviceEnabled: boolean;
  onPrepare: () => void; onReminders: () => void; onDone: () => void;
  event?: EventDuration; offsets?: number[]; now?: number;
}) {
  const preview = event && offsets ? previewReminders(event, offsets, now ?? Date.now()) : null;
  return <section id="saved-event-guide" className="saved-event-guide" tabIndex={-1} aria-labelledby="saved-event-title">
    <span className="saved-event-icon"><AppIcon name="check" size={22} /></span>
    <h2 id="saved-event-title">일정을 저장했어요</h2>
    <p className="saved-event-name">{title}</p>
    <p>{reminderCount === 0 ? '자동 알림 없이 저장했어요.' : `알림 시점 ${reminderCount}개를 저장했어요.`}</p>
    {preview && reminderCount > 0 && <p className={!preview.upcoming.length ? 'editor-error' : undefined}>{preview.upcoming[0] ? `다음 알림 시점 · ${reminderDateLabel(preview.upcoming[0].at)}` : '이번 회차에 남은 알림 시점이 없어요.'}</p>}
    {reminderCount > 0 && <p className="saved-device-status">{!deviceLoaded ? '이 기기의 알림 수신 상태를 확인하고 있어요.' : deviceEnabled ? '이 기기의 수신 설정이 켜져 있어요. 실제 발송 상태는 알림에서 확인할 수 있어요.' : '이 기기에서는 아직 알림을 받을 수 없어요. 알림 설정에서 수신을 켜 주세요.'}</p>}
    {preparationsEnabled && <p>필요한 준비만 골라 담거나 직접 추가해 보세요. 지금 하지 않아도 괜찮아요.</p>}
    <div className="saved-event-actions">
      {preparationsEnabled && <button type="button" className="primary-button" onClick={onPrepare}><AppIcon name="check" size={17} />준비 항목 고르기</button>}
      {reminderCount > 0 && <button type="button" className="text-button" onClick={onReminders}><AppIcon name="bell" size={17} />{deviceLoaded && !deviceEnabled ? '알림 수신 설정' : '알림 확인하기'}</button>}
      <button type="button" className="text-button" onClick={onDone}>{preparationsEnabled || reminderCount > 0 ? '나중에 · 오늘로 가기' : '오늘로 가기'}<AppIcon name="arrow" size={17} /></button>
    </div>
  </section>;
}
