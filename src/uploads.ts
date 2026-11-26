import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from './config.js';
import type { Store } from './store.js';
import { ApiError } from './http.js';
import { RemoteTmux, shellQuote, sshError } from './remote.js';

export const UPLOAD_LIMIT = 50 * 1024 * 1024;
export const CHUNK_LIMIT = 2 * 1024 * 1024;
const KEEP_DAYS = 7;

// Keeps letters and digits in any script, so a pasted path needs no quoting.
export function uploadName(name: string): string {
  const base = name.normalize('NFC').replace(/^[\s\S]*[\\/]/, '');
  let clean = Array.from(base, char => /[\p{L}\p{N}._-]/u.test(char) ? char : '_').join('').replace(/^[.-]+/, '');
  const extension = /\.[\p{L}\p{N}]{1,12}$/u.exec(clean)?.[0] ?? '';
  while (Buffer.byteLength(clean) > 200) clean = Array.from(clean.slice(0, clean.length - extension.length)).slice(0, -1).join('') + extension;
  return /^_*$/.test(clean.slice(0, clean.length - extension.length)) ? 'file' + extension : clean;
}

// POSIX sh only. Uploads go to a private folder in the target's temp
// directory, never into the project. Folders older than a week are removed.
const remoteScript = String.raw`
set -f
umask 077
_jelly_base=\${TMPDIR:-/tmp}
_jelly_base=\${_jelly_base%/}/jelly-$1
_jelly_dir=$_jelly_base/$2
_jelly_file=$_jelly_dir/$3
_jelly_offset=$4
case $_jelly_base in /*) ;; *) exit 43;; esac
[ "$_jelly_offset" = 0 ] && mkdir "$_jelly_base" 2>/dev/null
[ -d "$_jelly_base" ] && [ ! -L "$_jelly_base" ] || exit 43
set -- $(ls -ldn "$_jelly_base")
case $1 in drwx------*) ;; *) exit 43;; esac
[ "$3" = "$(id -u)" ] || exit 43
if [ "$_jelly_offset" = 0 ]; then
  find "$_jelly_base" ! -path "$_jelly_base" -prune -mtime +${KEEP_DAYS - 1} -exec rm -rf {} + 2>/dev/null
  mkdir "$_jelly_dir" || exit 43
  cat > "$_jelly_file" || exit 46
else
  [ -f "$_jelly_file" ] && [ ! -L "$_jelly_file" ] || exit 44
  [ "$(wc -c < "$_jelly_file" | tr -d ' ')" = "$_jelly_offset" ] || exit 47
  cat >> "$_jelly_file" || exit 46
fi
printf '\000JELLY_UPLOAD_V1\000%s\000' "$_jelly_file"
`.replaceAll('\\${', '${');

interface Pending { hostId: string | null; dir: string; name: string; path: string; size: number; received: number; expires: number }

