import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { Config } from './config.js';
import { ApiError } from './http.js';
import { listDirectories } from './directories.js';
import { HostStateCache } from './host-state-cache.js';
import { RemoteTmux } from './remote.js';
import { Store, type Session } from './store.js';
import { Tmux, type TerminalState, type TmuxSession } from './tmux.js';

export interface Unregistered { id: string; hostId: string | null; status: 'running' | 'exited'; path: string | null; createdAt: string | null }

export class Execution {
  readonly local: Tmux;
  private stateCache = new HostStateCache<Map<string, TmuxSession>>();
  constructor(readonly config: Config, readonly store: Store) { this.local = new Tmux(config); }
  remote(hostId: string): RemoteTmux {
    const host = this.store.host(hostId);
    if (!host) throw new ApiError(404, 'SSH server not found');
    return new RemoteTmux(this.config, host);
  }
  private hostId(id: string): string | null {
    const session = this.store.session(id);
    const project = session && this.store.project(session.projectId);
    if (!project) throw new ApiError(404, 'Session not found');
    return project.hostId;
  }
  isRemote(id: string): boolean { return this.hostId(id) !== null; }
  private backend(hostId: string | null): Tmux { return hostId ? this.remote(hostId) : this.local; }
  async check(): Promise<void> { await this.local.check(); }
  async directory(path: string, hostId: string | null): Promise<string> {
    if (!isAbsolute(path) || path.includes('\0')) throw new ApiError(400, 'Project path must be absolute');
    if (hostId) return (await this.remote(hostId).directories(path, false, false)).path;
    try {
      const canonical = await realpath(path);
      if (!(await stat(canonical)).isDirectory()) throw new Error();
      return canonical;
    } catch { throw new ApiError(400, 'Project directory does not exist or is inaccessible'); }
  }
  directories(hostId: string | null, path?: string, hidden = false) {
    return hostId ? this.remote(hostId).directories(path, hidden) : listDirectories(path, hidden);
  }
  private async hostStates(hostId: string | null, bounded: boolean): Promise<Map<string, TmuxSession>> {
    if (!hostId) return this.local.states();
    const states = await this.stateCache.get(hostId, () => this.remote(hostId).states(), bounded);
    if (!states) throw new ApiError(502, 'SSH_UNREACHABLE');
    return states;
  }
  private async collect(sessions: Session[], extraHosts: (string | null)[], bounded: boolean) {
    const groups = new Map<string | null, Session[]>(extraHosts.map(hostId => [hostId, []]));
    for (const session of sessions) {
      if (session.stoppedAt) continue;
      const hostId = this.hostId(session.id);
      groups.set(hostId, [...(groups.get(hostId) ?? []), session]);
    }
    const states = new Map<string, TerminalState>();
    const found = new Map<string | null, Map<string, TmuxSession>>();
    await Promise.all([...groups].map(async ([hostId, rows]) => {
      try {
        const current = await this.hostStates(hostId, bounded);
        found.set(hostId, current);
        for (const row of rows) {
          const { createdAt: _created, path: _path, ...state } = current.get(row.id) ?? { status: 'lost' as const };
          states.set(row.id, state);
        }
      } catch (error) {
        if (!hostId) throw error;
        for (const row of rows) states.set(row.id, { status: 'unreachable' });
      }
    }));
    return { states, found };
  }
  async states(sessions = this.store.sessions(), bounded = false): Promise<Map<string, TerminalState>> {
    return (await this.collect(sessions, [], bounded)).states;
  }
  // Lists records with their states, and tmux sessions on Jelly's sockets that
  // have no record (for example after the database was replaced). Remote hosts
  // are checked only while they have projects to adopt into.
  async overview(bounded = false) {
    const sessions = this.store.sessions();
    const known = new Set(sessions.map(session => session.id));
    const { states, found } = await this.collect(sessions, [null, ...this.store.projects().map(project => project.hostId)], bounded);
    const unregistered: Unregistered[] = [];
    for (const [hostId, current] of found) for (const [id, state] of current) {
      if (known.has(id)) continue;
      unregistered.push({ id, hostId, status: state.status === 'exited' ? 'exited' : 'running', path: state.path ?? null, createdAt: state.createdAt ?? null });
    }
    unregistered.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id));
    return { sessions, states, unregistered };
  }
  async unregistered(hostId: string | null, id: string): Promise<TmuxSession | undefined> {
    if (this.store.session(id)) return undefined;
    return (await this.hostStates(hostId, false)).get(id);
  }
  private async change<T>(hostId: string | null, action: (backend: Tmux) => Promise<T>): Promise<T> {
    if (hostId) this.stateCache.invalidate(hostId);
    try { return await action(this.backend(hostId)); }
    finally { if (hostId) this.stateCache.invalidate(hostId); }
  }
  create(id: string, cwd: string, cols: number, rows: number) { return this.change(this.hostId(id), backend => backend.create(id, cwd, cols, rows)); }
  stop(id: string) { return this.change(this.hostId(id), backend => backend.stop(id)); }
  stopUnregistered(hostId: string | null, id: string) { return this.change(hostId, backend => backend.stop(id)); }
  attach(id: string, cols: number, rows: number) { return this.backend(this.hostId(id)).attach(id, cols, rows); }
  history(id: string, lines: number) { return this.backend(this.hostId(id)).history(id, lines); }
}
