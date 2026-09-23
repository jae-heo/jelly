import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, CircleAlert, ChevronDown, Folder, Plus, Power, RefreshCw, TerminalSquare, Trash2, Unplug, X, Server } from 'lucide-react';
import { api, ApiError, errorMessage, forgetToken, storedToken, type Host, type Project, type Session } from './api';
import { Login } from './Login';
import { Modal } from './Modal';
import { ProjectDialog } from './ProjectDialog';
import { HostManager } from './Hosts';
import { WorkspaceHeader } from './WorkspaceHeader';
import { TerminalControls } from './TerminalControls';
import { FONT_SIZE_KEY, storedFontSize } from './terminalSettings';
import { useWorkspaceViewport } from './useWorkspaceViewport';
import { useFullscreen } from './useFullscreen';
import type { Connection, TerminalHandle } from './TerminalView';
const TerminalCache = lazy(() => import('./TerminalCache').then(module => ({ default: module.TerminalCache })));

type Dialog = 'hosts' | 'project' | 'session' | 'stop' | 'paste' | 'help' | 'delete-project' | null;
const stateLabels = { running: '실행 중', exited: '종료됨', stopped: '종료됨', lost: '세션 없음', unreachable: '서버 연결 안 됨' };
const connectionLabels: Record<Connection, string> = { connecting: '연결 중', connected: '연결됨', retrying: '다시 연결 중', disconnected: '연결 해제', taken: '다른 기기에서 접속 중', ended: '세션 연결 종료' };

