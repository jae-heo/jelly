import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { join, posix } from 'node:path';
import * as pty from 'node-pty';
import type { Config } from './config.js';
import type { Host } from './store.js';
import { Tmux } from './tmux.js';
import { ApiError } from './http.js';

const exec = promisify(execFile);
export const shellQuote = (value: string): string => "'" + value.replaceAll("'", "'\\''") + "'";

const browseScript = String.raw`
_jelly_path=$1
_jelly_hidden=$2
_jelly_list=$3
[ -n "$_jelly_path" ] || _jelly_path=$HOME
[ -e "$_jelly_path" ] || exit 44
[ -d "$_jelly_path" ] || exit 45
[ -r "$_jelly_path" ] && [ -x "$_jelly_path" ] || exit 43
cd -P "$_jelly_path" 2>/dev/null || exit 43
printf '\000JELLY_DIR_V1\000'
printf '%s\000' "$HOME" "$PWD"
_jelly_count=0
_jelly_truncated=0
if [ "$_jelly_list" = true ]; then
  set -- ./*
  if [ "$_jelly_hidden" = true ]; then set -- "$@" ./.[!.]* ./..?*; fi
  for _jelly_entry do
    [ -d "$_jelly_entry" ] || continue
    if [ "$_jelly_count" -ge 1000 ]; then _jelly_truncated=1; break; fi
    printf '%s\000' "$_jelly_entry"
    _jelly_count=$((_jelly_count + 1))
  done
fi
printf '\000JELLY_END\000%s\000' "$_jelly_truncated"
`;

