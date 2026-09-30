import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight, Folder, Plus, Server, Trash2 } from 'lucide-react';
import type { Project, Session } from './api';
import './ProjectTree.css';

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
  onRemoveSession: (session: Session) => void;
}

export function ProjectTree({ projects, sessions, projectId, sessionId, loading, open, onProject, onSession, onNewSession, onRemoveSession }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const tree = useRef<HTMLElement>(null);
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

  return <nav ref={tree} className="project-tree" aria-label="Projects and sessions">
    <ul className="project-tree-list">
      {projects.map(project => {
        const expanded = !collapsed.has(project.id);
        const children = sessions.filter(session => session.projectId === project.id);
        return <li key={project.id} className="project-branch" data-project-id={project.id}>
          <div className={`project-heading ${project.id === projectId ? 'active' : ''}`}>
            <button className="tree-toggle" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${project.name}`}
              aria-expanded={expanded} aria-controls={`project-sessions-${project.id}`}
              onClick={() => setCollapsed(previous => {
                const next = new Set(previous);
                if (next.has(project.id)) next.delete(project.id); else next.add(project.id);
                return next;
              })}><ChevronRight size={14} /></button>
            <button className={`project-item ${project.id === projectId ? 'selected' : ''}`} title={project.name}
              onClick={() => { expand(project.id); onProject(project.id); }}>
              <Folder size={16} /><span>{project.name}</span>{project.hostId && <Server size={13} aria-label="SSH host" />}
            </button>
            <button className="icon-button tree-add" aria-label={`New session in ${project.name}`} onClick={() => onNewSession(project)}><Plus size={16} /></button>
          </div>
          <ul id={`project-sessions-${project.id}`} className="project-children" aria-label={`${project.name} sessions`} hidden={!expanded}>
            {children.map(session => <li key={session.id} ref={session.id === sessionId ? activeRow : undefined}
              className={`session-row ${session.id === sessionId ? 'selected' : ''}`}>
              <button className="session-item" aria-current={session.id === sessionId ? 'true' : undefined}
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
  </nav>;
}
