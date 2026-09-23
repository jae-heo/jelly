import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Store } from './store.js';
import type { Execution } from './execution.js';
import { ApiError, authorized, checkOrigin, failure, Id, Size } from './http.js';

const Input = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), data: z.string().max(16384) }).strict(),
  Size.extend({ type: z.literal('resize') }).strict(),
]);

interface Connection { ws: WebSocket; cleanup: () => void }

export class Terminals {
  readonly wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  readonly connections = new Map<string, Connection>();
  private readonly tickets = new Map<string, { id: string; expires: number }>();
  private closing = false;
  constructor(private readonly config: Config, private readonly store: Store, private readonly tmux: Execution) {}

  ticket(id: string): { ticket: string; expiresIn: number } {
    for (const [key, value] of this.tickets) if (value.expires <= Date.now()) this.tickets.delete(key);
    if (this.tickets.size >= 1024) throw new ApiError(429, 'Too many pending tickets');
    const ticket = randomBytes(32).toString('hex');
    this.tickets.set(ticket, { id, expires: Date.now() + 30_000 });
    return { ticket, expiresIn: 30 };
  }

  async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    // A client can disappear while tmux is queried; absorb transport errors until ws takes over.
    const onError = () => socket.destroy();
    socket.on('error', onError);
    try {
      if (this.closing) throw new ApiError(503, 'Server stopping');
      checkOrigin(req, this.config);
      const url = new URL(req.url ?? '/', 'http://localhost');
      const match = /^\/api\/sessions\/([^/]+)\/terminal$/.exec(url.pathname);
      if (req.method !== 'GET' || !match) throw new ApiError(404, 'Not found');
      const id = Id.parse(match[1]);
      if (!authorized(req, this.config.token)) {
        const ticket = url.searchParams.get('ticket') ?? '';
        const record = this.tickets.get(ticket);
        this.tickets.delete(ticket);
        if (!record || record.id !== id || record.expires <= Date.now()) throw new ApiError(401, 'Unauthorized');
      }
      const size = Size.parse({
        cols: url.searchParams.has('cols') ? Number(url.searchParams.get('cols')) : undefined,
        rows: url.searchParams.has('rows') ? Number(url.searchParams.get('rows')) : undefined,
      });
      const session = this.store.session(id);
      if (!session) throw new ApiError(404, 'Session not found');
      const state = (await this.tmux.states([session])).get(id);
      if (state?.status === 'unreachable') throw new ApiError(502, 'SSH_UNREACHABLE');
      if (session.stoppedAt || state?.status !== 'running') throw new ApiError(409, 'Session is not running');
      if (this.closing) throw new ApiError(503, 'Server stopping');
      if (socket.destroyed) return;
      this.wss.handleUpgrade(req, socket, head, ws => {
        socket.off('error', onError);
        this.attach(id, ws, size.cols, size.rows);
      });
    } catch (error) {
      const { status, message } = failure(error);
      if (!socket.destroyed) socket.end(`HTTP/1.1 ${status} Error\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${message}`);
    }
  }

  private attach(id: string, ws: WebSocket, cols: number, rows: number): void {
    ws.on('error', () => ws.terminate());
    let terminal: ReturnType<Execution['attach']>;
    try { terminal = this.tmux.attach(id, cols, rows); }
    catch { ws.close(1011, 'Could not attach terminal'); return; }
    // Only the newest browser controls the terminal dimensions and keyboard.
    this.disconnect(id, 4001, 'Replaced by a newer connection');
    let closed = false;
    let paused = false;
    let alive = true;
    let inputBytes = 0;
    let inputWindow = Date.now();
    let ready = false;
    let pendingInput: string[] = [];
    let pendingBytes = 0;
    const remote = this.tmux.isRemote(id);
    let prelude = '';
    const send = (message: unknown) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > 1024 * 1024) { ws.close(1013, 'Output consumer too slow'); return; }
      ws.send(JSON.stringify(message));
      if (!paused && ws.bufferedAmount > 256 * 1024) { terminal.pause(); paused = true; }
    };
    const drain = setInterval(() => {
      if (paused && ws.bufferedAmount < 64 * 1024) { terminal.resume(); paused = false; }
    }, 50);
    const heartbeat = setInterval(() => {
      if (!alive) { ws.terminate(); return; }
      alive = false;
      ws.ping();
    }, 15_000);
    const startup = setTimeout(() => {
      ws.close(1011, 'Terminal attachment startup timed out');
      cleanup();
    }, remote ? 10_000 : 5000);
    const output = terminal.onData(data => {
      if (!ready) {
        if (remote) {
          prelude = (prelude + data).slice(-64 * 1024);
          // SSH banners precede tmux's terminal setup. Wait for tmux to enter the alternate screen.
          const initialized = prelude.indexOf('\x1b[?1049h');
          if (initialized < 0) return;
          data = prelude.slice(initialized); prelude = '';
        }
        // tmux switches its client TTY to raw mode during startup, flushing earlier input.
        // Its first output marks terminal initialization; hold early keystrokes until then.
        ready = true;
        clearTimeout(startup);
        send({ type: 'ready', sessionId: id, cols, rows });
      }
      send({ type: 'output', data });
      if (pendingInput.length) {
        terminal.write(pendingInput.join(''));
        pendingInput = [];
        pendingBytes = 0;
      }
    });
    const exit = terminal.onExit(({ exitCode }) => {
      send({ type: 'exit', exitCode });
      ws.close(1000, 'Terminal attachment ended');
      cleanup();
    });
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(drain);
      clearInterval(heartbeat);
      clearTimeout(startup);
      output.dispose();
      exit.dispose();
      // This is just the tmux client PTY. Never kill the server/session on disconnect.
      try { terminal.kill(); } catch { /* Already exited. */ }
      if (this.connections.get(id)?.ws === ws) this.connections.delete(id);
    };
    this.connections.set(id, { ws, cleanup });
    ws.on('close', cleanup);
    ws.on('pong', () => { alive = true; });
    ws.on('message', (raw, binary) => {
      if (closed) return;
      try {
        if (binary) throw new Error('Expected JSON text');
        const message = Input.parse(JSON.parse(raw.toString()));
        if (message.type === 'resize') terminal.resize(message.cols, message.rows);
        else {
          const bytes = Buffer.byteLength(message.data);
          if (Date.now() - inputWindow >= 1000) { inputBytes = 0; inputWindow = Date.now(); }
          inputBytes += bytes;
          if (bytes > 16 * 1024 || inputBytes > 256 * 1024) throw new Error('Input limit exceeded');
          if (ready) terminal.write(message.data);
          else {
            pendingBytes += bytes;
            if (pendingBytes > 64 * 1024) throw new Error('Startup input limit exceeded');
            pendingInput.push(message.data);
          }
        }
      } catch { ws.close(1008, 'Invalid terminal message or input limit exceeded'); cleanup(); }
    });
  }

  disconnect(id: string, code = 1000, reason = 'Session stopped'): void {
    const connection = this.connections.get(id);
    if (!connection) return;
    connection.cleanup();
    connection.ws.close(code, reason);
    // Bound close-handshake lifetime when a suspended phone never responds.
    const deadline = setTimeout(() => connection.ws.terminate(), 1000);
    deadline.unref();
  }

  close(): void {
    this.closing = true;
    for (const id of this.connections.keys()) this.disconnect(id, 1012, 'Server restarting');
    this.tickets.clear();
    this.wss.close();
  }
}
