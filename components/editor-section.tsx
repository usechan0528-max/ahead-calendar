'use client';

import { useState, type ReactNode } from 'react';

/** Keep every field mounted so collapsing an option never discards its saved value. */
export function EditorSection({ title, summary, initialOpen = false, children }: {
  title: string; summary?: string; initialOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(initialOpen);
  return <details className="editor-section" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><span>{title}{summary && <small>{summary}</small>}</span><span className="editor-section-action" aria-hidden="true" /></summary>
    <div className="editor-section-content">{children}</div>
  </details>;
}
