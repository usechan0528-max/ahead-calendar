'use client';

import { useEffect, useRef, useState } from 'react';
import type { BrowserInfo } from '@/lib/notification-diagnostics';

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

export function MobileInstallGuide({ browser }: { browser: BrowserInfo | null }) {
  const prompt = useRef<InstallPrompt | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [message, setMessage] = useState('');
  const [chosenPlatform, setChosenPlatform] = useState<BrowserInfo['platform'] | null>(null);
  const platform = chosenPlatform ?? browser?.platform ?? 'ios';
  useEffect(() => {
    const available = (event: Event) => {
      if (!('prompt' in event) || typeof event.prompt !== 'function') return;
      event.preventDefault(); prompt.current = event as InstallPrompt; setCanInstall(true);
    };
    const completed = () => { prompt.current = null; setCanInstall(false); setInstalled(true); setMessage('설치했어요. 홈 화면이나 앱 목록의 J에게 아이콘으로 열어 주세요.'); };
    window.addEventListener('beforeinstallprompt', available);
    window.addEventListener('appinstalled', completed);
    return () => { window.removeEventListener('beforeinstallprompt', available); window.removeEventListener('appinstalled', completed); };
  }, []);
  async function install() {
    const event = prompt.current;
    if (!event || installing) return;
    prompt.current = null; setCanInstall(false); setInstalling(true);
    try {
      await event.prompt();
      const choice = await event.userChoice;
      setMessage(choice.outcome === 'accepted' ? '설치를 요청했어요. 설치가 끝나면 J에게 아이콘으로 열어 주세요.' : '설치하지 않아도 웹에서 계속 사용할 수 있어요. 나중에 브라우저 메뉴에서 추가할 수 있어요.');
    } catch { setMessage('설치 창을 열지 못했어요. 아래 브라우저 메뉴 안내를 따라 주세요.'); }
    finally { setInstalling(false); }
  }
  return <details id="mobile-install-guide" className="notification-help" open={browser?.platform === 'ios' && !browser.standalone}>
    <summary>홈 화면에 추가하기<span>{browser?.standalone ? '홈 화면 앱으로 사용 중' : '휴대폰에서 더 빠르게 열기'}</span></summary>
    <div>
      {browser?.standalone ? <p>지금 홈 화면 앱으로 열었어요. 알림 권한과 일정 수신 설정은 별도로 켜 주세요.</p> : <>
        <p>별도 앱 스토어 설치 없이 웹 앱으로 사용할 수 있어요. 일정 조회·저장에는 인터넷 연결이 필요해요.</p>
        {canInstall && !installed && <button type="button" className="primary-button" disabled={installing || browser?.online === false} onClick={() => void install()}>J에게 설치하기</button>}
      </>}
      {message && <p role="status">{message}</p>}
      <label className="diagnostic-label" htmlFor="install-platform">설치할 기기</label>
      <select id="install-platform" value={platform} onChange={event => setChosenPlatform(event.target.value as BrowserInfo['platform'])}>
        <option value="ios">iPhone · iPad</option><option value="android">Android</option><option value="desktop">PC · Mac</option>
      </select>
      {platform === 'ios' ? <ol>
        <li>Safari에서 이 사이트를 열어요. 카카오톡 등 앱 안에서 보고 있다면 Safari로 다시 열어 주세요.</li>
        <li>공유 메뉴에서 ‘홈 화면에 추가’를 선택해요. ‘웹 앱으로 열기’가 보이면 켜 주세요.</li>
        <li>홈 화면의 J에게 아이콘으로 열고, 필요한 경우 다시 로그인해요.</li>
        <li>‘알림’ 메뉴에서 ‘이 기기에서 일정 알림 켜기’를 누르고 권한을 허용해요.</li>
      </ol> : platform === 'android' ? <ol>
        <li>Chrome에서 이 사이트를 열어요.</li><li>브라우저의 ⋮ 메뉴에서 ‘홈 화면에 추가’ 또는 ‘앱 설치’를 선택해요. 메뉴 이름은 기기에 따라 달라요.</li>
        <li>J에게 아이콘으로 열고 ‘알림’ 메뉴에서 수신 설정을 확인해요.</li>
      </ol> : <ol>
        <li>Chrome·Edge의 주소창 설치 아이콘이나 메뉴의 앱 설치 항목을 확인해요.</li><li>Mac의 Safari는 지원되는 버전에서 ‘파일 → Dock에 추가’를 사용할 수 있어요.</li><li>설치 메뉴가 없어도 웹에서 계속 사용할 수 있어요.</li>
      </ol>}
      <p className="diagnostic-note">iPhone·iPad 웹 푸시는 iOS·iPadOS 16.4 이상이 필요해요. 기기나 브라우저에서 설치·알림을 지원하지 않으면 운영체제 업데이트를 확인해 주세요.</p>
    </div>
  </details>;
}
