'use client';

import { useRef, useState } from 'react';
import { formatReminderOffset, MAX_INITIAL_REMINDERS, offsetInput, parseInitialReminderChoice, reminderPresets, type InitialReminderChoice, type InitialReminderMode } from '@/lib/reminder-settings';
import { EditorSection } from './editor-section';
import { ReminderPreview } from './reminder-preview';

type OffsetRow = { id: number; amount: string; unit: number };
const modes: Array<{ id: InitialReminderMode; label: string; hint: string }> = [
  { id: 'none', label: '알림 없음', hint: '일정만 기록해요' },
  { id: 'once', label: '한 번', hint: '원하는 시점에 한 번' },
  { id: 'standard', label: '기본 3회', hint: '1주 · 1일 · 2시간 전' },
  { id: 'custom', label: '직접 설정', hint: '여러 시점을 자유롭게' },
];
const toRow = (offset: number, id: number): OffsetRow => { const value = offsetInput(offset); return { id, amount: String(value.amount), unit: value.unit }; };
const minutes = (row: OffsetRow) => row.amount.trim() ? Number(row.amount) * row.unit : NaN;
function readEditorDraft(raw?: string) {
  if (!raw || raw.length > 8000) return null;
  try {
    const value = JSON.parse(raw) as { mode: InitialReminderMode; once: OffsetRow; custom: OffsetRow[] };
    const valid = (row: OffsetRow) => row && Number.isInteger(row.id) && row.id >= 0 && row.id < 100000 && typeof row.amount === 'string' && row.amount.length < 16 && [1, 60, 1440, 10080].includes(row.unit);
    return modes.some(mode => mode.id === value.mode) && valid(value.once) && Array.isArray(value.custom) && value.custom.length > 0 && value.custom.length <= MAX_INITIAL_REMINDERS && value.custom.every(valid) ? value : null;
  } catch { return null; }
}

