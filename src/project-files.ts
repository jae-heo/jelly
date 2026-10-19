import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { posix, relative, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { ApiError } from './http.js';
import { RemoteTmux, shellQuote } from './remote.js';
import type { Config } from './config.js';
import type { Project, Host } from './store.js';

export interface FileEntry { name: string; path: string; kind: 'directory' | 'file' }
export interface FileListing { path: string; parent: string | null; entries: FileEntry[]; truncated: boolean }
export function filePath(path: string): string {
  if (path.length > 4096 || path.includes('\0') || path.startsWith('/') || path.split('/').some(part => part === '..' || part === '.')) throw new ApiError(400, 'Invalid project file path');
  return path.split('/').filter(Boolean).join('/');
}
function fileError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') throw new ApiError(404, 'File or folder not found');
  if (['EACCES', 'EPERM', 'ELOOP'].includes(code ?? '')) throw new ApiError(403, 'File access denied');
  if (['ENOTDIR', 'EISDIR'].includes(code ?? '')) throw new ApiError(400, 'Invalid file or folder');
  throw error;
}
async function openLocal(root: string, path: string, directory: boolean) {
  if (await realpath(root) !== root) throw new ApiError(403, 'Project folder changed. Register it again.');
  const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  let handle = await open(root, flags | constants.O_DIRECTORY);
  try {
    // Linux fd-relative opens keep each checked directory pinned. A symlink
    // swap between validation and open cannot redirect a later component.
    if (await realpath(`/proc/self/fd/${handle.fd}`) !== root) throw new ApiError(403, 'Project folder changed. Try again.');
    const parts = filePath(path).split('/').filter(Boolean);
    for (const [index, part] of parts.entries()) {
      const childPath = `/proc/self/fd/${handle.fd}/${part}`;
      let next;
      try { next = await open(childPath, flags | (directory || index < parts.length - 1 ? constants.O_DIRECTORY : 0)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOTDIR' && await lstat(childPath).then(info => info.isSymbolicLink(), () => false)) throw new ApiError(403, 'Symbolic links are not available');
        throw error;
      }
      await handle.close(); handle = next;
    }
    const rel = relative(root, await realpath(`/proc/self/fd/${handle.fd}`));
    if (rel === '..' || rel.startsWith('..' + sep) || rel.startsWith(sep)) throw new ApiError(403, 'File is outside the project');
    const info = await handle.stat();
    if (!(directory ? info.isDirectory() : info.isFile())) throw new ApiError(400, 'Choose a regular file');
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

// POSIX sh only: walk relative components, reject links, and pin the working
// directory before opening a file. No remote agent, Python or Node required.
const remoteScript = String.raw`
_jelly_root=$1
_jelly_path=$2
_jelly_action=$3
_jelly_hidden=$4
cd -P "$_jelly_root" 2>/dev/null || exit 44
[ "$PWD" = "$_jelly_root" ] || exit 43
_jelly_prefix=\${_jelly_root%/}/
while [ -n "$_jelly_path" ]; do
  case $_jelly_path in */*) _jelly_part=\${_jelly_path%%/*}; _jelly_path=\${_jelly_path#*/};; *) _jelly_part=$_jelly_path; _jelly_path=;; esac
  [ ! -L "./$_jelly_part" ] || exit 43
  if [ -n "$_jelly_path" ] || [ "$_jelly_action" = list ]; then
    cd -P "./$_jelly_part" 2>/dev/null || exit 44
    case "$PWD/" in "$_jelly_prefix"*) ;; *) exit 43;; esac
  else
    [ -f "./$_jelly_part" ] || exit 44
    [ -r "./$_jelly_part" ] || exit 43
    exec 3< "./$_jelly_part" || exit 43
    [ ! -L "./$_jelly_part" ] && [ -f "./$_jelly_part" ] || exit 43
    printf '\000JELLY_FILE_V1\000'
    cat <&3
    exit $?
  fi
done
[ "$_jelly_action" = list ] || exit 45
printf '\000JELLY_LIST_V1\000'
_jelly_count=0
_jelly_more=0
set -- ./*
if [ "$_jelly_hidden" = true ]; then set -- "$@" ./.[!.]* ./..?*; fi
for _jelly_entry do
  [ ! -L "$_jelly_entry" ] || continue
  if [ -d "$_jelly_entry" ]; then _jelly_kind=directory
  elif [ -f "$_jelly_entry" ]; then _jelly_kind=file
  else continue; fi
  if [ "$_jelly_count" -ge 1000 ]; then _jelly_more=1; break; fi
  printf '%s\000%s\000' "$_jelly_kind" "\${_jelly_entry#./}"
  _jelly_count=$((_jelly_count + 1))
done
printf '\000%s\000' "$_jelly_more"
`.replaceAll('\\${', '${');

function remoteStream(config: Config, host: Host, root: string, path: string, action: string, hidden: boolean, signal: AbortSignal): Readable {
  const remote = new RemoteTmux(config, host);
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: 'C' };
  delete env.TMUX; delete env.TMUX_PANE; delete env.JELLY_TOKEN;
  const child = spawn('ssh', [...remote.args(false, false), ['sh', '-c', remoteScript, 'jelly-files', root, path, action, String(hidden)].map(shellQuote).join(' ')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-8192); });
  const completed = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  void completed.catch(() => {});
  const cancel = () => { child.kill('SIGKILL'); };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const result = Readable.from((async function* () {
    try {
      for await (const chunk of child.stdout) yield chunk;
      const code = await completed;
      if (signal.aborted) throw new ApiError(408, 'File transfer cancelled');
      if (code === 43) throw new ApiError(403, 'File access denied');
      if (code === 44) throw new ApiError(404, 'File or folder not found');
      if (code === 45) throw new ApiError(400, 'Choose a regular file');
      if (code !== 0) {
        if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(stderr)) throw new ApiError(502, 'SSH_HOST_KEY');
        if (/Permission denied|sign_and_send_pubkey/i.test(stderr)) throw new ApiError(502, 'SSH_AUTH');
        throw new ApiError(502, 'SSH_UNREACHABLE');
      }
    } finally { cancel(); signal.removeEventListener('abort', cancel); }
  })());
  result.once('close', () => { cancel(); signal.removeEventListener('abort', cancel); });
  return result;
}
export class ProjectFiles {
  constructor(private config: Config, private host: (id: string) => Host | undefined) {}
  private remote(project: Project, path: string, action: string, hidden: boolean, signal: AbortSignal) {
    const host = this.host(project.hostId!);
    if (!host) throw new ApiError(404, 'SSH server not found');
    return remoteStream(this.config, host, project.path, path, action, hidden, signal);
  }
  async list(project: Project, requested: string, hidden: boolean, signal: AbortSignal): Promise<FileListing> {
    const path = filePath(requested);
    const entries: FileEntry[] = [];
    let truncated = false;
    try {
      if (project.hostId) {
        const output = (await collect(this.remote(project, path, 'list', hidden, signal), 1024 * 1024)).toString('utf8');
        const marker = '\0JELLY_LIST_V1\0';
        const start = output.indexOf(marker);
        if (start < 0) throw new ApiError(502, 'SSH_COMMAND_FAILED');
        const fields = output.slice(start + marker.length).split('\0');
        while (fields.length > 3) {
          const kind = fields.shift(); const name = fields.shift()!;
          if (!['directory', 'file'].includes(kind!) || !name || name.includes('/') || name === '.' || name === '..') throw new ApiError(502, 'SSH_COMMAND_FAILED');
          entries.push({ name, path: posix.join(path, name), kind: kind as FileEntry['kind'] });
        }
        if (fields.length !== 3 || fields[0] !== '' || !['0', '1'].includes(fields[1]!)) throw new ApiError(502, 'SSH_COMMAND_FAILED');
        truncated = fields[1] === '1';
      } else {
        const handle = await openLocal(project.path, path, true);
        try {
          const folder = await opendir(`/proc/self/fd/${handle.fd}`);
          for await (const entry of folder) {
            if ((!hidden && entry.name.startsWith('.')) || (!entry.isDirectory() && !entry.isFile())) continue;
            if (entries.length === 1000) { truncated = true; break; }
            entries.push({ name: entry.name, path: posix.join(path, entry.name), kind: entry.isDirectory() ? 'directory' : 'file' });
          }
        } finally { await handle.close(); }
      }
    } catch (error) { fileError(error); }
    entries.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name, 'en', { numeric: true }));
    return { path, parent: path ? (posix.dirname(path) === '.' ? '' : posix.dirname(path)) : null, entries, truncated };
  }
  async open(project: Project, requested: string, signal: AbortSignal): Promise<Readable> {
    const path = filePath(requested);
    if (!path) throw new ApiError(400, 'Choose a regular file');
    try {
      if (project.hostId) {
        const stream = this.remote(project, path, 'read', false, signal);
        const iterator = stream[Symbol.asyncIterator]();
        let head = Buffer.alloc(0);
        const marker = Buffer.from('\0JELLY_FILE_V1\0');
        try {
          while (true) {
            const next = await iterator.next();
            if (next.done) throw new ApiError(502, 'SSH_COMMAND_FAILED');
            head = Buffer.concat([head, next.value as Buffer]);
            const start = head.indexOf(marker);
            if (start >= 0) { head = head.subarray(start + marker.length); break; }
            if (head.length > 8192) throw new ApiError(502, 'SSH_COMMAND_FAILED');
          }
        } catch (error) { stream.destroy(); throw error; }
        const result = Readable.from((async function* () {
          try {
            if (head.length) yield head;
            while (true) { const next = await iterator.next(); if (next.done) break; yield next.value; }
          } finally { stream.destroy(); }
        })());
        result.once('close', () => stream.destroy());
        return result;
      }
      const handle = await openLocal(project.path, path, false);
      return handle.createReadStream({ signal });
    } catch (error) { fileError(error); }
  }
}
export async function collect(stream: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0;
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > limit) throw new ApiError(413, 'File is too large to preview. Download it instead.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally { stream.destroy(); }
}
export function previewType(path: string): { type: string; limit: number; kind: 'text' | 'image' | 'pdf' } {
  const extension = posix.extname(path).slice(1).toLowerCase();
  const images: Record<string, string> = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', webp: 'webp', avif: 'avif' };
  if (images[extension]) return { type: 'image/' + images[extension], limit: 20 * 1024 * 1024, kind: 'image' };
  if (extension === 'pdf') return { type: 'application/pdf', limit: 20 * 1024 * 1024, kind: 'pdf' };
  if (['txt','md','mdx','log','json','jsonl','yaml','yml','toml','ini','csv','tsv','xml','svg','html','css','scss','js','jsx','ts','tsx','mjs','cjs','py','sh','bash','zsh','sql','go','rs','c','h','cpp','hpp','java','rb','php','env','conf','gitignore'].includes(extension) || ['readme','license','dockerfile','makefile','.gitignore','.env'].includes(posix.basename(path).toLowerCase())) return { type: 'text/plain; charset=utf-8', limit: 1024 * 1024, kind: 'text' };
  throw new ApiError(415, 'Preview is not available for this file. Download it instead.');
}
