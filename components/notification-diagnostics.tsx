'use client';

import { useState } from 'react';
import { notificationDiagnosis, type NotificationChecks } from '@/lib/notification-diagnostics';
import { MobileInstallGuide } from '@/components/mobile-install-guide';

type TestEvent = { id: number; title: string };
export type NotificationDiagnosticsProps = NotificationChecks & {
  busy: boolean; refreshing: boolean; checkedAt: number | null; error: string | null;
  events: TestEvent[]; eventsReady: boolean;
  latestTest: { title: string; status: string; detail: string; scheduledFor: string } | null;
  testWarning?: string | null; onTestRefresh?: () => void;
  onRefresh: () => void; onToggle: () => void; onTest: (mode: 'immediate' | 'scheduled', id: number) => void;
  onCreate: () => void; onTestDetails: () => void;
};

export function NotificationDiagnostics(props: NotificationDiagnosticsProps) {
  const { browser, permission, device, deviceState, server, busy, refreshing, events, eventsReady } = props;
  const diagnosis = notificationDiagnosis(props);
  const [testEventId, setTestEventId] = useState<number | null>(null);
  const testEvent = events.find(item => item.id === testEventId) ?? events[0];
  const canConnect = !!browser?.secure && browser.online && browser.supported && !(browser.platform === 'ios' && !browser.standalone) && permission !== 'denied';
  const canTest = canConnect && !busy && !refreshing && !!testEvent && eventsReady && server !== 'signed-out' && server !== 'unconfigured' && server !== 'error';
  function reveal(id: string) {
    const element = document.getElementById(id);
    if (element instanceof HTMLDetailsElement) element.open = true;
    element?.scrollIntoView({ block: 'center', behavior: 'instant' });
    element?.querySelector('summary')?.focus();
  }
  const serverLabel = { checking: '확인 중', ready: '연결됨', delayed: '연결 점검 필요', unconfigured: '서버 준비 중', 'signed-out': '로그인 확인 필요', error: '확인 실패' }[server];
  return <section className="notification-diagnostics" aria-labelledby="notification-diagnostics-title">
    <div className="diagnostic-heading"><div><p>이 기기에서 받는 알림</p><h2 id="notification-diagnostics-title" tabIndex={-1}>알림 상태 점검</h2></div>
      <button type="button" className="text-button" disabled={busy || refreshing} onClick={props.onRefresh}>{refreshing ? '점검 중…' : '다시 점검'}</button></div>
    <div className={`diagnostic-summary is-${diagnosis.tone}`} aria-live="polite">
      <strong>{diagnosis.title}</strong><p>{diagnosis.detail}</p>
      {diagnosis.action === 'install' && <button type="button" className="text-button" onClick={() => reveal('mobile-install-guide')}>홈 화면 추가 방법 보기</button>}
      {diagnosis.action === 'help' && <button type="button" className="text-button" onClick={() => reveal('notification-permission-help')}>권한·수신 문제 해결 방법</button>}
    </div>
    <dl className="diagnostic-checks">
      <div><dt>사용 환경</dt><dd>{!browser ? '확인 중' : !browser.online ? '오프라인' : !browser.secure ? 'HTTPS 필요' : browser.platform === 'ios' && !browser.standalone ? '홈 화면 추가 필요' : browser.supported ? '웹 알림 지원' : '웹 알림 미지원'}</dd></div>
      <div><dt>알림 권한</dt><dd>{!browser ? '확인 중' : !browser.supported ? '이 환경에서 확인 불가' : permission === 'granted' ? '허용됨' : permission === 'denied' ? '차단됨' : '아직 허용하지 않음'}</dd></div>
      <div><dt>이 기기의 일정 수신</dt><dd>{deviceState === 'checking' ? '확인 중' : deviceState === 'error' ? '확인 실패' : device?.enabled ? '켜짐' : device ? '꺼짐' : '연결 전'}</dd></div>
      <div><dt>자동 발송 서버</dt><dd>{serverLabel}</dd></div>
    </dl>
    <div className="diagnostic-device-action">
      <button type="button" className={device?.enabled ? 'diagnostic-secondary' : 'primary-button'} aria-pressed={!!device?.enabled}
        disabled={busy || refreshing || deviceState !== 'ready' || !browser?.online || (!device?.enabled && (!canConnect || server === 'signed-out' || server === 'unconfigured' || server === 'error'))} onClick={props.onToggle}>
        {busy ? '처리 중…' : device?.enabled ? '이 기기의 일정 알림 끄기' : '이 기기에서 일정 알림 켜기'}
      </button>
      <p>수신을 켜도 알림 시점이 없는 일정은 보내지 않아요. 이미 지난 알림은 건너뛰어요.</p>
    </div>
    {props.error && <p className="diagnostic-error" role="alert">{props.error}</p>}
    <details className="notification-help" id="notification-test-guide">
      <summary>테스트 알림 보내기<span>지금 보내기 · 화면을 닫고 받아 보기</span></summary>
      <div>
        <p>선택한 일정으로 이 기기에만 테스트해요. 일정의 날짜·알림 시점이나 자동 수신 설정은 바꾸지 않아요.</p>
        {!eventsReady ? <p>저장된 일정을 불러온 뒤 테스트할 수 있어요.</p> : !testEvent ? <><p>내 일정을 하나 저장하면 테스트할 수 있어요.</p><button type="button" className="text-button" onClick={props.onCreate}>첫 일정 만들기</button></> : <>
          <label className="diagnostic-label" htmlFor="diagnostic-test-event">테스트할 일정</label>
          <select id="diagnostic-test-event" value={testEvent.id} disabled={busy} onChange={event => setTestEventId(Number(event.target.value))}>{events.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
          <div className="diagnostic-test-buttons"><button type="button" className="diagnostic-secondary" disabled={!canTest} onClick={() => props.onTest('immediate', testEvent.id)}>지금 테스트 보내기</button>
            <button type="button" className="diagnostic-secondary" disabled={!canTest || server !== 'ready'} onClick={() => props.onTest('scheduled', testEvent.id)}>약 2분 뒤 테스트 예약</button></div>
          {server !== 'ready' && <p className="diagnostic-note">자동 발송 서버가 연결되면 2분 뒤 테스트를 예약할 수 있어요.</p>}
        </>}
        <p className="diagnostic-note">예약 후 화면을 잠그거나 페이지를 닫고 기다려 보세요. 정확한 도착 시각은 보장되지 않아요. 발송 요청 수락은 실제 수신 확인과 달라요.</p>
      </div>
    </details>
    {props.latestTest && <div className="diagnostic-test-result" role="status"><strong>{props.latestTest.title} · {props.latestTest.status}</strong><p>발송 예정 · {props.latestTest.scheduledFor}</p><p>{props.latestTest.detail}</p>
      {props.testWarning && <div className="diagnostic-error"><p>{props.testWarning}</p><button type="button" className="text-button" disabled={busy} onClick={props.onTestRefresh}>테스트 기록 다시 조회</button></div>}
      <button type="button" className="text-button" onClick={props.onTestDetails}>알림 기록 자세히 보기</button></div>}
    <MobileInstallGuide browser={browser} />
    <details className="notification-help" id="notification-permission-help"><summary>알림이 오지 않을 때<span>차단 해제 · 집중 모드 · 네트워크</span></summary><div>
      <ul><li>iPhone·iPad: 홈 화면의 J에게로 열고, 기기 ‘설정 → 알림’에서 J에게의 알림 허용을 확인해 주세요.</li>
        <li>Android: 브라우저의 사이트 설정에서 알림을 허용하고, 기기 설정에서도 브라우저·웹 앱의 알림을 확인해 주세요.</li>
        <li>PC: 주소창 옆 사이트 설정의 알림 권한과 운영체제의 브라우저 알림 설정을 확인해 주세요.</li>
        <li>집중 모드·방해금지·절전 모드·네트워크 상태도 확인해 주세요. 이 설정은 사이트에서 직접 확인하거나 변경할 수 없어요.</li>
        <li>설정을 바꾼 뒤 돌아와 ‘다시 점검’을 누르고, 해당 일정에 알림 시점이 저장되어 있는지도 확인해 주세요.</li></ul>
      <p>기기와 브라우저에 따라 메뉴 이름이 다를 수 있어요. 웹 알림은 기본 시계 앱처럼 소리·반복 울림·정시 도착을 보장하지 않아요.</p>
    </div></details>
    {props.checkedAt && <p className="diagnostic-note">마지막 상태 조회 · {new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Seoul' }).format(props.checkedAt)} (한국 시간)</p>}
  </section>;
}
