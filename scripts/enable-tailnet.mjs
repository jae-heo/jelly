#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { resolveBinding } from '../dist/src/network.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, '.data');
const unit = join(homedir(), '.config/systemd/user/jelly.service');
const runtime = `/run/user/${process.getuid()}`;
const serviceEnv = { ...process.env, XDG_RUNTIME_DIR: runtime, DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtime}/bus` };
const restart = () => execFileSync('systemctl', ['--user', 'restart', 'jelly.service'], { env: serviceEnv, timeout: 15_000 });

async function main() {
  if (!existsSync(unit) || !readFileSync(unit, 'utf8').startsWith('# Managed by Jelly scripts/install-service.mjs')) {
    throw new Error('Install the Jelly user service first: node scripts/install-service.mjs');
  }
  const { host } = resolveBinding('tailscale');
  const envPath = join(dataDir, 'service.env');
  const hadEnv = existsSync(envPath);
  const oldEnv = hadEnv ? readFileSync(envPath, 'utf8') : '';
  const configuredPort = /^JELLY_PORT=(.*)$/m.exec(oldEnv)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  const port = Number(configuredPort ?? 47821);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid configured port');
  const origin = `http://${host}:${port}`;
  const lines = oldEnv.split('\n').filter(line => !line.startsWith('JELLY_HOST=')).filter(Boolean);
  lines.push('JELLY_HOST=tailscale');
  writeFileSync(envPath, lines.join('\n') + '\n', { mode: 0o600 });
  try {
    restart();
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(origin + '/healthz', { signal: AbortSignal.timeout(2000) });
        if (response.ok && (await response.json()).service === 'jelly') break;
        throw new Error('Tailnet IP health check failed');
      } catch (error) {
        if (attempt >= 9) throw error;
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
  } catch (error) {
    if (hadEnv) writeFileSync(envPath, oldEnv, { mode: 0o600 });
    else unlinkSync(envPath);
    restart();
    throw error;
  }
  const token = readFileSync(join(dataDir, 'token'), 'utf8').trim();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: origin };
  async function api(path, method = 'GET', body) {
    const response = await fetch(origin + path, {
      method, headers, redirect: 'error', signal: AbortSignal.timeout(10_000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Tailnet API failed: HTTP ${response.status}`);
    return response.json();
  }
  const unauthenticated = await fetch(origin + '/api/projects', { signal: AbortSignal.timeout(5000) });
  if (unauthenticated.status !== 401) throw new Error('Unauthenticated API was not rejected');
  const projects = (await api('/api/projects')).projects;
  const project = projects.find(p => p.path === root) ?? await api('/api/projects', 'POST', { name: '줼리', path: root });
  const session = await api(`/api/projects/${project.id}/sessions`, 'POST', { name: 'tailnet-verification' });
  try {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(origin.replace('http:', 'ws:') + `/api/sessions/${session.id}/terminal`, {
        headers, handshakeTimeout: 10_000,
      });
      const timeout = setTimeout(() => { ws.terminate(); reject(new Error('Tailnet terminal output timed out')); }, 10_000);
      let output = '';
      let verified = false;
      ws.on('open', () => ws.send(JSON.stringify({ type: 'input', data: "printf '\\nTAILNET_%s\\n' VERIFIED\r" })));
      ws.on('message', raw => {
        const message = JSON.parse(raw.toString());
        if (message.type === 'output') output = (output + message.data).slice(-65536);
        if (!verified && output.includes('TAILNET_VERIFIED')) { verified = true; ws.close(); }
      });
      ws.on('close', () => { clearTimeout(timeout); verified ? resolve() : reject(new Error('Terminal closed before verification')); });
      ws.on('error', error => { clearTimeout(timeout); reject(error); });
    });
  } finally { await api(`/api/sessions/${session.id}`, 'DELETE'); }
  writeFileSync(join(dataDir, 'tailnet-check.json'), JSON.stringify({
    checkedAt: new Date().toISOString(), origin, health: true, authentication: true, websocket: true,
    scope: 'HTTP/WS directly to this host Tailscale IP from the server itself; separate mobile device not tested',
  }, null, 2) + '\n', { mode: 0o600 });
  console.log(`Jelly direct Tailscale endpoint verified: ${origin}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
