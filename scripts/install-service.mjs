#!/usr/bin/env node
import { accessSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
accessSync(join(root, 'dist/src/main.js'));
const directory = join(homedir(), '.config/systemd/user');
const unit = join(directory, 'jelly.service');
const marker = '# Managed by Jelly scripts/install-service.mjs';
if (existsSync(unit) && !readFileSync(unit, 'utf8').startsWith(marker)) {
  throw new Error('Refusing to replace an existing unmanaged jelly.service');
}
function quote(value) {
  if (/[\r\n\0]/.test(value)) throw new Error('Invalid path');
  return '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%') + '"';
}
mkdirSync(directory, { recursive: true });
mkdirSync(join(root, '.data'), { recursive: true, mode: 0o700 });
writeFileSync(unit, `${marker}
[Unit]
Description=Jelly persistent terminal API
After=network.target

[Service]
Type=simple
WorkingDirectory=${root.replaceAll('%', '%%')}
ExecStart=${quote(process.execPath)} ${quote(join(root, 'dist/src/main.js'))}
Environment=${quote('JELLY_DATA_DIR=' + join(root, '.data'))}
Environment=${quote('PATH=' + process.env.PATH)}
EnvironmentFile=-${join(root, '.data/service.env').replaceAll('%', '%%')}
Restart=on-failure
RestartSec=2
# The independently running tmux server must survive API stop/restart.
KillMode=process
TimeoutStopSec=10
UMask=0077

[Install]
WantedBy=default.target
`, { mode: 0o600 });
// Remote agent hosts may override XDG_RUNTIME_DIR with their own temporary directory.
const userRuntime = `/run/user/${process.getuid()}`;
const runtime = existsSync(join(userRuntime, 'bus')) ? userRuntime : process.env.XDG_RUNTIME_DIR;
if (!runtime) throw new Error('No user systemd runtime directory found');
const env = { ...process.env, XDG_RUNTIME_DIR: runtime, DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtime}/bus` };
execFileSync('systemd-analyze', ['--user', 'verify', unit], { env, stdio: 'inherit' });
execFileSync('systemctl', ['--user', 'daemon-reload'], { env, stdio: 'inherit' });
execFileSync('systemctl', ['--user', 'enable', '--now', 'jelly.service'], { env, stdio: 'inherit' });
console.log('Installed Jelly user service. Existing services and tmux sessions were not modified.');
