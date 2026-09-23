import { opendir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ApiError } from './http.js';

const limit = 1000;

// Read only one directory, using the same account and permissions as Jelly's shells.
export async function listDirectories(requestedPath = homedir(), hidden = false) {
  try {
    const path = await realpath(requestedPath);
    const entries = await opendir(path);
    const directories: { name: string; path: string }[] = [];
    let truncated = false;
    for await (const entry of entries) {
      if (!hidden && entry.name.startsWith('.')) continue;
      const entryPath = join(path, entry.name);
      const isDirectory = entry.isDirectory() || (entry.isSymbolicLink()
        && await stat(entryPath).then(value => value.isDirectory(), () => false));
      if (!isDirectory) continue;
      if (directories.length === limit) { truncated = true; break; }
      directories.push({ name: entry.name, path: entryPath });
    }
    directories.sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
    const parent = dirname(path);
    return { path, parent: parent === path ? null : parent, home: homedir(), directories, truncated };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new ApiError(404, 'Directory not found');
    if (code === 'EACCES' || code === 'EPERM') throw new ApiError(403, 'Directory access denied');
    if (code === 'ENOTDIR' || code === 'ELOOP') throw new ApiError(400, 'Path is not an accessible directory');
    throw error;
  }
}
