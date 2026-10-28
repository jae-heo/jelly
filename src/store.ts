import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface Host { id: string; name: string; target: string; port: number | null; identityFile: string | null; createdAt: string }
export interface Project { id: string; name: string; path: string; hostId: string | null; createdAt: string }
export interface Session {
  id: string; projectId: string; name: string; createdAt: string; stoppedAt: string | null;
}

export class Store {
  readonly db: DatabaseSync;
  constructor(dataDir: string) {
    this.db = new DatabaseSync(join(dataDir, 'jelly.sqlite'), { timeout: 5000 });
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS hosts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, target TEXT NOT NULL, port INTEGER, identityFile TEXT, createdAt TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, createdAt TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL, createdAt TEXT NOT NULL, stoppedAt TEXT
      ) STRICT;
    `);
    const columns = this.db.prepare('PRAGMA table_info(projects)').all();
    if (!columns.some(column => column.name === 'hostId')) {
      if ((this.db.prepare('SELECT COUNT(*) AS n FROM projects').get()!.n as number) > 0) {
        this.db.prepare('VACUUM INTO ?').run(join(dataDir, `before-ssh-${Date.now()}.sqlite`));
      }
      this.db.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE');
      try {
        this.db.exec(`
          CREATE TABLE projects_next (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, createdAt TEXT NOT NULL,
            hostId TEXT REFERENCES hosts(id)
          ) STRICT;
          INSERT INTO projects_next (id,name,path,createdAt) SELECT id,name,path,createdAt FROM projects;
          DROP TABLE projects;
          ALTER TABLE projects_next RENAME TO projects;
          CREATE UNIQUE INDEX project_location ON projects(COALESCE(hostId, ''), path);
        `);
        if (this.db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Project migration integrity check failed');
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      finally { this.db.exec('PRAGMA foreign_keys = ON'); }
    }
    // Separate order tables preserve the original metadata schema and allow
    // older releases to keep reading and creating projects/sessions safely.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_order (
        id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, position INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS session_order (
        id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE, position INTEGER NOT NULL
      ) STRICT;
    `);
  }
  hosts(): Host[] { return this.db.prepare('SELECT * FROM hosts ORDER BY createdAt, id').all() as unknown as Host[]; }
  host(id: string): Host | undefined { return this.db.prepare('SELECT * FROM hosts WHERE id = ?').get(id) as unknown as Host | undefined; }
  addHost(input: Omit<Host, 'id' | 'createdAt'>): Host {
    const host = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.db.prepare('INSERT INTO hosts VALUES (?, ?, ?, ?, ?, ?)').run(host.id, host.name, host.target, host.port, host.identityFile, host.createdAt);
    return host;
  }
  deleteHost(id: string): void { this.db.prepare('DELETE FROM hosts WHERE id = ?').run(id); }
  projects(): Project[] { return this.db.prepare('SELECT p.* FROM projects p LEFT JOIN project_order o ON o.id = p.id ORDER BY o.position IS NULL, o.position, p.createdAt, p.id').all() as unknown as Project[]; }
  project(id: string): Project | undefined { return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as unknown as Project | undefined; }
  projectByPath(path: string, hostId: string | null = null): Project | undefined { return this.db.prepare('SELECT * FROM projects WHERE path = ? AND hostId IS ?').get(path, hostId) as unknown as Project | undefined; }
  addProject(name: string, path: string, hostId: string | null = null): Project {
    const project = { id: randomUUID(), name, path, hostId, createdAt: new Date().toISOString() };
    this.db.prepare('INSERT INTO projects (id,name,path,createdAt,hostId) VALUES (?, ?, ?, ?, ?)').run(project.id, name, path, project.createdAt, hostId);
    return project;
  }
  deleteProject(id: string): void { this.db.prepare('DELETE FROM projects WHERE id = ?').run(id); }
  deleteProjectWithSessions(id: string): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM sessions WHERE projectId = ?').run(id);
      this.deleteProject(id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  renameProject(id: string, name: string): void { this.db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, id); }
  sessions(projectId?: string): Session[] {
    return (projectId
      ? this.db.prepare('SELECT s.* FROM sessions s LEFT JOIN session_order o ON o.id = s.id WHERE s.projectId = ? ORDER BY o.position IS NULL, o.position, s.createdAt, s.id').all(projectId)
      : this.db.prepare('SELECT s.* FROM sessions s LEFT JOIN session_order o ON o.id = s.id ORDER BY o.position IS NULL, o.position, s.createdAt, s.id').all()) as unknown as Session[];
  }
  session(id: string): Session | undefined { return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as unknown as Session | undefined; }
  addSession(projectId: string, name: string): Session {
    const session = { id: randomUUID(), projectId, name, createdAt: new Date().toISOString(), stoppedAt: null };
    this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, NULL)').run(session.id, projectId, name, session.createdAt);
    return session;
  }
  stopSession(id: string): void {
    this.db.prepare('UPDATE sessions SET stoppedAt = COALESCE(stoppedAt, ?) WHERE id = ?').run(new Date().toISOString(), id);
  }
  deleteSession(id: string): void { this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id); }
  renameSession(id: string, name: string): void { this.db.prepare('UPDATE sessions SET name = ? WHERE id = ?').run(name, id); }
  move(kind: 'project' | 'session', id: string, beforeId: string | null): string[] {
    const source = kind === 'project' ? this.project(id) : this.session(id);
    if (!source) throw new Error('Order item not found');
    const items = kind === 'project' ? this.projects() : this.sessions((source as Session).projectId);
    const ids = items.map(item => item.id);
    if (beforeId !== null && !ids.includes(beforeId)) throw new Error('Order target not in the same list');
    if (beforeId === id) return ids;
    ids.splice(ids.indexOf(id), 1);
    ids.splice(beforeId === null ? ids.length : ids.indexOf(beforeId), 0, id);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const update = this.db.prepare(`INSERT INTO ${kind}_order (id, position) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET position = excluded.position`);
      ids.forEach((value, index) => update.run(value, index));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return ids;
  }
  close(): void { this.db.close(); }
}
