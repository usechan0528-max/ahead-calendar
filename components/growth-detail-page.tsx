'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AppIcon } from './calendar-workspace';
import { GrowthDetails } from './growth-panel';
import { useGrowth } from './use-growth';
import { useConnectionStatus } from './use-connection-status';
import { getSeoulDate } from '@/lib/recurrence';

export function GrowthDetailPage() {
  const [now, setNow] = useState(() => Date.now());
  const growth = useGrowth(undefined, getSeoulDate(new Date(now)), now);
  const online = useConnectionStatus();
  const heading = useRef<HTMLHeadingElement>(null);
  const guideFocused = useRef(false);
  const ready = !!growth.progress;

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 60_000);
    window.addEventListener('focus', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); };
  }, []);
  useEffect(() => {
    if (!ready || guideFocused.current || window.location.hash !== '#daily-goal-guide') return;
    const frame = requestAnimationFrame(() => {
      const guide = document.getElementById('daily-goal-guide');
      guide?.focus({ preventScroll: true }); guide?.scrollIntoView({ block: 'center' });
      guideFocused.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  return <div className="growth-detail-page">
    <a href="#growth-detail-main" className="skip-link">본문으로 바로가기</a>
    <header className="growth-detail-header"><div><Link href="/#growth-record" className="growth-detail-back"><AppIcon name="left" size={22} />오늘로</Link><span className="growth-detail-brand">J에게</span></div></header>
    <main id="growth-detail-main" tabIndex={-1}>
      <h1 ref={heading} tabIndex={-1}>성장 상세</h1>
      {!online && <p className="connection-notice" role="status">오프라인이에요. 연결 후 최신 기록을 확인할 수 있어요.</p>}
      <GrowthDetails progress={growth.progress} error={growth.error} busy={growth.busy || !online} onGoal={growth.setGoal} onRetry={growth.refresh} />
    </main>
  </div>;
}
