import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as pty from 'node-pty';
import type { Config } from './config.js';

const exec = promisify(execFile);
export interface TerminalState { status: 'running' | 'exited' | 'lost' | 'unreachable'; pid?: number; cols?: number; rows?: number; exitCode?: number }

export class Tmux {
  constructor(readonly config: Config) {}
  name(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid session ID');
    return `jelly-${id}`;
  }
  protected env(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    delete env.TMUX;
    delete env.TMUX_PANE;
    delete env.JELLY_TOKEN;
    return env;
  }
  async run(...args: string[]): Promise<string> {
    const { stdout } = await exec('tmux', ['-S', this.config.socket, '-f', this.config.tmuxConfig, ...args], {
      env: this.env(), timeout: 5000, maxBuffer: 4 * 1024 * 1024,
    });
    return stdout.trimEnd();
  }
  async check(): Promise<void> { await exec('tmux', ['-V']); }
  async create(id: string, cwd: string, cols: number, rows: number): Promise<void> {
    // A separate tmux server owns the shell, so killing the API/attach PTY does not kill the work.
    await this.run('new-session', '-d', '-s', this.name(id), '-c', cwd, '-x', String(cols), '-y', String(rows), this.config.shell);
  }
  async states(): Promise<Map<string, TerminalState>> {
    let output: string;
    try {
      output = await this.run('list-panes', '-a', '-F', '#{session_name}|#{pane_dead}|#{pane_pid}|#{pane_width}|#{pane_height}|#{pane_dead_status}');
    } catch (error) {
      const stderr = String((error as { stderr?: string }).stderr ?? '');
      if (/no server running|No such file or directory|Connection refused/.test(stderr)) return new Map();
      throw error;
    }
    const states = new Map<string, TerminalState>();
    for (const line of output.split('\n')) {
      const [name, dead, pid, cols, rows, code] = line.split('|');
      if (!name?.startsWith('jelly-')) continue;
      if (![pid, cols, rows].every(value => value && Number.isFinite(Number(value)))) throw new Error('Invalid tmux state response');
      states.set(name.slice(6), {
        status: dead === '1' ? 'exited' : 'running', pid: Number(pid), cols: Number(cols), rows: Number(rows),
        ...(dead === '1' && code ? { exitCode: Number(code) } : {}),
      });
    }
    return states;
  }
  async stop(id: string): Promise<void> {
    try { await this.run('kill-session', '-t', `=${this.name(id)}`); }
    catch (error) {
      const stderr = String((error as { stderr?: string }).stderr ?? '');
      if (!/can't find session|no server running|No such file or directory|Connection refused/.test(stderr)) throw error;
    }
  }
  protected attachArgs(id: string): string[] {
    const name = this.name(id);
    // Apply on attachment too: persistent sessions may predate mouse/scroll support.
    return ['set-option', '-t', name, 'mouse', 'on',
      // Esc should return to the live screen regardless of the server's EDITOR/mode-keys.
      ';', 'bind-key', '-T', 'copy-mode-vi', 'Escape', 'send-keys', '-X', 'cancel',
      ';', 'attach-session', '-t', `=${name}`];
  }
  attach(id: string, cols: number, rows: number): pty.IPty {
    return pty.spawn('tmux', ['-S', this.config.socket, ...this.attachArgs(id)], {
      name: 'xterm-256color', cols, rows, cwd: this.config.dataDir, env: this.env() as Record<string, string>,
    });
  }
  async history(id: string, lines: number): Promise<string> {
    return this.run('capture-pane', '-p', '-J', '-t', `=${this.name(id)}:0.0`, '-S', String(-lines));
  }
}
