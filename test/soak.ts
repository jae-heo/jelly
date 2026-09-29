// Opt-in duration: JELLY_SOAK_SECONDS=3600 npm run test:soak
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { loadConfig } from '../src/config.js';
import { startServer } from '../src/server.js';

const exec = promisify(execFile);
const seconds = Number(process.env.JELLY_SOAK_SECONDS ?? 60);
if (!Number.isInteger(seconds) || seconds < 30 || seconds > 86400) throw new Error('JELLY_SOAK_SECONDS must be 30–86400');
async function until(check: () => boolean | Promise<boolean>, timeout = 10_000) {
  const end = Date.now() + timeout;
  while (!await check()) { if (Date.now() > end) throw new Error('Soak condition timed out'); await delay(20); }
}

test(`repeated output, session switching and abrupt disconnects (${seconds}s)`, { timeout: (seconds + 90) * 1000 }, async t => {
  const data = await mkdtemp(join(tmpdir(), 'jelly-soak-'));
  process.env.JELLY_DATA_DIR = data;
  process.env.JELLY_HOST = '127.0.0.1';
  process.env.JELLY_PORT = '0';
  const config = loadConfig();
  const app = await startServer(config);
  const sockets = new Set<WebSocket>();
  t.after(async () => {
    for (const ws of sockets) ws.terminate();
    await app.close();
    await exec('tmux', ['-S', config.socket, 'kill-server']).catch(() => {});
    await rm(data, { recursive: true, force: true });
  });
  const api = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${app.port}/api${path}`, {
      method, headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.ok, true);
    return await response.json() as any;
  };
  const project = await api('/projects', 'POST', { name: 'soak', path: data });
  const sessions: { id: string; pid: number }[] = [];
  for (let i = 0; i < 4; i++) sessions.push(await api(`/projects/${project.id}/sessions`, 'POST', { name: `soak-${i}` }));
  const serverPid = (await exec('tmux', ['-S', config.socket, 'list-sessions', '-F', '#{pid}'])).stdout.trim().split('\n')[0];
  const sample = async () => {
    global.gc?.();
    const memory = process.memoryUsage();
    const status = await readFile(`/proc/${serverPid}/status`, 'utf8');
    return { heap: memory.heapUsed, rss: memory.rss, fds: (await readdir('/proc/self/fd')).length,
      tmuxRss: Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0) * 1024,
      tmuxFds: (await readdir(`/proc/${serverPid}/fd`)).length };
  };
  let baseline: Awaited<ReturnType<typeof sample>> | undefined;
  let peak: Awaited<ReturnType<typeof sample>> | undefined;
  let cycles = 0;
  const started = Date.now();
  do {
    // Three concurrent attachments reproduce the browser cache; the fourth rotates in.
    const clients = await Promise.all([0, 1, 2].map(async index => {
      const session = sessions[(cycles + index) % sessions.length]!;
      const ws = new WebSocket(`ws://127.0.0.1:${app.port}/api/sessions/${session.id}/terminal?flow=ack-v1`, {
        headers: { Authorization: `Bearer ${config.token}` }, handshakeTimeout: 5000,
      });
      sockets.add(ws);
      let ready = false, output = '', received = 0, acknowledged = 0;
      const tick = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN && received > acknowledged) {
          acknowledged = received; ws.send(JSON.stringify({ type: 'ack', offset: received }));
        }
      }, 80); // Deliberately slower than delivery.
      ws.on('close', () => { clearInterval(tick); sockets.delete(ws); });
      ws.on('error', () => {});
      ws.on('message', raw => {
        const value = JSON.parse(raw.toString());
        if (value.type === 'ready') { assert.equal(value.flowControl, 'ack-v1'); ready = true; }
        if (value.type === 'output') {
          received += value.data.length;
          assert.equal(value.offset, received);
          assert.ok(received - acknowledged <= 512 * 1024);
          output = (output + value.data).slice(-4096);
        }
      });
      await until(() => ready);
      const marker = `SOAK_${cycles}_${index}_DONE`;
      ws.send(JSON.stringify({ type: 'input', data: `head -c 262144 /dev/zero | tr '\\000' x; printf '\\nSOAK_${cycles}_${index}_%s\\n' DONE\r` }));
      await until(() => output.includes(marker));
      return ws;
    }));
    assert.equal(app.terminals.connections.size, 3);
    for (const ws of clients) {
      const ended = once(ws, 'close');
      if (cycles % 3 === 0) ws.terminate(); else ws.close();
      await ended;
    }
    await until(() => app.terminals.connections.size === 0 && app.terminals.wss.clients.size === 0);
    const states = (await api('/sessions')).sessions;
    for (const session of sessions) {
      const state = states.find((row: any) => row.id === session.id);
      assert.equal(state.pid, session.pid); assert.equal(state.status, 'running');
    }
    assert.equal((await exec('tmux', ['-S', config.socket, 'list-clients'])).stdout.trim(), '');
    cycles++;
    if (cycles >= 10) {
      const current = await sample();
      baseline ??= current;
      peak ??= { ...current };
      for (const key of ['heap', 'rss', 'fds', 'tmuxRss', 'tmuxFds'] as const) peak[key] = Math.max(peak[key], current[key]);
      assert.ok(current.heap < baseline.heap + 16 * 1024 * 1024, 'retained JS heap grew by 16 MiB');
      assert.ok(current.rss < baseline.rss + 64 * 1024 * 1024, 'API/test RSS grew by 64 MiB');
      assert.ok(current.tmuxRss < baseline.tmuxRss + 32 * 1024 * 1024, 'tmux RSS grew by 32 MiB');
      assert.ok(current.fds <= baseline.fds + 4, 'API/test descriptors accumulated');
      assert.ok(current.tmuxFds <= baseline.tmuxFds + 2, 'tmux descriptors accumulated');
    }
    if (cycles % 50 === 0) t.diagnostic(JSON.stringify({ cycles, elapsedSeconds: Math.round((Date.now() - started) / 1000), baseline, peak }));
  } while (Date.now() - started < seconds * 1000 || cycles < 12);
  t.diagnostic(JSON.stringify({ cycles, elapsedSeconds: Math.round((Date.now() - started) / 1000), baseline, peak, final: await sample() }));
});
