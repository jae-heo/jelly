import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { CircleAlert, Folder, Plus, Power, RefreshCw, TerminalSquare, Unplug, X, Server } from 'lucide-react';
import { api, errorMessage, forgetToken, storedToken, type Project, type Session } from './api';
import { useWorkspaceData } from './useWorkspaceData';
import { Login } from './Login';
import { Modal } from './Modal';
import { ProjectDialog } from './ProjectDialog';
import { ProjectTree } from './ProjectTree';
import { HostManager } from './Hosts';
import { WorkspaceHeader } from './WorkspaceHeader';
import { TerminalControls, type TerminalControlsHandle } from './TerminalControls';
import { FONT_SIZE_KEY, storedFontSize } from './terminalSettings';
import { useWorkspaceViewport } from './useWorkspaceViewport';
import { useFullscreen } from './useFullscreen';
import { useSessionShortcuts } from './useSessionShortcuts';
import type { Connection, TerminalHandle } from './TerminalView';
const TerminalCache = lazy(() => import('./TerminalCache').then(module => ({ default: module.TerminalCache })));

type Dialog = 'hosts' | 'project' | 'session' | 'stop' | 'paste' | 'help' | 'delete-project' | null;
const stateLabels = { running: 'Running', exited: 'Ended', stopped: 'Ended', lost: 'No sessions', unreachable: 'Server unreachable' };
const connectionLabels: Record<Connection, string> = { connecting: 'Connecting', connected: 'Connected', retrying: 'Reconnecting', disconnected: 'Disconnected', taken: 'In use on another device', ended: 'Connection ended' };