export class RemoteTmux extends Tmux {
  readonly socketName: string;
  readonly controlPath: string;
  constructor(config: Config, readonly host: Host) {
    super(config);
    this.socketName = `jelly-${config.instanceId}`;
    const key = createHash('sha256').update(JSON.stringify([
      config.instanceId, config.sshConfig ?? null, host.id, host.target, host.port, host.identityFile,
    ])).digest('hex').slice(0, 24);
    // The data directory is private. Never reuse a master from the user's SSH config.
    this.controlPath = join(config.dataDir, `ssh-${key}`);
  }
  args(terminal: boolean, multiplex = true): string[] {
    // Leave room for OpenSSH's temporary socket suffix on Unix platforms.
    const share = multiplex && Buffer.byteLength(this.controlPath) <= 80;
    return [
      ...(this.config.sshConfig ? ['-F', this.config.sshConfig] : []),
      '-a', '-x', '-e', 'none', terminal ? '-tt' : '-T',
      '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=4',
      '-o', 'ConnectionAttempts=1', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2',
      ...(share
        ? ['-o', 'ControlMaster=auto', '-o', 'ControlPersist=60', '-S', this.controlPath.replaceAll('%', '%%')]
        : ['-o', 'ControlMaster=no', '-S', 'none']),
      '-o', 'ClearAllForwardings=yes',
      '-o', 'PermitLocalCommand=no', '-o', 'RemoteCommand=none', '-o', 'LogLevel=ERROR',
      ...(this.host.port === null ? [] : ['-p', String(this.host.port)]),
      ...(this.host.identityFile ? ['-i', this.host.identityFile] : []),
      '--', this.host.target,
    ];
  }
  private async command(args: string[], multiplex = true): Promise<string> {
    try {
      const { stdout } = await exec('ssh', [...this.args(false, multiplex), args.map(shellQuote).join(' ')], {
        env: { ...this.env(), LC_ALL: 'C' }, timeout: 6500, maxBuffer: 4 * 1024 * 1024,
      });
      return stdout;
    } catch (error) {
      const failure = error as { stderr?: string; code?: number | string; killed?: boolean };
      const stderr = String(failure.stderr ?? '');
      if (failure.code === 43) throw new ApiError(403, 'Directory access denied');
      if (failure.code === 44) throw new ApiError(404, 'Directory not found');
      if (failure.code === 45) throw new ApiError(400, 'Path is not an accessible directory');
      if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|host key is known/i.test(stderr)) throw new ApiError(502, 'SSH_HOST_KEY');
      if (/Permission denied|no supported authentication|sign_and_send_pubkey/i.test(stderr)) throw new ApiError(502, 'SSH_AUTH');
      if (failure.killed || failure.code === 255 || failure.code === 'ENOENT') throw new ApiError(502, 'SSH_UNREACHABLE');
      if (/tmux:.*not found|tmux:.*No such file/.test(stderr)) throw new ApiError(502, 'SSH_TMUX_MISSING');
      // Only missing tmux servers/sessions are interpreted as gone; transport errors must stay errors.
      if (/can't find session|no server running|error connecting to .*No such file|error connecting to .*Connection refused/.test(stderr)) {
        throw Object.assign(new Error('Missing remote tmux session'), { stderr: 'no server running' });
      }
      throw new ApiError(502, 'SSH_COMMAND_FAILED');
    }
  }
  async probe(): Promise<{ status: 'ok'; tmux: string }> {
    // An explicit connection check must revalidate keys/authentication, even
    // when an older authenticated transport is still serving open terminals.
    const output = await this.command(['tmux', '-V'], false);
    const version = /tmux (\d+)\.(\d+)\S*/.exec(output);
    if (!version || Number(version[1]) < 3 || (Number(version[1]) === 3 && Number(version[2]) < 2)) throw new ApiError(502, 'SSH_TMUX_VERSION');
    return { status: 'ok', tmux: version[0] };
  }
  override async check(): Promise<void> { await this.probe(); }
  override async run(...args: string[]): Promise<string> {
    // A timed-out multiplex client can leave a command queued in the master.
    // Only read-only queries share channels. Create/stop authenticate on fresh
    // transports instead of queueing mutations behind a stalled connection.
    const multiplex = args[0] === 'list-panes' || args[0] === 'capture-pane';
    return (await this.command(['tmux', '-u', '-L', this.socketName, '-f', '/dev/null', ...args], multiplex)).trimEnd();
  }
  override async create(id: string, cwd: string, cols: number, rows: number): Promise<void> {
    await this.run('start-server',
      ';', 'set-option', '-g', 'status', 'off',
      ';', 'set-option', '-g', 'prefix', 'None', ';', 'unbind-key', '-q', 'C-b',
      ';', 'set-option', '-g', 'mouse', 'on',
      ';', 'set-option', '-g', 'history-limit', '10000',
      ';', 'set-option', '-g', 'default-terminal', 'tmux-256color',
      ';', 'set-option', '-g', 'exit-unattached', 'off',
      ';', 'set-option', '-g', 'destroy-unattached', 'off',
      ';', 'set-option', '-s', 'escape-time', '10',
      ';', 'set-option', '-w', '-g', 'remain-on-exit', 'on',
      ';', 'set-option', '-w', '-g', 'window-size', 'latest',
      ';', 'new-session', '-d', '-s', this.name(id), '-c', cwd, '-x', String(cols), '-y', String(rows));
  }
  override attach(id: string, cols: number, rows: number): pty.IPty {
    const command = ['tmux', '-u', '-L', this.socketName, ...this.attachArgs(id)].map(shellQuote).join(' ');
    return pty.spawn('ssh', [...this.args(true), `exec ${command}`], {
      name: 'xterm-256color', cols, rows, cwd: this.config.dataDir, env: this.env() as Record<string, string>,
    });
  }
  async directories(path?: string, hidden = false, list = true) {
    const output = await this.command(['sh', '-c', browseScript, 'jelly', path ?? '', String(hidden), String(list)]);
    const marker = '\0JELLY_DIR_V1\0';
    const start = output.indexOf(marker);
    const end = output.lastIndexOf('\0JELLY_END\0');
    if (start < 0 || end < start) throw new ApiError(502, 'SSH_COMMAND_FAILED');
    const parts = output.slice(start + marker.length, end).split('\0');
    const home = parts.shift()!;
    const current = parts.shift()!;
    parts.pop();
    if (!current.startsWith('/')) throw new ApiError(502, 'SSH_COMMAND_FAILED');
    const directories = parts.map(value => { const name = value.slice(2); return { name, path: posix.join(current, name) }; });
    directories.sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
    return { path: current, parent: current === '/' ? null : posix.dirname(current), home, directories,
      truncated: output.slice(end + '\0JELLY_END\0'.length).startsWith('1\0') };
  }
}
