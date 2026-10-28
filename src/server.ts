import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import type { Config } from './config.js';
import { Store, type Session } from './store.js';
import type { TerminalState } from './tmux.js';
import { MutationQueue } from './mutation-queue.js';
import { Execution } from './execution.js';
import { FileTransfers } from './file-transfers.js';
import { RemoteTmux } from './remote.js';
import { sshAliases, sshTargetPattern } from './ssh-config.js';
import { Terminals } from './terminals.js';
import { ApiError, authorized, body, checkOrigin, failure, Id, json, Name, Size } from './http.js';
import { serveWeb } from './web-static.js';

const NewProject = z.object({ name: Name, path: z.string().min(1).max(4096), hostId: Id.nullable().default(null) }).strict();
const NewSession = Size.extend({ name: Name.default('Terminal') }).strict();
const Move = z.object({ beforeId: Id.nullable() }).strict();
const Rename = z.object({ name: Name }).strict();
const Adopt = z.object({ projectId: Id, name: Name }).strict();
const StopUnregistered = z.object({ hostId: Id.nullable() }).strict();
const NewHost = z.object({
  name: Name,
  target: z.string().trim().regex(sshTargetPattern),
  port: z.number().int().min(1).max(65535).nullable().default(null),
  identityFile: z.string().min(1).max(4096).refine(path => (isAbsolute(path) || path.startsWith('~/')) && !/[\0\r\n]/.test(path)).nullable().default(null),
}).strict();
const BrowseDirectory = z.object({
  path: z.string().min(1).max(4096).refine(path => isAbsolute(path) && !path.includes('\0'), 'Expected an absolute directory path').optional(),
  hidden: z.enum(['true', 'false']).default('false'),
  hostId: Id.optional(),
}).strict();

