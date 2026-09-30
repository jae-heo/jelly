export interface Host { id: string; name: string; target: string; port: number | null; identityFile: string | null }
export interface Project { id: string; name: string; path: string; hostId: string | null; createdAt: string }
export interface Session { id: string; projectId: string; name: string; status: 'running' | 'stopped' | 'exited' | 'lost' | 'unreachable'; connected: boolean; createdAt: string; cols?: number; rows?: number }

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export async function api<T>(token: string, path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api' + path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000), redirect: 'error',
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, data.error ?? 'Request failed');
  return data as T;
}
export function storedToken(): string {
  return localStorage.getItem('jelly-token') ?? sessionStorage.getItem('jelly-token') ?? '';
}
export function forgetToken() { localStorage.removeItem('jelly-token'); sessionStorage.removeItem('jelly-token'); }
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const sshErrors: Record<string, string> = {
      SSH_HOST_KEY: 'Verify the host key by connecting over SSH from the Jelly server.',
      SSH_AUTH: 'SSH authentication failed. Check the SSH key and access permissions.',
      SSH_UNREACHABLE: 'SSH connection failed. Check the address, port and network.',
      SSH_TMUX_MISSING: 'Install tmux 3.2 or later on the remote server.',
      SSH_TMUX_VERSION: 'The remote server requires tmux 3.2 or later.',
      SSH_COMMAND_FAILED: 'Remote command failed. Check the SSH environment and tmux.',
    };
    if (sshErrors[error.message]) return sshErrors[error.message]!;
    if (error.status === 401) return 'Invalid connection key.';
    if (error.status === 403) return 'Origin not allowed. Check the server address.';
    if (error.message.includes('already registered')) return 'This project folder is already registered.';
    if (error.message.includes('directory')) return 'Enter an absolute folder path on the server.';
    if (error.status === 409) return 'Session state changed. Refresh the list.';
    return error.message;
  }
  return 'Cannot reach the server. Check your Tailscale connection.';
}
