import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight, Folder, Plus, Server, Trash2 } from 'lucide-react';
import type { Project, Session } from './api';
import './ProjectTree.css';

const stateLabels = { running: '실행 중', exited: '종료됨', stopped: '종료됨', lost: '세션 없음', unreachable: '서버 연결 안 됨' };

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
      if (activeRow.current?.getClientRects().length) activeRow.current.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [projectId, sessionId, open]);

  return <nav className="project-tree" aria-label="프로젝트와 세션">
    <ul className="project-tree-list">
      {projects.map(project => {
        const expanded = !collapsed.has(project.id);
        const children = sessions.filter(session => session.projectId === project.id);
        return <li key={project.id} className="project-branch" data-project-id={project.id}>
          <div className={`project-heading ${project.id === projectId ? 'active' : ''}`}>
            <button className="tree-toggle" aria-label={`${project.name} ${expanded ? '접기' : '펼치기'}`}
              aria-expanded={expanded} aria-controls={`project-sessions-${project.id}`}
              onClick={() => setCollapsed(previous => {
                const next = new Set(previous);
                if (next.has(project.id)) next.delete(project.id); else next.add(project.id);
                return next;
              })}><ChevronRight size={14} /></button>
            <button className={`project-item ${project.id === projectId ? 'selected' : ''}`} title={project.name}
              onClick={() => { expand(project.id); onProject(project.id); }}>
              <Folder size={16} /><span>{project.name}</span>{project.hostId && <Server size={13} aria-label="SSH 서버" />}
            </button>
            <button className="icon-button tree-add" aria-label={`${project.name} 새 세션`} onClick={() => onNewSession(project)}><Plus size={16} /></button>
          </div>
          <ul id={`project-sessions-${project.id}`} className="project-children" aria-label={`${project.name} 세션`} hidden={!expanded}>
            {children.map(session => <li key={session.id} ref={session.id === sessionId ? activeRow : undefined}
              className={`session-row ${session.id === sessionId ? 'selected' : ''}`}>
              <button className="session-item" aria-current={session.id === sessionId ? 'true' : undefined}
                aria-label={`${session.name} · ${stateLabels[session.status]}`} title={`${session.name} · ${stateLabels[session.status]}`}
                onClick={() => onSession(session)}>
                <span className={`session-dot ${session.status}`} /><span className="session-text"><strong>{session.name}</strong></span>
              </button>
              {session.status !== 'running' && session.status !== 'unreachable' && <button className="icon-button remove-session"
                aria-label={`${session.name} 기록 삭제`} onClick={() => onRemoveSession(session)}><Trash2 size={14} /></button>}
            </li>)}
            {!children.length && <li className="tree-empty">{loading ? '불러오는 중…' : '세션 없음'}</li>}
          </ul>
        </li>;
      })}
    </ul>
    {!projects.length && <p className="sidebar-empty">{loading ? '불러오는 중…' : '프로젝트 없음'}</p>}
  </nav>;
}
