import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';
import { allowClientUrl } from './network.js';

const [command, ...args] = process.argv.slice(2);
if (!command || command === 'help') {
  console.log(`Jelly API client (Node 24)
  npm run cli -- projects
  npm run cli -- project-add NAME /absolute/path
  npm run cli -- project-delete PROJECT_ID
  npm run cli -- sessions [PROJECT_ID]
  npm run cli -- session-new PROJECT_ID [NAME]
  npm run cli -- session-stop SESSION_ID
  npm run cli -- session-delete SESSION_ID
  npm run cli -- history SESSION_ID [LINES]
  npm run cli -- attach SESSION_ID

JELLY_URL defaults to the running server's .data/endpoint.json, then http://127.0.0.1:47821.
JELLY_TOKEN_FILE defaults to .data/token (or JELLY_DATA_DIR/token).
During attach, Ctrl+] disconnects without stopping the session.`);
  process.exit(0);
}
const endpointPath = resolve(process.env.JELLY_DATA_DIR ?? '.data', 'endpoint.json');
const defaultUrl = existsSync(endpointPath) ? JSON.parse(readFileSync(endpointPath, 'utf8')).url : 'http://127.0.0.1:47821';
const base = new URL(process.env.JELLY_URL ?? defaultUrl);
if (!allowClientUrl(base)) throw new Error('Use a loopback/Tailscale IP for HTTP, or HTTPS for other hosts');
const token = readFileSync(process.env.JELLY_TOKEN_FILE ?? resolve(process.env.JELLY_DATA_DIR ?? '.data', 'token'), 'utf8').trim();
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
function arg(index: number) {
  const value = args[index];
  if (!value) throw new Error('Missing argument; run npm run cli -- help');
  return value;
}
async function request(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(new URL(path, base), {
    method, headers, redirect: 'error', signal: AbortSignal.timeout(10_000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
  return data;
}
async function attach(id: string) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('attach requires an interactive terminal');
  const url = new URL(`/api/sessions/${encodeURIComponent(id)}/terminal`, base);
  url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('cols', String(Math.min(500, Math.max(2, process.stdout.columns || 80))));
  url.searchParams.set('rows', String(Math.min(200, Math.max(2, process.stdout.rows || 24))));
  const ws = new WebSocket(url, { headers, handshakeTimeout: 10_000, maxPayload: 2 * 1024 * 1024 });
  const rawBefore = process.stdin.isRaw;
  let active = false;
  const send = (value: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); };
  const input = (data: string) => {
    const end = data.indexOf('\x1d');
    if (end >= 0) {
      if (end > 0) send({ type: 'input', data: data.slice(0, end) });
      ws.close(); return;
    }
    // Keep paste chunks below the server limit, without splitting UTF-8 sequences.
    const points = Array.from(data);
    for (let i = 0; i < points.length; i += 2048) send({ type: 'input', data: points.slice(i, i + 2048).join('') });
  };
  const resize = () => send({ type: 'resize', cols: Math.min(500, Math.max(2, process.stdout.columns || 80)), rows: Math.min(200, Math.max(2, process.stdout.rows || 24)) });
  function restore() {
    if (!active) return;
    active = false;
    process.stdin.setRawMode(rawBefore);
    process.stdin.off('data', input);
    process.stdin.pause();
    process.stdout.off('resize', resize);
    process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[?1049l\x1b[?25h\x1b[0m\r\nDisconnected. Session stays on the server.\r\n');
  }
  ws.on('open', () => {
    active = true;
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.on('data', input);
    process.stdout.on('resize', resize);
  });
  ws.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'output') {
      if (!process.stdout.write(message.data)) { ws.pause(); process.stdout.once('drain', () => ws.resume()); }
    }
  });
  ws.on('close', (code, reason) => { restore(); if (code !== 1000) console.error(`Connection closed: ${code} ${reason}`); });
  ws.on('error', error => { restore(); console.error(error.message); process.exitCode = 1; });
  process.on('exit', restore);
  process.on('SIGTERM', () => { restore(); ws.terminate(); });
}

try {
  let result: unknown;
  switch (command) {
    case 'projects': result = await request('/api/projects'); break;
    case 'project-add': result = await request('/api/projects', 'POST', { name: arg(0), path: resolve(arg(1)) }); break;
    case 'project-delete': result = await request(`/api/projects/${encodeURIComponent(arg(0))}`, 'DELETE'); break;
    case 'sessions': result = await request(args[0] ? `/api/projects/${encodeURIComponent(args[0])}/sessions` : '/api/sessions'); break;
    case 'session-new': result = await request(`/api/projects/${encodeURIComponent(arg(0))}/sessions`, 'POST', { name: args[1] ?? 'Terminal' }); break;
    case 'session-stop': result = await request(`/api/sessions/${encodeURIComponent(arg(0))}/stop`, 'POST'); break;
    case 'session-delete': result = await request(`/api/sessions/${encodeURIComponent(arg(0))}`, 'DELETE'); break;
    case 'history': result = await request(`/api/sessions/${encodeURIComponent(arg(0))}/history?lines=${encodeURIComponent(args[1] ?? '1000')}`); break;
    case 'attach': await attach(arg(0)); break;
    default: throw new Error('Unknown command; run npm run cli -- help');
  }
  if (result !== undefined) console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error((error as Error).message); process.exitCode = 1; }
