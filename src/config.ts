import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, join } from 'node:path';
import { resolveBinding } from './network.js';

export interface Config {
  dataDir: string;
  port: number;
  host: string;
  token: string;
  socket: string;
  tmuxConfig: string;
  origins: Set<string>;
  shell: string;
  instanceId: string;
  sshConfig?: string;
}

export function loadConfig(): Config {
  process.umask(0o077);
  // Fail closed if Tailscale is unavailable; never fall back to a wildcard or LAN listener.
  const { host, dnsName } = resolveBinding(process.env.JELLY_HOST ?? '127.0.0.1');
  const dataDir = resolve(process.env.JELLY_DATA_DIR ?? '.data');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  const tokenPath = join(dataDir, 'token');
  try {
    writeFileSync(tokenPath, randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  chmodSync(tokenPath, 0o600);
  const token = readFileSync(tokenPath, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid token file');
  const instancePath = join(dataDir, 'instance-id');
  try { writeFileSync(instancePath, randomBytes(16).toString('hex'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const instanceId = readFileSync(instancePath, 'utf8').trim();
  if (!/^[a-f0-9]{32}$/.test(instanceId)) throw new Error('Invalid instance ID');
  const port = Number(process.env.JELLY_PORT ?? 47821);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid JELLY_PORT');
  const origins = new Set([
    `http://127.0.0.1:${port}`, `http://localhost:${port}`,
    `http://${host}:${port}`, ...(dnsName ? [`http://${dnsName}:${port}`] : []),
    ...(process.env.JELLY_ORIGINS ?? '').split(',').filter(Boolean),
  ].map(value => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) {
      throw new Error('JELLY_ORIGINS must contain exact HTTP(S) origins without trailing slashes');
    }
    return url.origin;
  }));
  const socket = join(dataDir, 'tmux.sock');
  if (Buffer.byteLength(socket) > 100) throw new Error('Data directory path is too long for a Unix socket');
  const tmuxConfig = join(dataDir, 'tmux.conf');
  writeFileSync(tmuxConfig, [
    'set -g status off',
    'set -g prefix None',
    'unbind-key C-b',
    'set -g mouse on',
    'set -g default-terminal tmux-256color',
    'set -g history-limit 10000',
    'set -g exit-unattached off',
    'set -g destroy-unattached off',
    'set -g set-titles off',
    'set -s escape-time 10',
    'set -w -g remain-on-exit on',
    'set -w -g window-size latest',
    '',
  ].join('\n'), { mode: 0o600 });
  return { dataDir, port, host, token, socket, tmuxConfig, origins, shell: process.env.JELLY_SHELL ?? '/bin/bash', instanceId,
    ...(process.env.JELLY_SSH_CONFIG ? { sshConfig: resolve(process.env.JELLY_SSH_CONFIG) } : {}) };
}