export function App() {
  const [token, setToken] = useState(storedToken);
  const [projectId, setProjectId] = useState<string | null>(() => localStorage.getItem('jelly-project'));
  const [sessionId, setSessionId] = useState<string | null>(() => localStorage.getItem('jelly-session'));
  const [sidebar, setSidebar] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [newSessionProjectId, setNewSessionProjectId] = useState<string | null>(null);
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
  const creatingSession = useRef(false);
  const selectionVersion = useRef(0);
  const currentToken = useRef(token);
  currentToken.current = token;
  const controls = useRef<TerminalControlsHandle>(null);
  const historyGeneration = useRef(0);
  const historyContent = useRef<HTMLPreElement>(null);
  const screen = useFullscreen(!!token, setNotice);

  const logout = useCallback(() => { selectionVersion.current++; currentToken.current = ''; forgetToken(); setToken(''); setSessionId(null); }, []);
  const { hosts, projects, sessions, loading, online, refresh, addSession, addHost } = useWorkspaceData(token, logout, snapshot => {
    setProjectId(current => snapshot.projects.some(p => p.id === current) ? current : snapshot.projects[0]?.id ?? null);
    setSessionId(current => snapshot.sessions.some(s => s.id === current) ? current : null);
  });
  useEffect(() => { if (projectId) localStorage.setItem('jelly-project', projectId); else localStorage.removeItem('jelly-project'); }, [projectId]);
  useEffect(() => { if (sessionId) localStorage.setItem('jelly-session', sessionId); else localStorage.removeItem('jelly-session'); }, [sessionId]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    try { localStorage.setItem(FONT_SIZE_KEY, String(fontSize)); } catch { /* Keep the in-memory preference. */ }
  }, [fontSize]);
  useEffect(() => {
    const content = historyContent.current;
    if (historyOpen && !historyBusy && !historyError && content) content.scrollTop = content.scrollHeight;
  }, [historyOpen, historyBusy, historyError, history]);
  useWorkspaceViewport(!!token);

  const project = projects.find(p => p.id === projectId);
  const session = sessions.find(s => s.id === sessionId && s.projectId === projectId);
  const projectSessions = sessions.filter(s => s.projectId === projectId);
  const newSessionProject = projects.find(p => p.id === newSessionProjectId);
  const hasTerminal = session?.status === 'running' || session?.status === 'unreachable';
  const canInput = hasTerminal && attached && connection === 'connected';
  const openDialog = (value: Dialog) => { setFormError(''); setDialog(value); };
  function openSession(p = project) {
    if (!p) return;
    setNewSessionProjectId(p.id); openDialog('session');
  }
  function chooseProject(id: string) {
    if (id === projectId) return;
    selectionVersion.current++;
    historyGeneration.current++;
    setProjectId(id); setSessionId(null); setHistoryOpen(false);
    // Leave the list open on phones so the user can choose a session next.
  }
  function chooseSession(s: Session) {
    selectionVersion.current++;
    historyGeneration.current++;
    if (s.id !== sessionId || !attached) setConnection('connecting');
    setSessionId(s.id); setProjectId(s.projectId); setSidebar(false); setAttached(true);
    setHistoryOpen(false); setHistory('');
  }
  function nextSessionName(id: string) {
    const names = new Set(sessions.filter(s => s.projectId === id).map(s => s.name));
    let number = 1;
    while (names.has(`Session ${number}`)) number++;
    return `Session ${number}`;
  }
  async function quickCreateSession(p: Project) {
    if (creatingSession.current) return;
    creatingSession.current = true;
    const version = selectionVersion.current;
    try {
      const s = await api<Session>(token, `/projects/${p.id}/sessions`, 'POST', { name: nextSessionName(p.id) });
      if (currentToken.current !== token) return;
      await refresh();
      if (currentToken.current !== token) return;
      addSession(s);
      // Respect a project/session change or logout made while creation was pending.
      if (version === selectionVersion.current) chooseSession(s);
    } catch (error) { if (currentToken.current === token) setNotice(errorMessage(error)); }
    finally { creatingSession.current = false; }
  }
  useSessionShortcuts({ enabled: !!token && !dialog && !historyOpen, projects, sessions, projectId, sessionId,
    onSelect: chooseSession, onCreate: p => { void quickCreateSession(p); } });
  async function submitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFormError('');
    const form = new FormData(event.currentTarget);
    try {
      const p = await api<Project>(token, '/projects', 'POST', { name: form.get('name'), path: form.get('path'), hostId: form.get('hostId') || null });
      await refresh(); chooseProject(p.id); setDialog(null);
    } catch (error) { setFormError(errorMessage(error)); } finally { setBusy(false); }
  }
  async function submitSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!newSessionProject || creatingSession.current) return; creatingSession.current = true; setBusy(true); setFormError('');
    const form = new FormData(event.currentTarget);
    try {
      const s = await api<Session>(token, `/projects/${newSessionProject.id}/sessions`, 'POST', { name: form.get('name') });
      await refresh(); addSession(s);
      chooseSession(s); setDialog(null);
    } catch (error) { setFormError(errorMessage(error)); } finally { creatingSession.current = false; setBusy(false); }
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
    <WorkspaceHeader project={project} session={session} hostName={hosts.find(host => host.id === project?.hostId)?.target ?? 'This server'}
      status={session ? (hasTerminal && (session.status === 'running' || connection === 'connected') ? connectionLabels[connection] : stateLabels[session.status]) : online ? 'Server connected' : 'Checking connection'}
      live={session ? canInput : online} online={online} sidebar={sidebar} fontSize={fontSize} historyOpen={historyOpen}
      fullscreenAvailable={screen.available} fullscreen={screen.fullscreen} onFullscreen={() => void screen.toggle()}
      canDeleteProject={!!project && projectSessions.length === 0} canDisconnect={attached && !['taken', 'ended'].includes(connection)}
      onSidebar={() => setSidebar(!sidebar)} onHistory={() => void showHistory()} onFontSize={setFontSize}
      onConnection={() => { if (attached && !['taken', 'ended'].includes(connection)) setAttached(false); else { setAttached(true); setRevision(r => r + 1); } }}
      onNewSession={() => openSession()} onStop={() => openDialog('stop')} onDeleteProject={() => openDialog('delete-project')}
      onHosts={() => openDialog('hosts')} onHelp={() => openDialog('help')} onLogout={logout} />
    <div className="workspace-body">
      {sidebar && <button className="sidebar-backdrop" aria-label="Close sidebar" onClick={() => setSidebar(false)} />}
      <aside id="workspace-sidebar" className={`sidebar ${sidebar ? 'open' : ''}`}>
        <div className="section-title"><span>Projects <small>{projects.length}</small></span><button className="icon-button" aria-label="Add project" onClick={() => openDialog('project')}><Plus size={18} /></button></div>
        <ProjectTree projects={projects} sessions={sessions} projectId={projectId} sessionId={session?.id ?? null}
          loading={loading} open={sidebar} onProject={chooseProject} onSession={chooseSession}
          onNewSession={openSession} onRemoveSession={s => void removeSession(s)} />
      </aside>
      <main className="main-panel">
        {!online && <div className="network-banner" role="alert">Cannot reach the server. Check your Tailscale connection.<button className="text-button" onClick={() => void refresh()}>Retry</button></div>}
        {loading && !projects.length ? <div className="empty-state"><div className="spinner" /><p>Loading…</p></div> : !session ? <div className="empty-state">
          <h1>{project ? 'Select a session' : 'No projects'}</h1>
          <button className="button primary" onClick={() => project ? openSession(project) : openDialog('project')}><Plus size={17} />{project ? 'New session' : 'Add project'}</button>
        </div> : null}
          <div className="terminal-stage" hidden={!session}>
            <Suspense fallback={<div className="terminal-ended"><div className="spinner" /><p>Connecting to terminal…</p></div>}><TerminalCache ref={terminal} token={token} sessionId={session?.id ?? null} runningIds={sessions.filter(s => s.status === 'running').map(s => s.id)} retainedIds={sessions.filter(s => s.status === 'running' || s.status === 'unreachable').map(s => s.id)} enabled={attached} revision={revision} onConnection={setConnection} fontSize={fontSize} onUnauthorized={logout} onTouchInput={() => controls.current?.focus()} /></Suspense>
            {!session || session.status === 'running' || (session.status === 'unreachable' && connection === 'connected') ? null : session.status === 'unreachable' ? <div className="terminal-ended"><Server size={30} /><h2>SSH host unreachable</h2><button className="button secondary" onClick={() => void refresh()}><RefreshCw size={16} />Check again</button></div> : <div className="terminal-ended"><TerminalSquare size={30} /><h2>Session ended</h2><button className="button primary" onClick={() => openSession()}><Plus size={16} />New session</button></div>}
            {session?.status === 'running' && ['disconnected', 'taken', 'ended'].includes(connection) && <div className="connection-overlay"><div><Unplug size={27} /><h2>{connection === 'taken' ? 'In use on another device' : 'Disconnected'}</h2><p>Session running</p><button className="button primary" onClick={() => { setAttached(true); setRevision(r => r + 1); }}><RefreshCw size={16} />Reconnect</button></div></div>}
          </div>
          {session && hasTerminal && <TerminalControls key={session.id} ref={controls} enabled={canInput} terminal={terminal} onPaste={() => openDialog('paste')} />}
      </main>
    </div>
    {notice && <div className="toast" role="alert"><CircleAlert size={16} />{notice}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={14} /></button></div>}
    {dialog === 'hosts' && <HostManager token={token} hosts={hosts} projects={projects} onChanged={() => void refresh()} onClose={() => setDialog(null)} />}
    {dialog === 'project' && <ProjectDialog token={token} hosts={hosts} onHostAdded={addHost} busy={busy} error={formError} onClose={() => setDialog(null)} onSubmit={submitProject} />}
    {dialog === 'session' && <Modal title="New session" onClose={() => !busy && setDialog(null)}><form onSubmit={submitSession}><p className="dialog-description"><Folder size={15} />{newSessionProject?.name}</p><label htmlFor="session-name">Session name</label><input id="session-name" name="name" defaultValue={newSessionProjectId ? nextSessionName(newSessionProjectId) : 'Session 1'} maxLength={100} required autoFocus /><p className="field-note path-note">{newSessionProject?.path}</p>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-actions"><button className="button secondary" type="button" onClick={() => setDialog(null)} disabled={busy}>Cancel</button><button className="button primary" disabled={busy}><TerminalSquare size={16} />{busy ? 'Opening…' : 'Open session'}</button></div></form></Modal>}
    {dialog === 'stop' && <Modal title="Stop session" onClose={() => !busy && setDialog(null)}><p className="dialog-description">‘{session?.name}’ and its running programs will stop.</p>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-actions"><button className="button secondary" onClick={() => setDialog(null)} disabled={busy}>Cancel</button><button className="button danger" onClick={() => void stopSession()} disabled={busy}><Power size={16} />Stop session</button></div></Modal>}
    {dialog === 'delete-project' && <Modal title="Remove project" onClose={() => !busy && setDialog(null)}><p className="dialog-description">Files and folders on the server will be kept.</p>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-actions"><button className="button secondary" onClick={() => setDialog(null)}>Cancel</button><button className="button danger" disabled={busy} onClick={() => void removeProject()}>Remove from list</button></div></Modal>}
    {dialog === 'paste' && <Modal title="Paste into terminal" onClose={() => setDialog(null)}><form onSubmit={e => { e.preventDefault(); terminal.current?.paste(String(new FormData(e.currentTarget).get('text') ?? '')); setDialog(null); }}><textarea aria-label="Text to paste" name="text" className="paste-area" rows={7} required autoFocus /><div className="dialog-actions"><button className="button secondary" type="button" onClick={() => setDialog(null)}>Cancel</button><button className="button primary">Send to terminal</button></div></form></Modal>}
    {dialog === 'help' && <Modal title="Help" onClose={() => setDialog(null)}><dl className="help-items">
      <div><dt>Disconnect</dt><dd>Disconnects this browser. The session keeps running.</dd></div>
      <div><dt>Stop session</dt><dd>Stops the shell and its running programs.</dd></div>
      <div><dt>Switch devices</dt><dd>Opening a session disconnects the previous device.</dd></div>
      <div><dt>Switch sessions</dt><dd>⌘⇧, previous · ⌘⇧. next. Cycles through sessions in project order.</dd></div>
      <div><dt>New session</dt><dd>⌘⇧Enter creates a session in the current project.</dd></div>
      <div><dt>Key combination</dt><dd>Keyboard button → select a key and modifiers → Send.</dd></div>
      <div><dt>Input</dt><dd>Sends as you type, after IME composition. Enter submits. Shift+Enter is passed to the app as a separate key.</dd></div>
      <div><dt>Draft input</dt><dd>Open with the pencil button. Send pastes the draft. Shift+Enter adds a newline. Use the terminal Enter key to submit.</dd></div>
      <div><dt>Scroll</dt><dd>Swipe the terminal to scroll. Esc returns to input. Copy output from History.</dd></div>
      <div><dt>Font size</dt><dd>Adjust in the More menu.</dd></div>
      <div><dt>Hide browser chrome</dt><dd>{screen.available ? 'More → Fullscreen.' : 'iPhone: Share → Add to Home Screen. Open Jelly from that icon.'}</dd></div>
    </dl></Modal>}
    {historyOpen && <Modal title="Output history" className="history-dialog" onClose={() => { setHistoryOpen(false); historyGeneration.current++; }}><div className="history-caption"><span>Recent output · Read-only</span><button className="text-button" disabled={historyBusy} onClick={() => void showHistory()}><RefreshCw size={14} />Refresh</button></div>{historyError ? <p className="form-error" role="alert">{historyError}</p> : <pre ref={historyContent} className="history-content" tabIndex={0}>{historyBusy ? 'Loading history…' : history || 'No output yet'}</pre>}</Modal>}
  </div>;
}
