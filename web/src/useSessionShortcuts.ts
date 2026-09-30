import { useEffect, useRef } from 'react';
import type { Project, Session } from './api';

interface Options {
  enabled: boolean;
  projects: Project[];
  sessions: Session[];
  projectId: string | null;
  sessionId: string | null;
  onSelect: (session: Session) => void;
  onCreate: (project: Project) => void;
}

export function useSessionShortcuts(options: Options) {
  const current = useRef(options);
  current.current = options;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { enabled, projects, sessions, projectId, sessionId, onSelect, onCreate } = current.current;
      if (!enabled || event.isComposing || event.keyCode === 229 || !event.metaKey || !event.shiftKey || event.ctrlKey || event.altKey) return;
      if (event.code === 'Enter' || event.code === 'NumpadEnter') {
        const project = projects.find(project => project.id === projectId);
        if (!project) return;
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat) onCreate(project);
        return;
      }
      if (!sessions.length) return;
      const direction = event.code === 'Comma' ? -1 : event.code === 'Period' ? 1 : 0;
      if (!direction) return;
      const groups = projects.map(project => sessions.filter(session => session.projectId === project.id));
      const ordered = groups.flat();
      if (!ordered.length) return;
      // Capture before xterm or an input field consumes the shortcut.
      event.preventDefault();
      event.stopPropagation();
      const index = ordered.findIndex(session => session.id === sessionId);
      let session: Session | undefined;
      if (index >= 0) session = ordered[(index + direction + ordered.length) % ordered.length];
      else {
        // A manually selected project has no active session yet. Start there,
        // then walk past empty projects in the requested direction.
        const projectIndex = projects.findIndex(project => project.id === projectId);
        const start = projectIndex < 0 ? (direction > 0 ? 0 : projects.length - 1) : projectIndex;
        for (let offset = 0; offset < groups.length && !session; offset++) {
          const group = groups[(start + direction * offset + groups.length) % groups.length]!;
          session = direction > 0 ? group[0] : group.at(-1);
        }
      }
      if (!session) return;
      if (session.id !== sessionId) onSelect(session);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