export function InitialReminderField({ initial, deviceLoaded, deviceEnabled, initialRemember, initialEditorDraft }: {
  initial: InitialReminderChoice | null; deviceLoaded: boolean; deviceEnabled: boolean;
  initialRemember?: boolean;
  initialEditorDraft?: string;
}) {
  const draft = readEditorDraft(initialEditorDraft);
  const [mode, setMode] = useState<InitialReminderMode>(draft?.mode ?? initial?.mode ?? 'standard');
  const [once, setOnce] = useState(() => draft?.once ?? toRow(initial?.mode === 'once' ? initial.offsets[0] : 1440, 0));
  const [custom, setCustom] = useState(() => draft?.custom ?? (initial?.mode === 'custom' ? initial.offsets : [1440, 120]).map(toRow));
  const nextId = useRef(Math.max(MAX_INITIAL_REMINDERS, ...custom.map(row => row.id + 1)));
  const [remember, setRemember] = useState(initialRemember ?? !!initial);
  const offsets = mode === 'none' ? [] : mode === 'standard' ? reminderPresets.standard : (mode === 'once' ? [once] : custom).map(minutes);
  const choice = parseInitialReminderChoice({ mode, offsets });
  const duplicate = offsets.every(Number.isFinite) && new Set(offsets).size !== offsets.length;

  function inputRow(row: OffsetRow, index: number, update: (row: OffsetRow) => void) {
    return <div className="initial-reminder-row" key={row.id}>
      <label><span>{mode === 'once' ? '알림 시점' : `${index + 1}번째 알림`}</span><input name={`initialReminderAmount-${row.id}`} aria-label={`${index + 1}번째 알림 값`} type="number" min="0" max={Math.floor(525600 / row.unit)} step="1" required value={row.amount} onChange={(event) => update({ ...row, amount: event.target.value })} /></label>
      <label><span>단위</span><select name={`initialReminderUnit-${row.id}`} aria-label={`${index + 1}번째 알림 단위`} value={row.unit} onChange={(event) => update({ ...row, unit: Number(event.target.value) })}>
        <option value="1">분 전</option><option value="60">시간 전</option><option value="1440">일 전</option><option value="10080">주 전</option>
      </select></label>
      {mode === 'custom' && <button type="button" className="initial-reminder-remove" disabled={custom.length === 1} aria-label={`${index + 1}번째 알림 제거`} onClick={() => setCustom((rows) => rows.filter((item) => item.id !== row.id))}>삭제</button>}
    </div>;
  }

  return <section className="initial-reminder-field" aria-label="새 일정 알림 설정">
    <EditorSection title="언제 알려드릴까요?" summary={choice ? choice.offsets.length ? choice.offsets.map((value) => value === 0 ? '시작 시각' : formatReminderOffset(value)).join(' · ') : '알림 없음' : '알림 시점을 확인해 주세요'}>
    <fieldset>
      <legend className="sr-only">알림 횟수 선택</legend>
      <div className="initial-reminder-modes">{modes.map((option) => <label key={option.id}>
        <input type="radio" name="initialReminderMode" value={option.id} checked={mode === option.id} onChange={() => setMode(option.id)} />
        <span><strong>{option.label}</strong><small>{option.hint}</small></span>
      </label>)}</div>
    </fieldset>
    {mode === 'once' && inputRow(once, 0, setOnce)}
    {mode === 'custom' && <div>
      {custom.map((row, index) => inputRow(row, index, (value) => setCustom((rows) => rows.map((item) => item.id === row.id ? value : item))))}
      <button type="button" className="text-button initial-reminder-add" disabled={custom.length >= MAX_INITIAL_REMINDERS} onClick={() => {
        const available = [60, 30, 10, 5, 0, 120, 1440, 2880, 4320, 10080, 20160].find((value) => !offsets.includes(value)) ?? 15;
        setCustom((rows) => [...rows, toRow(available, nextId.current++)]);
      }}>+ 알림 시점 추가 <span>{custom.length}/{MAX_INITIAL_REMINDERS}</span></button>
    </div>}
    {(mode === 'once' || mode === 'custom') && <p className="editor-help">0은 일정의 기준 시각이에요. 최대 365일 전까지 설정할 수 있어요.</p>}
    {!choice && <p role="alert" className="editor-error">{duplicate ? '같은 시점이 중복됐어요. 하나를 삭제하거나 시점을 바꿔 주세요.' : '알림은 0~365일 범위의 분 단위 정수로 입력해 주세요.'}</p>}
    <p className="sr-only" aria-live="polite">{choice ? choice.offsets.length ? `저장할 알림 ${choice.offsets.length}개 · ${choice.offsets.map((value) => value === 0 ? '기준 시각' : formatReminderOffset(value)).join(' · ')}` : '이 일정은 자동 알림 없이 저장해요.' : '알림 시점을 확인해 주세요.'}</p>
    <input type="hidden" name="initialReminderChoice" value={JSON.stringify(choice)} />
    <input type="hidden" name="initialReminderDraft" value={JSON.stringify({ mode, once, custom })} />
    <label className="initial-reminder-remember"><input type="checkbox" name="rememberInitialReminders" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>이 브라우저에서 다음 일정의 기본값으로 사용</span></label>
    <p className="editor-help">저장한 뒤에도 일정의 ‘알림’에서 변경할 수 있어요. 반복 일정에는 매 회차 적용돼요. 종일 일정은 알림 기준 시간, 그 외에는 시작 시간을 기준으로 계산해요.</p>
    </EditorSection>
    <ReminderPreview onSuggestion={offset => { setMode('once'); setOnce(toRow(offset, 0)); }} />
    {mode !== 'none' && <p className="initial-reminder-device">{!deviceLoaded ? '기기의 알림 수신 상태를 확인하고 있어요.' : deviceEnabled ? '이 기기의 알림 수신이 켜져 있어요.' : '이 기기의 알림 수신이 꺼져 있어요. 저장 후 ‘알림’에서 수신을 켜 주세요.'} 이미 지난 알림 시각에는 소급 발송하지 않아요.</p>}
  </section>;
}