export function App() {
  const [token, setToken] = useState(storedToken);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [projectId, setProjectId] = useState<string | null>(() => localStorage.getItem('jelly-project'));
  const [sessionId, setSessionId] = useState<string | null>(() => localStorage.getItem('jelly-session'));
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [sidebar, setSidebar] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [attached, setAttached] = useState(true);
  const [revision, setRevision] = useState(0);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [fontSize, setFontSize] = useState(storedFontSize);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState('');
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const terminal = useRef<TerminalHandle>(null);
  const historyGeneration = useRef(0);
  const screen = useFullscreen(!!token, setNotice);

  const logout = useCallback(() => { forgetToken(); setToken(''); setSessions([]); setProjects([]); setSessionId(null); }, []);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const [p, s, h] = await Promise.all([
        api<{ projects: Project[] }>(token, '/projects', 'GET', undefined, signal),
        api<{ sessions: Session[] }>(token, '/sessions', 'GET', undefined, signal),
        api<{ hosts: Host[] }>(token, '/hosts', 'GET', undefined, signal),
      ]);
      if (signal?.aborted) return;
      setProjects(p.projects); setSessions(s.sessions); setHosts(h.hosts); setOnline(true);
      setProjectId(current => p.projects.some(p => p.id === current) ? current : p.projects[0]?.id ?? null);
      setSessionId(current => s.sessions.some(s => s.id === current) ? current : null);
    } catch (error) {
      if (signal?.aborted) return;
      if (error instanceof ApiError && error.status === 401) logout();
      else setOnline(false);
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [token, logout]);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setLoading(true); void refresh(controller.signal);
    const interval = setInterval(() => { if (!document.hidden) void refresh(controller.signal); }, 5000);
    const visible = () => { if (!document.hidden) void refresh(controller.signal); };
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); clearInterval(interval); document.removeEventListener('visibilitychange', visible); };
  }, [token, refresh]);
  useEffect(() => { if (projectId) localStorage.setItem('jelly-project', projectId); else localStorage.removeItem('jelly-project'); }, [projectId]);
  useEffect(() => { if (sessionId) localStorage.setItem('jelly-session', sessionId); else localStorage.removeItem('jelly-session'); }, [sessionId]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    try { localStorage.setItem(FONT_SIZE_KEY, String(fontSize)); } catch { /* Keep the in-memory preference. */ }
  }, [fontSize]);
  useWorkspaceViewport(!!token);

  const project = projects.find(p => p.id === projectId);
  const session = sessions.find(s => s.id === sessionId && s.projectId === projectId);
  const projectSessions = sessions.filter(s => s.projectId === projectId);
  const canInput = session?.status === 'running' && attached && connection === 'connected';
  const openDialog = (value: Dialog) => { setFormError(''); setDialog(value); };
  function chooseProject(id: string) {
    if (id === projectId) return;
    historyGeneration.current++;
    setProjectId(id); setSessionId(null); setHistoryOpen(false);
    // Leave the list open on phones so the user can choose a session next.
  }
  function chooseSession(s: Session) {
    historyGeneration.current++;
    if (s.id !== sessionId || !attached) setConnection('connecting');
    setSessionId(s.id); setProjectId(s.projectId); setSidebar(false); setAttached(true);
    setHistoryOpen(false); setHistory('');
  }
  async function submitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFormError('');
    const form = new FormData(event.currentTarget);
    try {
      const p = await api<Project>(token, '/projects', 'POST', { name: form.get('name'), path: form.get('path'), hostId: form.get('hostId') || null });
      await refresh(); chooseProject(p.id); setDialog(null);
    } catch (error) { setFormError(errorMessage(error)); } finally { setBusy(false); }
  }
  async function submitSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!project) return; setBusy(true); setFormError('');
    const form = new FormData(event.currentTarget);
    try {
      const s = await api<Session>(token, `/projects/${project.id}/sessions`, 'POST', { name: form.get('name') });
      await refresh(); setSessions(previous => previous.some(row => row.id === s.id) ? previous : [...previous, s]);
      chooseSession(s); setDialog(null);
    } catch (error) { setFormError(errorMessage(error)); } finally { setBusy(false); }
  }
  async function stopSession() {
    if (!session) return; setBusy(true); setFormError('');
    try { await api(token, `/sessions/${session.id}/stop`, 'POST'); setAttached(false); await refresh(); setDialog(null); }
    catch (error) { setFormError(errorMessage(error)); } finally { setBusy(false); }
  }
  async function removeSession(s: Session) {
    try { await api(token, `/sessions/${s.id}`, 'DELETE'); await refresh(); }
    catch (error) { setNotice(errorMessage(error)); }
  }
  async function removeProject() {
    if (!project) return; setBusy(true);
    try { await api(token, `/projects/${project.id}`, 'DELETE'); await refresh(); setDialog(null); }
    catch (error) { setFormError(errorMessage(error)); } finally { setBusy(false); }
  }
  async function showHistory() {
    if (!session) return;
    const generation = ++historyGeneration.current;
    setHistoryOpen(true); setHistoryBusy(true); setHistoryError('');
    try {
      const result = await api<{ text: string }>(token, `/sessions/${session.id}/history?lines=2000`);
      if (generation === historyGeneration.current) setHistory(result.text);
    } catch (error) { if (generation === historyGeneration.current) setHistoryError(errorMessage(error)); }
    finally { if (generation === historyGeneration.current) setHistoryBusy(false); }
  }

  if (!token) return <Login onLogin={setToken} />;
  return <div className="workspace">
    <WorkspaceHeader project={project} session={session} hostName={hosts.find(host => host.id === project?.hostId)?.target ?? '이 서버'}
      status={session ? (session.status === 'running' ? connectionLabels[connection] : stateLabels[session.status]) : online ? '서버 연결됨' : '서버 연결 확인 중'}
      live={session ? canInput : online} online={online} sidebar={sidebar} fontSize={fontSize} historyOpen={historyOpen}
      fullscreenAvailable={screen.available} fullscreen={screen.fullscreen} onFullscreen={() => void screen.toggle()}
      canDeleteProject={!!project && projectSessions.length === 0} canDisconnect={attached && !['taken', 'ended'].includes(connection)}
      onSidebar={() => setSidebar(!sidebar)} onHistory={() => void showHistory()} onFontSize={setFontSize}
      onConnection={() => { if (attached && !['taken', 'ended'].includes(connection)) setAttached(false); else { setAttached(true); setRevision(r => r + 1); } }}
      onNewSession={() => openDialog('session')} onStop={() => openDialog('stop')} onDeleteProject={() => openDialog('delete-project')}
      onHosts={() => openDialog('hosts')} onHelp={() => openDialog('help')} onLogout={logout} />
    <div className="workspace-body">
      {sidebar && <button className="sidebar-backdrop" aria-label="목록 닫기" onClick={() => setSidebar(false)} />}
      <aside id="workspace-sidebar" className={`sidebar ${sidebar ? 'open' : ''}`}>
        <div className="section-title"><span>프로젝트 <small>{projects.length}</small></span><button className="icon-button" aria-label="프로젝트 추가" onClick={() => openDialog('project')}><Plus size={18} /></button></div>
        <nav className="project-list" aria-label="프로젝트">
          {projects.map(p => <button key={p.id} className={`project-item ${p.id === projectId ? 'selected' : ''}`} onClick={() => chooseProject(p.id)}><Folder size={17} /><span>{p.name}</span>{p.hostId && <Server size={13} aria-label="SSH 서버" />}{p.id === projectId && <ChevronDown size={14} />}</button>)}
          {!projects.length && !loading && <p className="sidebar-empty">프로젝트 없음</p>}
        </nav>
        <div className="session-section"><div className="section-title"><span>세션 <small>{projectSessions.length}</small></span><button className="icon-button" aria-label="새 세션" disabled={!project} onClick={() => openDialog('session')}><Plus size={18} /></button></div>
          <div className="session-list" aria-label="세션 목록">
            {projectSessions.map(s => <div key={s.id} className={`session-row ${s.id === session?.id ? 'selected' : ''}`}><button className="session-item" onClick={() => chooseSession(s)}><span className={`session-dot ${s.status}`} /><span className="session-text"><strong>{s.name}</strong><small>{s.status === 'running' && s.id === session?.id && connection === 'connected' ? '이 기기에서 연결됨' : stateLabels[s.status]}</small></span><TerminalSquare size={14} /></button>{s.status !== 'running' && s.status !== 'unreachable' && <button className="icon-button remove-session" aria-label={`${s.name} 기록 삭제`} onClick={() => void removeSession(s)}><Trash2 size={14} /></button>}</div>)}
            {!projectSessions.length && <div className="sidebar-empty-session"><TerminalSquare size={23} /><span>{loading ? '불러오는 중…' : '세션 없음'}</span>{project && <button className="text-button" onClick={() => openDialog('session')}>새 세션 <ArrowRight size={13} /></button>}</div>}
          </div>
        </div>
      </aside>
      <main className="main-panel">
        {!online && <div className="network-banner" role="alert">서버 연결 실패. Tailscale 연결을 확인하세요.<button className="text-button" onClick={() => void refresh()}>다시 시도</button></div>}
        {loading && !projects.length ? <div className="empty-state"><div className="spinner" /><p>불러오는 중…</p></div> : !session ? <div className="empty-state">
          <h1>{project ? '세션 선택' : '프로젝트 없음'}</h1>
          <button className="button primary" onClick={() => openDialog(project ? 'session' : 'project')}><Plus size={17} />{project ? '새 세션 열기' : '프로젝트 추가'}</button>
        </div> : <>
          <div className="terminal-stage">
            <Suspense fallback={<div className="terminal-ended"><div className="spinner" /><p>터미널 연결 중…</p></div>}><TerminalCache key={projectId} ref={terminal} token={token} sessionId={session.id} runningIds={projectSessions.filter(s => s.status === 'running').map(s => s.id)} enabled={attached} revision={revision} onConnection={setConnection} fontSize={fontSize} onUnauthorized={logout} /></Suspense>
            {session.status === 'running' ? null : session.status === 'unreachable' ? <div className="terminal-ended"><Server size={30} /><h2>SSH 서버 연결 실패</h2><button className="button secondary" onClick={() => void refresh()}><RefreshCw size={16} />다시 확인</button></div> : <div className="terminal-ended"><TerminalSquare size={30} /><h2>세션 종료됨</h2><button className="button primary" onClick={() => openDialog('session')}><Plus size={16} />새 세션</button></div>}
            {session.status === 'running' && ['disconnected', 'taken', 'ended'].includes(connection) && <div className="connection-overlay"><div><Unplug size={27} /><h2>{connection === 'taken' ? '다른 기기에서 접속 중' : '연결 끊김'}</h2><p>세션 실행 중</p><button className="button primary" onClick={() => { setAttached(true); setRevision(r => r + 1); }}><RefreshCw size={16} />다시 연결</button></div></div>}
          </div>
          {session.status === 'running' && <TerminalControls key={session.id} enabled={canInput} terminal={terminal} onPaste={() => openDialog('paste')} />}
        </>}
      </main>
    </div>
    {notice && <div className="toast" role="alert"><CircleAlert size={16} />{notice}<button className="icon-button" aria-label="알림 닫기" onClick={() => setNotice('')}><X size={14} /></button></div>}
    {dialog === 'hosts' && <HostManager token={token} hosts={hosts} projects={projects} onChanged={() => void refresh()} onClose={() => setDialog(null)} />}
    {dialog === 'project' && <ProjectDialog token={token} hosts={hosts} onHostAdded={host => setHosts(current => current.some(row => row.id === host.id) ? current : [...current, host])} busy={busy} error={formError} onClose={() => setDialog(null)} onSubmit={submitProject} />}
    {dialog === 'session' && <Modal title="새 세션" onClose={() => !busy && setDialog(null)}><form onSubmit={submitSession}><p className="dialog-description"><Folder size={15} />{project?.name}</p><label htmlFor="session-name">세션 이름</label><input id="session-name" name="name" defaultValue={`작업 ${projectSessions.length + 1}`} maxLength={100} required autoFocus /><p className="field-note path-note">{project?.path}</p>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-actions"><button className="button secondary" type="button" onClick={() => setDialog(null)} disabled={busy}>취소</button><button className="button primary" disabled={busy}><TerminalSquare size={16} />{busy ? '여는 중…' : '세션 열기'}</button></div></form></Modal>}
    {dialog === 'stop' && <Modal title="세션 종료" onClose={() => !busy && setDialog(null)}><p className="dialog-description">‘{session?.name}’에서 실행 중인 프로그램도 종료됩니다.</p>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-actions"><button className="button secondary" onClick={() => setDialog(null)} disabled={busy}>취소</button><button className="button danger" onClick={() => void stopSession()} disabled={busy}><Power size={16} />세션 종료</button></div></Modal>}
    {dialog === 'delete-project' && <Modal title="프로젝트 삭제" onClose={() => !busy && setDialog(null)}><p className="dialog-description">서버의 폴더와 파일은 삭제하지 않습니다.</p>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-actions"><button className="button secondary" onClick={() => setDialog(null)}>취소</button><button className="button danger" disabled={busy} onClick={() => void removeProject()}>목록에서 삭제</button></div></Modal>}
    {dialog === 'paste' && <Modal title="터미널에 붙여넣기" onClose={() => setDialog(null)}><form onSubmit={e => { e.preventDefault(); terminal.current?.paste(String(new FormData(e.currentTarget).get('text') ?? '')); setDialog(null); }}><textarea aria-label="붙여넣을 텍스트" name="text" className="paste-area" rows={7} required autoFocus /><div className="dialog-actions"><button className="button secondary" type="button" onClick={() => setDialog(null)}>취소</button><button className="button primary">터미널로 보내기</button></div></form></Modal>}
    {dialog === 'help' && <Modal title="사용 안내" onClose={() => setDialog(null)}><dl className="help-items">
      <div><dt>연결 끊기</dt><dd>접속만 해제. 세션은 서버에서 계속 실행.</dd></div>
      <div><dt>세션 종료</dt><dd>실행 중인 프로그램까지 종료.</dd></div>
      <div><dt>기기 전환</dt><dd>같은 세션을 열면 이전 기기의 접속 해제.</dd></div>
      <div><dt>입력창</dt><dd>보내기·입력창 Enter는 내용만 전송. 실행은 하단 Enter. Shift+Enter로 줄바꿈.</dd></div>
      <div><dt>스크롤</dt><dd>터미널 스와이프. Esc로 입력 복귀. ‘기록’에서 출력 복사.</dd></div>
      <div><dt>글씨 크기</dt><dd>상단 더 보기 메뉴에서 조절.</dd></div>
      <div><dt>주소창 숨기기</dt><dd>{screen.available ? '상단 더 보기 → 전체 화면.' : 'iPhone: 브라우저 공유 → 홈 화면에 추가. 추가한 아이콘으로 실행.'}</dd></div>
    </dl></Modal>}
    {historyOpen && <Modal title="출력 기록" className="history-dialog" onClose={() => { setHistoryOpen(false); historyGeneration.current++; }}><div className="history-caption"><span>최근 출력 · 읽기 전용</span><button className="text-button" disabled={historyBusy} onClick={() => void showHistory()}><RefreshCw size={14} />새로고침</button></div>{historyError ? <p className="form-error" role="alert">{historyError}</p> : <pre className="history-content" tabIndex={0}>{historyBusy ? '기록을 불러오는 중…' : history || '출력 기록 없음'}</pre>}</Modal>}
  </div>;
}