export async function startServer(config: Config) {
  const store = new Store(config.dataDir);
  const tmux = new Execution(config, store);
  try { await tmux.check(); } catch (error) { store.close(); throw error; }
  const terminals = new Terminals(config, store, tmux);
  const files = new FileTransfers(config, store);
  let stopping = false;
  const mutations = new MutationQueue();
  const hostKey = (id: string | null) => id ?? 'local';
  function mutate<T>(key: string, action: () => Promise<T>): Promise<T> {
    // A request may finish reading its body after shutdown has begun.
    if (stopping) throw new ApiError(503, 'Server stopping');
    return mutations.run(key, action);
  }
  function project(id: string) {
    const found = store.project(Id.parse(id));
    if (!found) throw new ApiError(404, 'Project not found');
    return found;
  }
  function session(id: string) {
    const found = store.session(Id.parse(id));
    if (!found) throw new ApiError(404, 'Session not found');
    return found;
  }
  function view(value: Session, states: Map<string, TerminalState>) {
    return {
      ...value,
      ...(value.stoppedAt ? { status: 'stopped' } : states.get(value.id) ?? { status: 'lost' }),
      connected: terminals.connections.has(value.id),
    };
  }
  async function route(req: IncomingMessage, res: ServerResponse) {
    if (stopping) throw new ApiError(503, 'Server stopping');
    checkOrigin(req, config);
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method;
    if (method === 'GET' && url.pathname === '/healthz') return json(res, 200, { status: 'ok', service: 'jelly' });
    if (await serveWeb(url.pathname, method, res)) return;
    const download = /^\/api\/downloads\/([a-zA-Z0-9_-]{43})$/.exec(url.pathname);
    if (method === 'GET' && download) return files.download(download[1]!, req, res);
    if (!authorized(req, config.token)) throw new ApiError(401, 'Unauthorized');
    if (method === 'GET' && url.pathname === '/api/ssh/aliases') return json(res, 200, await sshAliases(config.sshConfig));
    if (method === 'POST' && url.pathname === '/api/hosts/check') {
      const input = NewHost.parse(await body(req));
      return json(res, 200, await new RemoteTmux(config, { ...input, id: '', createdAt: '' }).probe());
    }
    if (url.pathname === '/api/hosts') {
      if (method === 'GET') return json(res, 200, { hosts: store.hosts() });
      if (method === 'POST') {
        const input = NewHost.parse(await body(req));
        return mutate('hosts', async () => {
          const existing = store.hosts().find(host => host.target === input.target && host.port === input.port && host.identityFile === input.identityFile);
          if (existing) return json(res, 200, existing);
          if (store.hosts().length >= 20) throw new ApiError(409, 'SSH server limit (20) reached');
          json(res, 201, store.addHost(input));
        });
      }
    }
    const hostMatch = /^\/api\/hosts\/([^/]+)(\/check)?$/.exec(url.pathname);
    if (hostMatch) {
      const host = store.host(Id.parse(hostMatch[1]));
      if (!host) throw new ApiError(404, 'SSH server not found');
      if (method === 'POST' && hostMatch[2]) return json(res, 200, await tmux.remote(host.id).probe());
      if (method === 'DELETE' && !hostMatch[2]) return mutate(hostKey(host.id), async () => {
        if (store.projects().some(project => project.hostId === host.id)) throw new ApiError(409, 'Remove this server\'s projects first');
        store.deleteHost(host.id);
        json(res, 200, { deleted: true });
      });
    }
    const moveMatch = /^\/api\/(projects|sessions)\/([^/]+)\/move$/.exec(url.pathname);
    if (method === 'POST' && moveMatch) {
      const kind = moveMatch[1] === 'projects' ? 'project' : 'session';
      const id = Id.parse(moveMatch[2]);
      const input = Move.parse(await body(req));
      return mutate('order', async () => {
        if (kind === 'project') {
          project(id);
          if (input.beforeId !== null) project(input.beforeId);
        } else {
          const source = session(id);
          if (input.beforeId !== null && session(input.beforeId).projectId !== source.projectId) throw new ApiError(400, 'Sessions must stay in their project');
        }
        json(res, 200, { ids: store.move(kind, id, input.beforeId) });
      });
    }
    if (method === 'GET' && url.pathname === '/api/directories') {
      const input = BrowseDirectory.parse(Object.fromEntries(url.searchParams));
      return json(res, 200, await tmux.directories(input.hostId ?? null, input.path, input.hidden === 'true'));
    }
    if (url.pathname === '/api/projects') {
      if (method === 'GET') return json(res, 200, { projects: store.projects() });
      if (method === 'POST') {
        const input = NewProject.parse(await body(req));
        return mutate(hostKey(input.hostId), async () => {
          const path = await tmux.directory(input.path, input.hostId);
          if (store.projectByPath(path, input.hostId)) throw new ApiError(409, 'Project path already registered');
          json(res, 201, store.addProject(input.name, path, input.hostId));
        });
      }
    }
    const fileMatch = /^\/api\/projects\/([^/]+)\/(files|preview|downloads)$/.exec(url.pathname);
    if (fileMatch) {
      const p = project(fileMatch[1]!);
      const action = fileMatch[2];
      const Path = z.string().max(4096);
      if (method === 'GET' && action === 'files') {
        const input = z.object({ path: Path.default(''), hidden: z.enum(['true', 'false']).default('false') }).strict().parse(Object.fromEntries(url.searchParams));
        return files.operation(req, res, async signal => json(res, 200, await files.list(p, input.path, input.hidden === 'true', signal)));
      }
      if (method === 'GET' && action === 'preview') {
        const input = z.object({ path: Path.min(1) }).strict().parse(Object.fromEntries(url.searchParams));
        return files.operation(req, res, signal => files.preview(p, input.path, res, signal));
      }
      if (method === 'POST' && action === 'downloads') {
        const input = z.object({ path: Path.min(1) }).strict().parse(await body(req));
        return files.operation(req, res, async signal => json(res, 201, await files.ticket(p, input.path, signal)));
      }
    }
    const projectMatch = /^\/api\/projects\/([^/]+)(\/sessions)?$/.exec(url.pathname);
    if (projectMatch) {
      const id = projectMatch[1]!;
      if (!projectMatch[2]) {
        if (method === 'GET') return json(res, 200, project(id));
        if (method === 'PATCH') {
          const input = Rename.parse(await body(req));
          return mutate(hostKey(project(id).hostId), async () => {
            project(id);
            store.renameProject(id, input.name);
            json(res, 200, project(id));
          });
        }
        if (method === 'DELETE') return mutate(hostKey(project(id).hostId), async () => {
          project(id);
          const input = z.object({ deleteSessions: z.enum(['true', 'false']).default('false') }).strict().parse(Object.fromEntries(url.searchParams));
          const children = store.sessions(id);
          if (children.length && input.deleteSessions !== 'true') throw new ApiError(409, 'Delete project sessions first');
          // Keep every record until all shells have been stopped. If SSH fails,
          // the project and remaining sessions stay available for retry.
          for (const child of children) {
            if (!child.stoppedAt) await tmux.stop(child.id);
            terminals.disconnect(child.id);
            store.stopSession(child.id);
          }
          store.deleteProjectWithSessions(id);
          json(res, 200, { deleted: true });
        });
      } else {
        if (method === 'GET') {
          project(id);
          const sessions = store.sessions(id);
          const states = await tmux.states(sessions);
          return json(res, 200, { sessions: sessions.map(s => view(s, states)) });
        }
        if (method === 'POST') {
          const input = NewSession.parse(await body(req));
          return mutate(hostKey(project(id).hostId), async () => {
            const p = project(id);
            await tmux.directory(p.path, p.hostId);
            if (store.sessions().length >= 100) throw new ApiError(409, 'Session limit (100) reached; remove old sessions');
            const created = store.addSession(id, input.name);
            try { await tmux.create(created.id, p.path, input.cols, input.rows); }
            catch (error) {
              await tmux.stop(created.id);
              store.deleteSession(created.id);
              throw error;
            }
            json(res, 201, view(created, await tmux.states([created])));
          });
        }
      }
    }
    if (method === 'GET' && url.pathname === '/api/sessions') {
      const { sessions, states, unregistered } = await tmux.overview(true);
      return json(res, 200, { sessions: sessions.map(s => view(s, states)), unregistered });
    }
    const unregisteredMatch = /^\/api\/unregistered-sessions\/([^/]+)\/(adopt|stop)$/.exec(url.pathname);
    if (method === 'POST' && unregisteredMatch) {
      const id = Id.parse(unregisteredMatch[1]);
      if (unregisteredMatch[2] === 'adopt') {
        const input = Adopt.parse(await body(req));
        return mutate(hostKey(project(input.projectId).hostId), async () => {
          const p = project(input.projectId);
          if (store.session(id)) throw new ApiError(409, 'Session already registered');
          // The shell must be on the project's server; its directory may differ.
          if (!await tmux.unregistered(p.hostId, id)) throw new ApiError(404, 'Unregistered session not found on this project\'s server');
          if (store.sessions().length >= 100) throw new ApiError(409, 'Session limit (100) reached; remove old sessions');
          // Keep the tmux ID so the record controls the existing shell. Like a
          // new session, it appends to the project's order.
          const created = store.addSession(p.id, input.name, id);
          json(res, 201, view(created, await tmux.states([created])));
        });
      }
      const input = StopUnregistered.parse(await body(req));
      if (input.hostId && !store.host(input.hostId)) throw new ApiError(404, 'SSH server not found');
      return mutate(hostKey(input.hostId), async () => {
        if (store.session(id)) throw new ApiError(409, 'Session is registered');
        if (!await tmux.unregistered(input.hostId, id)) throw new ApiError(404, 'Unregistered session not found');
        await tmux.stopUnregistered(input.hostId, id);
        json(res, 200, { stopped: true });
      });
    }
    const sessionMatch = /^\/api\/sessions\/([^/]+)(?:\/(stop|tickets|history))?$/.exec(url.pathname);
    if (sessionMatch) {
      const id = sessionMatch[1]!;
      const action = sessionMatch[2];
      if (method === 'PATCH' && !action) {
        const input = Rename.parse(await body(req));
        return mutate(hostKey(project(session(id).projectId).hostId), async () => {
          session(id);
          store.renameSession(id, input.name);
          // Renaming metadata does not query or reconnect the shell, including
          // when its SSH host is currently unreachable.
          json(res, 200, session(id));
        });
      }
      if (method === 'GET' && !action) return json(res, 200, view(session(id), await tmux.states([session(id)])));
      if ((method === 'DELETE' && !action) || (method === 'POST' && action === 'stop')) {
        return mutate(hostKey(project(session(id).projectId).hostId), async () => {
          const target = session(id);
          if (!target.stoppedAt) await tmux.stop(id);
          terminals.disconnect(id);
          store.stopSession(id);
          if (method === 'DELETE') { store.deleteSession(id); return json(res, 200, { deleted: true }); }
          json(res, 200, view(session(id), new Map()));
        });
      }
      if (method === 'POST' && action === 'tickets') {
        const s = session(id);
        const state = (await tmux.states([s])).get(id);
        if (state?.status === 'unreachable') throw new ApiError(502, 'SSH_UNREACHABLE');
        if (s.stoppedAt || state?.status !== 'running') throw new ApiError(409, 'Session is not running');
        return json(res, 201, terminals.ticket(id));
      }
      if (method === 'GET' && action === 'history') {
        const s = session(id);
        const lines = z.coerce.number().int().min(1).max(10000).parse(url.searchParams.get('lines') ?? 1000);
        if (s.stoppedAt || !['running', 'exited', 'unreachable'].includes((await tmux.states([s])).get(id)?.status ?? '')) throw new ApiError(409, 'Session history no longer available');
        return json(res, 200, { text: await tmux.history(id, lines), format: 'plain', lines });
      }
    }
    throw new ApiError(404, 'Not found');
  }
  const server = createServer((req, res) => {
    void route(req, res).catch(error => {
      if (res.destroyed) return;
      const { status, message } = failure(error);
      if (!res.headersSent) json(res, status, { error: message });
      else res.end();
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 128;
  server.on('upgrade', (req, socket, head) => { void terminals.upgrade(req, socket, head); });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  }).catch(error => { terminals.close(); store.close(); throw error; });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  return {
    port: address.port, store, tmux, terminals,
    async close() {
      if (stopping) return;
      stopping = true;
      terminals.close();
      files.close();
      const stopped = new Promise<void>(resolve => server.close(() => resolve()));
      await mutations.idle();
      server.closeIdleConnections();
      const deadline = setTimeout(() => server.closeAllConnections(), 1500);
      deadline.unref();
      await stopped;
      clearTimeout(deadline);
      store.close();
    },
  };
}
