import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type TreeTarget = { kind: 'project' | 'session'; id: string };
interface Anchor extends TreeTarget { x: number; y: number; trigger: HTMLElement }
export interface TreeAction { label: string; icon: ReactNode; run: () => void; danger?: boolean; disabled?: boolean; reason?: string }

export function useTreeContextMenu() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const hold = useRef<{ pointer: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const suppressed = useRef<HTMLElement | null>(null);
  const cancel = () => { if (hold.current) clearTimeout(hold.current.timer); hold.current = null; };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = hold.current;
      if (current && (event.pointerId !== current.pointer || Math.hypot(event.clientX - current.x, event.clientY - current.y) > 10)) cancel();
    };
    const another = (event: PointerEvent) => { if (hold.current && event.pointerId !== hold.current.pointer) cancel(); };
    document.addEventListener('pointerdown', another, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', cancel, true);
    document.addEventListener('pointercancel', cancel, true);
    document.addEventListener('scroll', cancel, true);
    document.addEventListener('visibilitychange', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    return () => {
      cancel();
      document.removeEventListener('pointerdown', another, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', cancel, true);
      document.removeEventListener('pointercancel', cancel, true);
      document.removeEventListener('scroll', cancel, true);
      document.removeEventListener('visibilitychange', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
    };
  }, []);
  const bind = (target: TreeTarget) => ({
    'aria-haspopup': 'menu' as const,
    'aria-expanded': anchor?.kind === target.kind && anchor.id === target.id,
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault(); event.stopPropagation();
      const holding = !!hold.current; cancel();
      if (holding) suppressed.current = event.currentTarget;
      if (suppressed.current === event.currentTarget && anchor) return;
      const rect = event.currentTarget.getBoundingClientRect();
      setAnchor({ ...target, trigger: event.currentTarget, x: event.clientX || rect.left + 12, y: event.clientY || rect.bottom });
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      event.preventDefault(); event.stopPropagation(); cancel();
      const rect = event.currentTarget.getBoundingClientRect();
      setAnchor({ ...target, trigger: event.currentTarget, x: rect.left + 12, y: rect.bottom });
    },
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      cancel(); suppressed.current = null;
      if (event.pointerType === 'mouse' || !event.isPrimary || event.button !== 0) return;
      const trigger = event.currentTarget, x = event.clientX, y = event.clientY;
      hold.current = { pointer: event.pointerId, x, y, timer: setTimeout(() => {
        hold.current = null;
        if (!trigger.isConnected) return;
        suppressed.current = trigger;
        setAnchor({ ...target, trigger, x, y });
      }, 500) };
    },
    onMouseDownCapture: (event: MouseEvent<HTMLElement>) => {
      // Touch release synthesizes mousedown before click. Keep that event from
      // refocusing the row and closing the menu before the click is suppressed.
      if (suppressed.current === event.currentTarget) event.preventDefault();
    },
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (suppressed.current !== event.currentTarget) return;
      suppressed.current = null; event.preventDefault(); event.stopPropagation();
    },
  });
  return { anchor, bind, close: () => { cancel(); setAnchor(null); } };
}

export function TreeContextMenu({ anchor, name, actions, onClose }: { anchor: Anchor; name: string; actions: TreeAction[]; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const currentClose = useRef(onClose);
  currentClose.current = onClose;
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const viewport = visualViewport;
    const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
    element.style.maxHeight = `${Math.max(0, height - 16)}px`;
    element.style.maxWidth = `${Math.max(0, width - 16)}px`;
    element.style.left = `${Math.max(left + 8, Math.min(anchor.x, left + width - element.offsetWidth - 8))}px`;
    element.style.top = `${Math.max(top + 8, Math.min(anchor.y, top + height - element.offsetHeight - 8))}px`;
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [anchor]);
  useEffect(() => {
    const outside = (event: Event) => { if (!menu.current?.contains(event.target as Node)) currentClose.current(); };
    const close = () => currentClose.current();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    document.addEventListener('scroll', outside, true);
    document.addEventListener('visibilitychange', close);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    visualViewport?.addEventListener('resize', close);
    visualViewport?.addEventListener('scroll', close);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('scroll', outside, true);
      document.removeEventListener('visibilitychange', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      visualViewport?.removeEventListener('resize', close);
      visualViewport?.removeEventListener('scroll', close);
    };
  }, []);
  const close = () => { anchor.trigger.focus({ preventScroll: true }); onClose(); };
  return createPortal(<div ref={menu} role="menu" aria-label={`${name} options`} className="tree-context-menu" onContextMenu={event => event.preventDefault()} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'Tab') { close(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus({ preventScroll: true });
  }}>
    <div className="tree-context-title" title={name}>{name}</div>
    {actions.map(action => <button key={action.label} role="menuitem" tabIndex={-1} disabled={action.disabled} title={action.reason} className={action.danger ? 'menu-danger' : ''}
      onClick={() => { close(); action.run(); }}>{action.icon}<span>{action.label}{action.reason && <small>{action.reason}</small>}</span></button>)}
  </div>, document.body);
}
