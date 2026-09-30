import { useEffect, useRef } from 'react';
import { CircleHelp, History, LogOut, Maximize, Minimize, Minus, MoreHorizontal, Plus, RefreshCw, Server, Square, Trash2, Unplug } from 'lucide-react';
import type { Project, Session } from './api';
import { FONT_SIZE } from './terminalSettings';

interface Props {
  project?: Project; session?: Session; hostName: string; status: string;
  live: boolean; online: boolean; sidebar: boolean; historyOpen: boolean; fontSize: number;
  canDeleteProject: boolean; canDisconnect: boolean;
  fullscreenAvailable: boolean; fullscreen: boolean; onFullscreen: () => void;
  onSidebar: () => void; onHistory: () => void; onFontSize: (size: number) => void;
  onConnection: () => void; onNewSession: () => void; onStop: () => void;
  onDeleteProject: () => void; onHosts: () => void; onHelp: () => void; onLogout: () => void;
}

export function WorkspaceHeader(props: Props) {
  const menu = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const close = (restoreFocus = false) => {
    if (menu.current) menu.current.open = false;
    if (restoreFocus) trigger.current?.focus();
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menu.current?.open && !menu.current.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menu.current?.open) { event.preventDefault(); close(true); }
    };
    const focus = (event: FocusEvent) => {
      if (menu.current?.open && !menu.current.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    document.addEventListener('focusin', focus);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('focusin', focus);
    };
  }, []);
  const act = (action: () => void) => () => { close(true); action(); };
  const status = props.online ? props.status : 'Checking connection';
  return <header className="workspace-header">
    <a className="workspace-brand" href="/" aria-label="Jelly Home"><img src="/jelly.svg" alt="" /><span>jelly<span className="brand-period">.</span></span></a>
    <button className={`header-action workspace-switcher ${props.sidebar ? 'active' : ''}`} aria-label="Open projects and sessions" title="Jelly · Projects and sessions" aria-expanded={props.sidebar} aria-controls="workspace-sidebar" onClick={props.onSidebar}><img src="/jelly.svg" alt="Jelly" width={30} height={30} /></button>
    <div className="workspace-heading">
      <div className="workspace-location"><span title={props.project?.name}>{props.project?.name ?? 'Jelly'}</span>{props.project?.hostId && <span className="workspace-host" title={props.hostName}><Server size={10} />{props.hostName}</span>}</div>
      <div className="workspace-current"><strong title={props.session?.name}>{props.session?.name ?? (props.project ? 'Select a session' : 'Projects')}</strong><span className={`connection-label ${props.live && props.online ? 'live' : ''}`} role="status" aria-label={status} title={status}>{status}</span></div>
    </div>
    <div className="workspace-actions">
      {props.session && <>
        <button className={`header-action history-action ${props.historyOpen ? 'active' : ''}`} onClick={props.onHistory} disabled={['stopped', 'lost', 'unreachable'].includes(props.session.status)} title="Output history" aria-label="History"><History size={19} /><span>History</span></button>
      </>}
      <details className="workspace-menu" ref={menu}>
        <summary className="header-action" aria-label="More" title="More" role="button" ref={trigger}><MoreHorizontal size={22} /></summary>
        <div className="workspace-menu-panel" role="region" aria-label="Session menu">
          <div className="workspace-menu-context">
            <span><Server size={13} />{props.hostName}<i className={`dot ${props.online ? '' : 'dim'}`} title={props.online ? 'Server connected' : 'Checking connection'} /></span>
            <strong>{props.project?.name ?? 'Jelly'}</strong>
            {props.session && <span className="menu-session-name">{props.session.name}</span>}
            {props.project && <code>{props.project.path}</code>}
          </div>
          <div className="terminal-font-setting" role="group" aria-label="Terminal font size">
            <div><span>Font size</span><button className="font-reset" onClick={() => props.onFontSize(FONT_SIZE.default)} disabled={props.fontSize === FONT_SIZE.default} aria-label="Reset font size">Default</button></div>
            <div className="font-stepper"><button aria-label="Decrease font size" disabled={props.fontSize <= FONT_SIZE.min} onClick={() => props.onFontSize(props.fontSize - 1)}><Minus size={16} /></button><output aria-label="Current font size">{props.fontSize}<small>px</small></output><button aria-label="Increase font size" disabled={props.fontSize >= FONT_SIZE.max} onClick={() => props.onFontSize(props.fontSize + 1)}><Plus size={16} /></button></div>
          </div>
          {props.project && <div className="workspace-menu-group">
            <button onClick={act(props.onNewSession)}><Plus size={17} /><span>New session</span></button>
            {(props.session?.status === 'running' || (props.session?.status === 'unreachable' && props.live)) && <>
              <button aria-label={props.canDisconnect ? 'Disconnect' : 'Reconnect'} onClick={act(props.onConnection)}>{props.canDisconnect ? <Unplug size={17} /> : <RefreshCw size={17} />}<span>{props.canDisconnect ? 'Disconnect' : 'Reconnect'}</span></button>
              <button className="menu-danger" onClick={act(props.onStop)}><Square size={15} /><span>Stop session</span></button>
            </>}
            {props.canDeleteProject && <button className="menu-danger" onClick={act(props.onDeleteProject)}><Trash2 size={17} /><span>Remove project</span></button>}
          </div>}
          <div className="workspace-menu-group">
            {props.fullscreenAvailable && <button onClick={act(props.onFullscreen)}>{props.fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}<span>{props.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</span></button>}
            <button onClick={act(props.onHosts)}><Server size={17} /><span>Manage SSH hosts</span></button>
            <button onClick={act(props.onHelp)}><CircleHelp size={17} /><span>Help</span></button>
            <button onClick={act(props.onLogout)}><LogOut size={17} /><span>Log out</span></button>
          </div>
        </div>
      </details>
    </div>
  </header>;
}
