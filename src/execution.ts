import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { Config } from './config.js';
import { ApiError } from './http.js';
import { listDirectories } from './directories.js';
import { RemoteTmux } from './remote.js';
import { Store, type Session } from './store.js';
import { Tmux, type TerminalState } from './tmux.js';

export class Execution {
  readonly local: Tmux;
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
  private backend(id: string): Tmux { const hostId = this.hostId(id); return hostId ? this.remote(hostId) : this.local; }
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
  async states(sessions = this.store.sessions()): Promise<Map<string, TerminalState>> {
    const groups = new Map<string | null, Session[]>();
    for (const session of sessions) {
      if (session.stoppedAt) continue;
      const hostId = this.hostId(session.id);
      groups.set(hostId, [...(groups.get(hostId) ?? []), session]);
    }
    const result = new Map<string, TerminalState>();
    await Promise.all([...groups].map(async ([hostId, rows]) => {
      try {
        const states = await (hostId ? this.remote(hostId) : this.local).states();
        for (const row of rows) result.set(row.id, states.get(row.id) ?? { status: 'lost' });
      } catch (error) {
        if (!hostId) throw error;
        for (const row of rows) result.set(row.id, { status: 'unreachable' });
      }
    }));
    return result;
  }
  create(id: string, cwd: string, cols: number, rows: number) { return this.backend(id).create(id, cwd, cols, rows); }
  stop(id: string) { return this.backend(id).stop(id); }
  attach(id: string, cols: number, rows: number) { return this.backend(id).attach(id, cols, rows); }
  history(id: string, lines: number) { return this.backend(id).history(id, lines); }
}
