import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={`dialog ${className}`} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (event.target === ref.current) { const bounds = ref.current.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); }
  }}>
    <div className="dialog-header"><h2>{title}</h2><button className="icon-button" aria-label="닫기" onClick={onClose}><X size={19} /></button></div>
    {children}
  </dialog>;
}
