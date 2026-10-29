'use client';

import { Fragment } from 'react';
import { AppIcon } from '@/components/calendar-workspace';
import { workspaceNavigation, type WorkspaceView } from '@/components/workspace-overview';

export function MobileNavigation({ view, detailOpen, hidden, onNavigate, onCreate }: {
  view: WorkspaceView; detailOpen: boolean; hidden: boolean;
  onNavigate: (view: WorkspaceView) => void; onCreate: () => void;
}) {
  return <nav className="mobile-navigation" aria-label="하단 메뉴" hidden={hidden}>
    {workspaceNavigation.map((item, index) => <Fragment key={item.id}>
      {index === 2 && <button type="button" className="mobile-create" onClick={onCreate} aria-label="새 일정 추가"><span className="mobile-navigation-icon mobile-create-mark" aria-hidden="true"><AppIcon name="plus" size={24} /></span><span>추가</span></button>}
      <button type="button" aria-current={view === item.id && !detailOpen ? 'page' : undefined} onClick={() => onNavigate(item.id)}><span className="mobile-navigation-icon" aria-hidden="true"><AppIcon name={item.icon} size={22} /></span><span>{item.short}</span></button>
    </Fragment>)}
  </nav>;
}
