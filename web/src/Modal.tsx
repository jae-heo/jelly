import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    // showModal focuses the first focusable element (Close) and ignores React's
    // autoFocus, which runs while the dialog is still closed.
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className={`dialog ${className}`} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (event.target === ref.current) { const bounds = ref.current.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); }
  }}>
    <div className="dialog-header"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Close" onClick={onClose}><X size={19} /></button></div>
    {children}
  </dialog>;
}
