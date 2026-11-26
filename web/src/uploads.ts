import { ApiError } from './api';

export const UPLOAD_LIMIT = 50 * 1024 * 1024;
const CHUNK = 2 * 1024 * 1024;

async function post<T>(token: string, path: string, body: Blob): Promise<T> {
  const response = await fetch('/api' + path, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    body, signal: AbortSignal.timeout(60_000), redirect: 'error',
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, data.error ?? 'Request failed');
  return data as T;
}

// Uploads in chunks so each request stays short on slow connections. Returns
// the file's absolute path on the session's server.
export async function uploadFile(token: string, sessionId: string, file: File): Promise<string> {
  if (file.size > UPLOAD_LIMIT) throw new ApiError(413, 'Files up to 50 MiB can be uploaded');
  const query = new URLSearchParams({ name: file.name || 'file', size: String(file.size) });
  const first = await post<{ id: string; path: string; received: number }>(token, `/sessions/${sessionId}/uploads?${query}`, file.slice(0, CHUNK));
  for (let offset = first.received; offset < file.size; offset += CHUNK) {
    await post(token, `/uploads/${first.id}?offset=${offset}`, file.slice(offset, offset + CHUNK));
  }
  return first.path;
}

// Paths as typed after a file drop in a native terminal: quoted only when needed,
// followed by a space.
export function pastedPaths(paths: string[]): string {
  return paths.map(path => /^[\p{L}\p{N}/._-]+$/u.test(path) ? path : "'" + path.replaceAll("'", "'\\''") + "'").join(' ') + ' ';
}
