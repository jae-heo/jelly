import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type Host, type Project, type Session } from './api';

interface Snapshot { projects: Project[]; sessions: Session[]; hosts: Host[] }
const empty: Snapshot = { projects: [], sessions: [], hosts: [] };

export function useWorkspaceData(token: string, onUnauthorized: () => void, onSnapshot: (data: Snapshot) => void) {
  const [data, setData] = useState<Snapshot>(empty);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const current = useRef({ token, onUnauthorized, onSnapshot });
  current.current = { token, onUnauthorized, onSnapshot };
  const refresh = useCallback(async (replace = true) => {
    if (!token || current.current.token !== token || (!replace && pending.current)) return;
    const version = ++generation.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const valid = () => !controller.signal.aborted && version === generation.current && current.current.token === token;
    try {
      const [p, s, h] = await Promise.all([
        api<{ projects: Project[] }>(token, '/projects', 'GET', undefined, controller.signal),
        api<{ sessions: Session[] }>(token, '/sessions', 'GET', undefined, controller.signal),
        api<{ hosts: Host[] }>(token, '/hosts', 'GET', undefined, controller.signal),
      ]);
      if (!valid()) return;
      const snapshot = { projects: p.projects, sessions: s.sessions, hosts: h.hosts };
      setData(snapshot); setOnline(true); current.current.onSnapshot(snapshot);
    } catch (error) {
      if (!valid()) return;
      if (error instanceof ApiError && error.status === 401) current.current.onUnauthorized();
      else setOnline(false);
    } finally {
      if (valid()) { pending.current = null; setLoading(false); }
    }
  }, [token]);
  useEffect(() => {
    setData(empty); setLoading(!!token); setOnline(true);
    if (!token) return;
    void refresh();
    const interval = setInterval(() => { if (!document.hidden) void refresh(false); }, 5000);
    const visible = () => { if (!document.hidden) void refresh(false); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      generation.current++; pending.current?.abort(); pending.current = null;
      clearInterval(interval); document.removeEventListener('visibilitychange', visible);
    };
  }, [token, refresh]);
  return {
    ...data, loading, online, refresh,
    addSession: (session: Session) => setData(previous => ({ ...previous, sessions: previous.sessions.some(s => s.id === session.id) ? previous.sessions : [...previous.sessions, session] })),
    addHost: (host: Host) => setData(previous => ({ ...previous, hosts: previous.hosts.some(h => h.id === host.id) ? previous.hosts : [...previous.hosts, host] })),
  };
}
