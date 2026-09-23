import { glob, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export const sshTargetPattern = /^[a-zA-Z0-9_][a-zA-Z0-9_.:@-]{0,254}$/;

// Read static Host definitions only. Never evaluate Match exec, ProxyCommand or shell expansions.
export async function sshAliases(configFile?: string): Promise<{ aliases: string[] }> {
  const names = new Set<string>();
  const visited = new Set<string>();
  async function read(path: string, base: string, depth = 0): Promise<void> {
    if (depth > 16 || visited.has(path) || visited.size >= 256) return;
    visited.add(path);
    let content: string;
    try { content = await readFile(path, 'utf8'); }
    catch (error) { if (['ENOENT', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) return; throw error; }
    for (const line of content.split(/\r?\n/)) {
      // Strip comments outside quoted arguments before tokenizing.
      const clean = line.replace(/("(?:[^"\\]|\\.)*"|'[^']*')|#.*/g, (match, quoted) => quoted ?? '');
      const parts = (clean.match(/"(?:[^"\\]|\\.)*"|'[^']*'|[^\s=]+/g) ?? []).map(value => value.replace(/^(["'])(.*)\1$/, '$2'));
      const keyword = parts.shift()?.toLowerCase();
      if (keyword === 'host') for (const name of parts) if (sshTargetPattern.test(name)) names.add(name);
      if (keyword === 'include') for (const pattern of parts) {
        const expanded = pattern.startsWith('~/') ? join(homedir(), pattern.slice(2)) : isAbsolute(pattern) ? pattern : join(base, pattern);
        for await (const included of glob(expanded)) await read(included, base, depth + 1);
      }
    }
  }
  if (configFile) await read(configFile, join(homedir(), '.ssh'));
  else {
    await read(join(homedir(), '.ssh/config'), join(homedir(), '.ssh'));
    await read('/etc/ssh/ssh_config', '/etc/ssh');
  }
  return { aliases: [...names].sort((a, b) => a.localeCompare(b)) };
}
