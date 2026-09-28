import { useEffect, useRef } from 'react';
import type { Session } from './api';

interface Options {
  enabled: boolean;
  sessions: Session[];
  sessionId: string | null;
  onSelect: (session: Session) => void;
}

export function useSessionShortcuts(options: Options) {
  const current = useRef(options);
  current.current = options;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { enabled, sessions, sessionId, onSelect } = current.current;
      if (!enabled || !sessions.length || event.isComposing || !event.metaKey || !event.shiftKey || event.ctrlKey || event.altKey) return;
      const direction = event.code === 'Comma' ? -1 : event.code === 'Period' ? 1 : 0;
      if (!direction) return;
      // Capture before xterm or an input field consumes the shortcut.
      event.preventDefault();
      event.stopPropagation();
      const index = sessions.findIndex(session => session.id === sessionId);
      const next = index < 0 ? (direction > 0 ? 0 : sessions.length - 1)
        : (index + direction + sessions.length) % sessions.length;
      const session = sessions[next]!;
      if (session.id !== sessionId) onSelect(session);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
