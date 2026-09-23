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
  if (!response.ok) throw new ApiError(response.status, data.error ?? '요청 처리 실패');
  return data as T;
}
export function storedToken(): string {
  return localStorage.getItem('jelly-token') ?? sessionStorage.getItem('jelly-token') ?? '';
}
export function forgetToken() { localStorage.removeItem('jelly-token'); sessionStorage.removeItem('jelly-token'); }
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const sshErrors: Record<string, string> = {
      SSH_HOST_KEY: 'SSH 호스트 키 확인 필요. 줼리 서버에서 해당 대상에 SSH로 접속해 호스트 키를 확인하세요.',
      SSH_AUTH: 'SSH 인증 실패. 줼리 서버의 SSH 키와 대상 서버의 접속 권한을 확인하세요.',
      SSH_UNREACHABLE: 'SSH 연결 실패. 주소·포트·네트워크를 확인하세요.',
      SSH_TMUX_MISSING: '원격 서버에 tmux가 없습니다. tmux 3.2 이상을 설치하세요.',
      SSH_TMUX_VERSION: '원격 서버에 tmux 3.2 이상이 필요합니다.',
      SSH_COMMAND_FAILED: '원격 명령 실행 실패. SSH 접속 환경과 tmux를 확인하세요.',
    };
    if (sshErrors[error.message]) return sshErrors[error.message]!;
    if (error.status === 401) return '연결 키가 올바르지 않습니다.';
    if (error.status === 403) return '허용되지 않은 접속 주소입니다. 서버 주소를 확인하세요.';
    if (error.message.includes('already registered')) return '이미 등록된 프로젝트 폴더입니다.';
    if (error.message.includes('directory')) return '서버에 있는 폴더의 절대 경로를 입력하세요.';
    if (error.status === 409) return '세션 상태가 변경되었습니다. 목록을 새로고침하세요.';
    return error.message;
  }
  return '서버 연결 실패. Tailscale 연결을 확인하세요.';
}