export class Uploads {
  private pending = new Map<string, Pending>();
  constructor(private config: Config, private store: Store) {}
  private prune() { for (const [key, value] of this.pending) if (value.expires <= Date.now()) this.pending.delete(key); }
  private localBase() { return join(tmpdir(), `jelly-${this.config.instanceId}`); }
  async start(hostId: string | null, requested: string, size: number, chunk: Buffer, signal: AbortSignal) {
    this.prune();
    if (size > UPLOAD_LIMIT) throw new ApiError(413, 'Files up to 50 MiB can be uploaded');
    if (chunk.length > size || (chunk.length < size && chunk.length !== CHUNK_LIMIT)) throw new ApiError(400, 'Invalid upload chunk');
    if (this.pending.size >= 16) throw new ApiError(429, 'Too many uploads in progress. Try again shortly.');
    const name = uploadName(requested);
    const dir = randomBytes(9).toString('base64url');
    const path = await this.write(hostId, dir, name, 0, chunk, signal);
    const id = randomBytes(32).toString('base64url');
    if (chunk.length < size) this.pending.set(id, { hostId, dir, name, path, size, received: chunk.length, expires: Date.now() + 120_000 });
    return { id, path, received: chunk.length };
  }
  async append(id: string, offset: number, chunk: Buffer, signal: AbortSignal) {
    this.prune();
    const upload = this.pending.get(id);
    if (!upload) throw new ApiError(404, 'Upload expired. Attach the file again.');
    const end = offset + chunk.length;
    if (offset !== upload.received || end > upload.size || (end < upload.size && chunk.length !== CHUNK_LIMIT)) throw new ApiError(409, 'Upload chunk out of order');
    // One chunk at a time: a retry or a parallel request cannot interleave.
    this.pending.delete(id);
    await this.write(upload.hostId, upload.dir, upload.name, offset, chunk, signal);
    if (end < upload.size) this.pending.set(id, { ...upload, received: end, expires: Date.now() + 120_000 });
    return { received: end };
  }
  private async write(hostId: string | null, dir: string, name: string, offset: number, chunk: Buffer, signal: AbortSignal): Promise<string> {
    if (hostId) return this.remote(hostId, dir, name, offset, chunk, signal);
    const base = this.localBase();
    try {
      if (offset === 0) await mkdir(base, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      const info = await lstat(base);
      if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077)) throw new ApiError(403, 'Upload folder is not private');
      const path = join(base, dir, name);
      if (offset === 0) {
        await this.expire(base);
        await mkdir(join(base, dir), { mode: 0o700 });
        await writeFile(path, chunk, { flag: 'wx', mode: 0o600, signal });
        return path;
      }
      const handle = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
      try {
        if ((await handle.stat()).size !== offset) throw new ApiError(409, 'Upload chunk out of order');
        await handle.write(chunk);
      } finally { await handle.close(); }
      return path;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ELOOP') throw new ApiError(404, 'Upload expired. Attach the file again.');
      if (code === 'ENOSPC' || code === 'EDQUOT') throw new ApiError(507, 'Not enough space in the temp folder');
      throw error;
    }
  }
  private async expire(base: string) {
    const limit = Date.now() - KEEP_DAYS * 86_400_000;
    for (const entry of await readdir(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(base, entry.name);
      if (((await lstat(path).catch(() => null))?.mtimeMs ?? Infinity) < limit) await rm(path, { recursive: true, force: true });
    }
  }
  private remote(hostId: string, dir: string, name: string, offset: number, chunk: Buffer, signal: AbortSignal): Promise<string> {
    const host = this.store.host(hostId);
    if (!host) throw new ApiError(404, 'SSH server not found');
    const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: 'C' };
    delete env.TMUX; delete env.TMUX_PANE; delete env.JELLY_TOKEN;
    const command = ['sh', '-c', remoteScript, 'jelly-upload', this.config.instanceId, dir, name, String(offset)].map(shellQuote).join(' ');
    const child = spawn('ssh', [...new RemoteTmux(this.config, host).args(false, false), command], { env, stdio: ['pipe', 'pipe', 'pipe'], signal });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', data => { stdout = (stdout + String(data)).slice(-8192); });
    child.stderr.on('data', data => { stderr = (stderr + String(data)).slice(-8192); });
    child.stdin.on('error', () => {});
    child.stdin.end(chunk);
    return new Promise((resolve, reject) => {
      child.once('error', () => reject(new ApiError(408, 'Upload cancelled')));
      child.once('close', code => {
        if (signal.aborted) return reject(new ApiError(408, 'Upload cancelled'));
        if (code === 43) return reject(new ApiError(403, 'Upload folder is not private'));
        if (code === 44) return reject(new ApiError(404, 'Upload expired. Attach the file again.'));
        if (code === 46) return reject(new ApiError(507, 'Not enough space in the temp folder'));
        if (code === 47) return reject(new ApiError(409, 'Upload chunk out of order'));
        if (code !== 0) return reject(sshError(stderr));
        const path = /\0JELLY_UPLOAD_V1\0([^\0]+)\0$/.exec(stdout)?.[1];
        if (!path?.startsWith('/') || !path.endsWith('/' + dir + '/' + name)) return reject(new ApiError(502, 'SSH_COMMAND_FAILED'));
        resolve(path);
      });
    });
  }
  close() { this.pending.clear(); }
}
