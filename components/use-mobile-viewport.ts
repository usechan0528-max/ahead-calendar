'use client';

import { useEffect } from 'react';
import { mobileViewport } from '@/lib/mobile-viewport';

export function useMobileViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const active = document.activeElement;
        const editing = active instanceof HTMLElement && active.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, [contenteditable="true"]');
        const metrics = mobileViewport({ layoutHeight: window.innerHeight, height: viewport?.height ?? window.innerHeight, offsetTop: viewport?.offsetTop ?? 0, scale: viewport?.scale ?? 1, editing });
        if (!metrics) {
          root.style.removeProperty('--app-visible-height'); root.style.removeProperty('--app-visible-top');
          root.removeAttribute('data-mobile-keyboard'); return;
        }
        root.style.setProperty('--app-visible-height', `${metrics.height}px`);
        root.style.setProperty('--app-visible-top', `${metrics.top}px`);
        root.toggleAttribute('data-mobile-keyboard', metrics.keyboard);
      });
    };
    update();
    viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    document.addEventListener('focusin', update); document.addEventListener('focusout', update);
    const dock = document.querySelector('.mobile-navigation');
    const observer = typeof ResizeObserver !== 'undefined' && dock ? new ResizeObserver(entries => {
      const height = entries[0]?.target.getBoundingClientRect().height ?? 0;
      // Hidden navigation during editing must not collapse the page's reserved space.
      if (height > 0) root.style.setProperty('--mobile-dock-height', `${Math.ceil(height)}px`);
    }) : null;
    if (dock) observer?.observe(dock);
    return () => {
      window.cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      document.removeEventListener('focusin', update); document.removeEventListener('focusout', update);
      root.style.removeProperty('--app-visible-height'); root.style.removeProperty('--app-visible-top'); root.removeAttribute('data-mobile-keyboard');
      observer?.disconnect(); root.style.removeProperty('--mobile-dock-height');
    };
  }, []);
}
