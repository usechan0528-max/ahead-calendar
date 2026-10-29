'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { editorDraftSnapshot } from '@/lib/editor-draft';

export function EventEditorDialog({ title, isSaving, isOffline = false, onClose, onSubmit, children, footer, error, locked = false, draftKept = false }: {
  title: string; isSaving: boolean; onClose: () => void;
  isOffline?: boolean; footer?: ReactNode; error?: string | null;
  locked?: boolean; draftKept?: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; children: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const confirmationRef = useRef<HTMLElement>(null);
  const resumeFocusRef = useRef<HTMLElement | null>(null);
  const baseline = useRef<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const current = useRef({ isSaving, isOffline, onClose, confirmClose });
  useLayoutEffect(() => { current.current = { isSaving, isOffline, onClose, confirmClose }; }, [isSaving, isOffline, onClose, confirmClose]);

  const changed = useCallback(() => {
    return !!formRef.current && baseline.current !== editorDraftSnapshot(new FormData(formRef.current));
  }, []);

  const requestClose = useCallback(() => {
    if (current.current.isSaving) return;
    if (!changed()) { current.current.onClose(); return; }
    resumeFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmClose(true);
  }, [changed]);

  const resume = useCallback(() => {
    setConfirmClose(false);
    requestAnimationFrame(() => resumeFocusRef.current?.focus());
  }, []);

  useEffect(() => {
    baseline.current = editorDraftSnapshot(new FormData(formRef.current!));
    if (!formRef.current?.contains(document.activeElement)) {
      (formRef.current?.querySelector<HTMLElement>('button:not(:disabled)') ?? formRef.current)?.focus();
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function keydown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (current.current.confirmClose) resume(); else requestClose();
      }
      if (event.key !== 'Tab') return;
      const dialog = current.current.confirmClose ? confirmationRef.current : formRef.current;
      const controls = Array.from(dialog?.querySelectorAll<HTMLElement>('button, summary, input:not([type="hidden"]), select, textarea, a[href], [tabindex="0"]') ?? [])
        .filter((element) => !element.matches(':disabled') && element.getClientRects().length > 0);
      const first = controls[0]; const last = controls.at(-1);
      if (!first) { event.preventDefault(); dialog?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!current.current.isSaving && !changed()) return;
      event.preventDefault(); event.returnValue = '';
    }
    window.addEventListener('keydown', keydown);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [changed, requestClose, resume]);

  useEffect(() => {
    if (confirmClose) confirmationRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [confirmClose]);

  return <>
    <div className="mobile-dialog-layer fixed inset-0 z-50 grid place-items-end overflow-y-auto bg-[#25342e]/40 p-0 backdrop-blur-sm sm:place-items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }} role="presentation" inert={confirmClose}>
      <form ref={formRef} role="dialog" aria-modal="true" aria-label={title} aria-busy={isSaving} tabIndex={-1} onInvalidCapture={(event) => {
        // Native form validation must be able to reveal and focus a collapsed field.
        if (!(event.target instanceof HTMLElement)) return;
        let ancestor = event.target.parentElement;
        while (ancestor && ancestor !== formRef.current) {
          if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
          ancestor = ancestor.parentElement;
        }
      }} onSubmit={(event) => {
        if (current.current.isSaving || current.current.confirmClose || current.current.isOffline) { event.preventDefault(); return; }
        onSubmit(event);
      }} className="event-editor-form relative max-h-[calc(100dvh-24px)] w-full max-w-[500px] rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px]">
        <div className="event-editor-toolbar"><h2>{title}</h2><button type="button" aria-label="닫기" disabled={isSaving} onClick={requestClose}>닫기</button></div>
        <div className="event-editor-scroll">
          {isOffline && <p className="editor-connection-notice" role="status">인터넷 연결 후 저장할 수 있어요.{draftKept ? ' 이 기기에 임시 보관한 내용은 이어 쓸 수 있어요.' : ' 임시 보관을 선택하지 않으면 새로고침할 때 내용이 사라져요.'}</p>}
          {locked && <p className="editor-connection-notice" role="status">먼저 저장 결과를 확인해 주세요. 같은 요청으로 다시 확인해도 일정이 중복 생성되지 않아요.</p>}
          <fieldset disabled={isSaving || locked} className="min-w-0">{children}</fieldset>
        </div>
        {footer && <div className="event-editor-footer">{error && <p className="event-editor-error" role="alert">{error}</p>}{footer}</div>}
      </form>
    </div>
    {confirmClose && <div className="mobile-dialog-layer fixed inset-0 z-[60] grid place-items-center bg-[#25342e]/45 p-5 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) resume(); }} role="presentation">
      <section ref={confirmationRef} role="alertdialog" aria-modal="true" aria-labelledby="discard-draft-title" aria-describedby="discard-draft-description" tabIndex={-1} className="w-full max-w-[380px] rounded-[24px] bg-white p-6 shadow-2xl">
        <h2 id="discard-draft-title" className="text-[22px] font-semibold">작성을 그만둘까요?</h2>
        <p id="discard-draft-description" className="mt-3 text-[16px] leading-relaxed text-[#657260]">{locked ? '저장이 완료됐을 수도 있어요. 새 일정 추가를 다시 열어 저장 결과를 확인해 주세요.' : draftKept ? '임시 보관한 내용은 새 일정 추가에서 이어 쓸 수 있어요.' : '저장하지 않은 내용이 있어요. 계속 작성하면 입력한 내용이 그대로 유지돼요.'}</p>
        <div className="mt-6 grid gap-2">
          <button type="button" onClick={resume} className="min-h-11 rounded-xl bg-[#294e3e] px-4 py-3 text-[14px] font-semibold text-white">계속 작성</button>
          <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-[#e2e7dc] px-4 py-3 text-[14px] font-semibold text-[#a45a4f]">{locked ? '나중에 확인' : draftKept ? '임시 보관하고 닫기' : '내용 버리고 닫기'}</button>
        </div>
      </section>
    </div>}
  </>;
}
