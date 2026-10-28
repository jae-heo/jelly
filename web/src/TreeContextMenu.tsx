import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type TreeTarget = { kind: 'project' | 'session'; id: string };
interface Anchor extends TreeTarget { x: number; y: number; trigger: HTMLElement }
export interface TreeAction { label: string; icon: ReactNode; run: () => void; danger?: boolean; disabled?: boolean; reason?: string }

export interface TreeDragHandlers {
  start: (target: TreeTarget, x: number, y: number) => boolean;
  move: (x: number, y: number) => void;
  end: () => void;
  cancel: () => void;
}
export function useTreeContextMenu(drag?: TreeDragHandlers) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const handlers = useRef(drag); handlers.current = drag;
  const hold = useRef<{ pointer: number; type: string; x: number; y: number; trigger: HTMLElement; target: TreeTarget;
    armed: boolean; dragging: boolean; timer: ReturnType<typeof setTimeout> } | null>(null);
  const suppressed = useRef<HTMLElement | null>(null);
  const clear = () => {
    const state = hold.current;
    if (state) {
      clearTimeout(state.timer);
      if (state.trigger.hasPointerCapture(state.pointer)) state.trigger.releasePointerCapture(state.pointer);
    }
    hold.current = null;
  };
  const cancel = () => { if (hold.current?.dragging) handlers.current?.cancel(); clear(); };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const state = hold.current;
      if (!state || event.pointerId !== state.pointer) return;
      if (!state.dragging && Math.hypot(event.clientX - state.x, event.clientY - state.y) > 10) {
        if (!state.armed && state.type !== 'mouse') { cancel(); return; }
        if (!handlers.current?.start(state.target, event.clientX, event.clientY)) { cancel(); return; }
        state.dragging = true; clearTimeout(state.timer); setAnchor(null); suppressed.current = state.trigger;
        try { state.trigger.setPointerCapture(state.pointer); } catch { /* Modeled events have no native pointer. */ }
      }
      if (state.dragging) { event.preventDefault(); handlers.current?.move(event.clientX, event.clientY); }
    };
    const end = () => { const dragging = hold.current?.dragging; clear(); if (dragging) handlers.current?.end(); };
    const another = (event: PointerEvent) => { if (hold.current && event.pointerId !== hold.current.pointer) cancel(); };
    const scroll = () => { if (!hold.current?.dragging) cancel(); };
    const touchMove = (event: TouchEvent) => { if (hold.current?.armed || hold.current?.dragging) event.preventDefault(); };
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && hold.current?.dragging) { event.preventDefault(); event.stopPropagation(); cancel(); }
    };
    document.addEventListener('pointerdown', another, true);
    document.addEventListener('pointermove', move, { capture: true, passive: false });
    document.addEventListener('pointerup', end, true);
    document.addEventListener('pointercancel', cancel, true);
    document.addEventListener('touchmove', touchMove, { capture: true, passive: false });
    document.addEventListener('keydown', key, true);
    document.addEventListener('scroll', scroll, true);
    document.addEventListener('visibilitychange', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    return () => {
      clear(); handlers.current?.cancel();
      document.removeEventListener('pointerdown', another, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', end, true);
      document.removeEventListener('pointercancel', cancel, true);
      document.removeEventListener('touchmove', touchMove, true);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('scroll', scroll, true);
      document.removeEventListener('visibilitychange', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
    };
  }, []);
  const bind = (target: TreeTarget) => ({
    'aria-haspopup': 'menu' as const,
    'aria-expanded': anchor?.kind === target.kind && anchor.id === target.id,
    onDragStart: (event: MouseEvent<HTMLElement>) => event.preventDefault(),
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault(); event.stopPropagation();
      if (hold.current?.dragging) return;
      if (hold.current) { clearTimeout(hold.current.timer); hold.current.armed = true; suppressed.current = event.currentTarget; }
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
      if (!event.isPrimary || event.button !== 0) return;
      const trigger = event.currentTarget, x = event.clientX, y = event.clientY;
      hold.current = { pointer: event.pointerId, type: event.pointerType, x, y, trigger, target, armed: false, dragging: false, timer: setTimeout(() => {
        if (!hold.current || !trigger.isConnected) return;
        hold.current.armed = true; suppressed.current = trigger;
        setAnchor({ ...target, trigger, x, y });
      }, 500) };
    },
    onMouseDownCapture: (event: MouseEvent<HTMLElement>) => {
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
