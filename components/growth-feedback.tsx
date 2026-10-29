'use client';

import type { GrowthFeedback as Feedback } from '@/lib/growth-journey';

export function GrowthFeedback({ notice, onClose }: { notice: Feedback; onClose: () => void }) {
  return <section className={`growth-feedback ${notice.highlight ? 'is-milestone' : ''}`} aria-label="실천 보상">
    <span className="growth-feedback-mark" aria-hidden="true">{notice.stage}</span>
    <div role="status" aria-live="polite" aria-atomic="true"><strong>{notice.heading}</strong><p>{notice.detail}</p></div>
    <button type="button" onClick={onClose} aria-label="실천 보상 안내 닫기">닫기</button>
  </section>;
}
