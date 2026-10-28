import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Project, Session } from './api';
import type { TreeTarget } from './TreeContextMenu';

export type MoveTreeItem = (target: TreeTarget, beforeId: string | null) => Promise<void>;
interface Drag { target: TreeTarget; name: string; x: number; y: number; beforeId: string | null; valid: boolean; top: number; left: number; width: number }
export function useTreeReorder(tree: RefObject<HTMLElement | null>, projects: Project[], sessions: Session[], onMove: MoveTreeItem) {
  const current = useRef({ projects, sessions, onMove }); current.current = { projects, sessions, onMove };
  const live = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const frame = useRef(0);
  const cancel = () => { cancelAnimationFrame(frame.current); frame.current = 0; live.current = null; setDrag(null); };
  useEffect(() => () => { cancelAnimationFrame(frame.current); live.current = null; }, []);
  const update = (x: number, y: number) => {
    const state = live.current, list = tree.current;
    if (!state || !list) return;
    const source = state.target.kind === 'project' ? current.current.projects.find(p => p.id === state.target.id) : current.current.sessions.find(s => s.id === state.target.id);
    if (!source) { cancel(); return; }
    const group = state.target.kind === 'project' ? list : list.querySelector<HTMLElement>(`[data-project-id="${(source as Session).projectId}"] .project-children`);
    if (!group) { cancel(); return; }
    const bounds = list.getBoundingClientRect(), area = group.getBoundingClientRect();
    const rows = Array.from(group.querySelectorAll<HTMLElement>(state.target.kind === 'project' ? ':scope > ul > .project-branch' : ':scope > .session-row'))
      .filter(row => (state.target.kind === 'project' ? row.dataset.projectId : row.dataset.sessionId) !== state.target.id);
    const next = rows.find(row => {
      const rect = (state.target.kind === 'project' ? row.querySelector('.project-heading')! : row).getBoundingClientRect();
      return y < rect.top + rect.height / 2;
    });
    const valid = x >= bounds.left && x <= bounds.right && y >= Math.max(bounds.top, area.top) && y <= Math.min(bounds.bottom, area.bottom);
    const edge = next?.getBoundingClientRect().top ?? rows.at(-1)?.getBoundingClientRect().bottom ?? area.top;
    const changed = { ...state, x, y, valid, beforeId: next ? (state.target.kind === 'project' ? next.dataset.projectId! : next.dataset.sessionId!) : null,
      top: Math.max(bounds.top, Math.min(bounds.bottom, edge)), left: area.left + 6, width: area.width - 12 };
    live.current = changed; setDrag(changed);
  };
  const save = async (target: TreeTarget, beforeId: string | null) => {
    if (pending.current) return;
    pending.current = true; setSaving(true);
    try { await current.current.onMove(target, beforeId); }
    finally { pending.current = false; setSaving(false); }
  };
  const handlers = {
    start: (target: TreeTarget, x: number, y: number) => {
      if (pending.current) return false;
      const source = target.kind === 'project' ? current.current.projects.find(p => p.id === target.id) : current.current.sessions.find(s => s.id === target.id);
      if (!source) return false;
      live.current = { target, name: source.name, x, y, beforeId: null, valid: false, top: 0, left: 0, width: 0 };
      update(x, y);
      let previous = performance.now();
      const tick = (now: number) => {
        const state = live.current, list = tree.current;
        if (!state || !list) return;
        const bounds = list.getBoundingClientRect();
        const elapsed = Math.min(32, now - previous); previous = now;
        if (state.x >= bounds.left && state.x <= bounds.right && state.y >= bounds.top - 20 && state.y <= bounds.bottom + 20) {
          const speed = state.y < bounds.top + 40 ? -Math.min(1, (bounds.top + 40 - state.y) / 40)
            : state.y > bounds.bottom - 40 ? Math.min(1, (state.y - bounds.bottom + 40) / 40) : 0;
          if (speed) { list.scrollTop += speed * elapsed * .6; update(state.x, state.y); }
        }
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick); return true;
    },
    move: update,
    end: () => {
      const state = live.current; cancel();
      if (!state?.valid) return;
      const items = state.target.kind === 'project' ? current.current.projects : current.current.sessions.filter(s => s.projectId === current.current.sessions.find(item => item.id === state.target.id)?.projectId);
      const index = items.findIndex(item => item.id === state.target.id);
      if (index < 0 || (items[index + 1]?.id ?? null) === state.beforeId) return;
      void save(state.target, state.beforeId);
    },
    cancel,
  };
  const overlay = drag ? createPortal(<>
    {drag.valid && <div className="tree-drop-line" style={{ top: drag.top, left: drag.left, width: drag.width }} />}
    <div className="tree-drag-preview" style={{ left: Math.max(8, Math.min(drag.x + 12, innerWidth - 228)), top: Math.max(8, Math.min(drag.y + 12, innerHeight - 48)) }}>{drag.name}</div>
  </>, document.body) : null;
  return { drag, saving, handlers, save, overlay };
}
