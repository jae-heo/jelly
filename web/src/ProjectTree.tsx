import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, ChevronRight, Folder, FolderOpen, Pencil, Plus, Server, Square, Trash2 } from 'lucide-react';
import type { Project, Session } from './api';
import './ProjectTree.css';
import { useTreeReorder, type MoveTreeItem } from './useTreeReorder';
import { TreeContextMenu, useTreeContextMenu, type TreeAction } from './TreeContextMenu';

const stateLabels = { running: 'Running', exited: 'Ended', stopped: 'Ended', lost: 'No sessions', unreachable: 'Server unreachable' };

interface Props {
  projects: Project[];
  sessions: Session[];
  projectId: string | null;
  sessionId: string | null;
  loading: boolean;
  open: boolean;
  onProject: (id: string) => void;
  onSession: (session: Session) => void;
  onNewSession: (project: Project) => void;
  onDeleteSession: (session: Session) => void;
  onRemoveSession: (session: Session) => void;
  onStopSession: (session: Session) => void;
  onRenameSession: (session: Session) => void;
  onRenameProject: (project: Project) => void;
  onRemoveProject: (project: Project) => void;
  onFiles: (project: Project) => void;
  onMove: MoveTreeItem;
}

export function ProjectTree({ projects, sessions, projectId, sessionId, loading, open, onProject, onSession, onNewSession, onRemoveSession, onDeleteSession, onStopSession, onRenameSession, onRenameProject, onRemoveProject, onFiles, onMove }: Props) {
  const tree = useRef<HTMLElement>(null);
  const reorder = useTreeReorder(tree, projects, sessions, onMove);
  const context = useTreeContextMenu(reorder.handlers);
  useEffect(() => { context.close(); }, [open, projectId, sessionId]);
  const target = context.anchor?.kind === 'project' ? projects.find(p => p.id === context.anchor?.id) : sessions.find(s => s.id === context.anchor?.id);
  const actions: TreeAction[] = [];
  if (target && context.anchor?.kind === 'project') {
    const p = target as Project;
    actions.push(
      { label: 'Files', icon: <FolderOpen size={16} />, run: () => onFiles(p) },
      { label: 'New session', icon: <Plus size={16} />, run: () => onNewSession(p) },
      { label: 'Rename project', icon: <Pencil size={16} />, run: () => onRenameProject(p) },
      { label: 'Delete project', icon: <Trash2 size={16} />, danger: true, run: () => onRemoveProject(p) },
    );
  } else if (target) {
    const s = target as Session;
    actions.push({ label: 'Rename session', icon: <Pencil size={16} />, run: () => onRenameSession(s) });
    if (s.status === 'running' || s.status === 'unreachable') actions.push({ label: 'Stop session', icon: <Square size={16} />, danger: true, run: () => onStopSession(s) });
    if (s.status === 'running' || s.status === 'unreachable') actions.push({ label: 'Delete session', icon: <Trash2 size={16} />, danger: true, run: () => onDeleteSession(s) });
    else actions.push({ label: 'Remove record', icon: <Trash2 size={16} />, danger: true, run: () => onRemoveSession(s) });
  }
  if (target && context.anchor) {
    const anchor = context.anchor;
    const items = anchor.kind === 'project' ? projects : sessions.filter(s => s.projectId === (target as Session).projectId);
    const index = items.findIndex(item => item.id === target.id);
    actions.splice(actions.length - 1, 0,
      { label: 'Move up', icon: <ArrowUp size={16} />, disabled: reorder.saving || index <= 0, run: () => { void reorder.save(anchor, items[index - 1]!.id); } },
      { label: 'Move down', icon: <ArrowDown size={16} />, disabled: reorder.saving || index >= items.length - 1, run: () => { void reorder.save(anchor, items[index + 2]?.id ?? null); } },
    );
  }
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const activeRow = useRef<HTMLLIElement>(null);
  function expand(id: string) {
    setCollapsed(previous => {
      if (!previous.has(id)) return previous;
      const next = new Set(previous); next.delete(id); return next;
    });
  }
  // A shortcut can enter a folded project. Polling must not undo manual folds.
  useLayoutEffect(() => { if (projectId) expand(projectId); }, [projectId, sessionId]);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      const list = tree.current;
      const row = activeRow.current;
      if (!list || !row?.getClientRects().length) return;
      const bounds = list.getBoundingClientRect();
      const selected = row.getBoundingClientRect();
      // Only scroll this list. scrollIntoView also pans outer containers and
      // the visual viewport on iOS, competing with keyboard focus scrolling.
      if (selected.top < bounds.top) list.scrollTop += selected.top - bounds.top;
      else if (selected.bottom > bounds.bottom) list.scrollTop += selected.bottom - bounds.bottom;
    });
    return () => cancelAnimationFrame(frame);
  }, [projectId, sessionId, open]);

  return <><nav ref={tree} className="project-tree" data-tree-dragging={!!reorder.drag} aria-busy={reorder.saving} aria-label="Projects and sessions">
    <ul className="project-tree-list">
      {projects.map(project => {
        const expanded = !collapsed.has(project.id);
        const children = sessions.filter(session => session.projectId === project.id);
        return <li key={project.id} className={`project-branch ${reorder.drag?.target.id === project.id ? 'tree-drag-source' : ''}`} data-project-id={project.id}>
          <div className={`project-heading ${project.id === projectId ? 'active' : ''}`}>
            <button className="tree-toggle" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${project.name}`}
              aria-expanded={expanded} aria-controls={`project-sessions-${project.id}`}
              onClick={() => setCollapsed(previous => {
                const next = new Set(previous);
                if (next.has(project.id)) next.delete(project.id); else next.add(project.id);
                return next;
              })}><ChevronRight size={14} /></button>
            <button className={`project-item ${project.id === projectId ? 'selected' : ''}`} title={project.name} {...context.bind({ kind: 'project', id: project.id })}
              onClick={() => { expand(project.id); onProject(project.id); }}>
              <Folder size={16} /><span>{project.name}</span>{project.hostId && <Server size={13} aria-label="SSH host" />}
            </button>
            <button className="icon-button tree-add" aria-label={`New session in ${project.name}`} onClick={() => onNewSession(project)}><Plus size={16} /></button>
          </div>
          <ul id={`project-sessions-${project.id}`} className="project-children" aria-label={`${project.name} sessions`} hidden={!expanded}>
            {children.map(session => <li key={session.id} ref={session.id === sessionId ? activeRow : undefined}
              data-session-id={session.id} className={`session-row ${session.id === sessionId ? 'selected' : ''} ${reorder.drag?.target.id === session.id ? 'tree-drag-source' : ''}`}>
              <button className="session-item" aria-current={session.id === sessionId ? 'true' : undefined}
                {...context.bind({ kind: 'session', id: session.id })}
                aria-label={`${session.name} · ${stateLabels[session.status]}`} title={`${session.name} · ${stateLabels[session.status]}`}
                onClick={() => onSession(session)}>
                <span className={`session-dot ${session.status}`} /><span className="session-text"><strong>{session.name}</strong></span>
              </button>
              {session.status !== 'running' && session.status !== 'unreachable' && <button className="icon-button remove-session"
                aria-label={`Remove record for ${session.name}`} onClick={() => onRemoveSession(session)}><Trash2 size={14} /></button>}
            </li>)}
            {!children.length && <li className="tree-empty">{loading ? 'Loading…' : 'No sessions'}</li>}
          </ul>
        </li>;
      })}
    </ul>
    {!projects.length && <p className="sidebar-empty">{loading ? 'Loading…' : 'No projects'}</p>}
  </nav>{reorder.overlay}{context.anchor && target && <TreeContextMenu anchor={context.anchor} name={target.name} actions={actions} onClose={context.close} />}</>;
}
