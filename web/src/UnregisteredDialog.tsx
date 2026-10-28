import { useState } from 'react';
import { Plus, Power } from 'lucide-react';
import { Modal } from './Modal';
import { api, errorMessage, type Project, type Session, type Unregistered } from './api';

// Prefer the project whose folder contains the shell's start directory.
function matchingProject(projects: Project[], path: string | null): Project | undefined {
  const containing = path ? projects.filter(p => path === p.path || path.startsWith(p.path.replace(/\/$/, '') + '/')) : [];
  return containing.sort((a, b) => b.path.length - a.path.length)[0] ?? projects[0];
}

export function UnregisteredDialog({ token, target, projects, hostName, defaultName, onAdopted, onStopped, onClose }: {
  token: string; target: Unregistered; projects: Project[]; hostName: string; defaultName: (projectId: string) => string;
  onAdopted: (session: Session) => Promise<void>; onStopped: () => Promise<void>; onClose: () => void;
}) {
  const candidates = projects.filter(p => p.hostId === target.hostId);
  const [projectId, setProjectId] = useState(() => matchingProject(candidates, target.path)?.id ?? '');
  const [name, setName] = useState(() => projectId ? defaultName(projectId) : '');
  const [edited, setEdited] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => { if (!busy) onClose(); };
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); onClose(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  const adopt = () => run(async () => {
    await onAdopted(await api<Session>(token, `/unregistered-sessions/${target.id}/adopt`, 'POST', { projectId, name: name.trim() }));
  });
  const stop = () => run(async () => {
    await api(token, `/unregistered-sessions/${target.id}/stop`, 'POST', { hostId: target.hostId });
    await onStopped();
  });
  const started = target.createdAt ? ` · Started ${new Date(target.createdAt).toLocaleString()}` : '';
  const details = <p className="field-note path-note dialog-path">{target.path ?? 'Unknown folder'}</p>;

  if (confirmStop) return <Modal title="Stop session" onClose={close}>
    <p className="dialog-description">This unregistered session and its running programs will stop.</p>
    {details}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="dialog-actions">
      <button className="button secondary" onClick={() => { setConfirmStop(false); setError(''); }} disabled={busy}>Cancel</button>
      <button className="button danger" onClick={() => void stop()} disabled={busy}><Power size={16} />{busy ? 'Stopping…' : 'Stop session'}</button>
    </div>
  </Modal>;
  return <Modal title="Unregistered session" onClose={close}>
    <form onSubmit={event => { event.preventDefault(); if (projectId && name.trim()) void adopt(); }}>
      <p className="dialog-description">{target.status === 'running' ? 'Running' : 'Ended'} on {hostName}{started}</p>
      {details}
      {candidates.length ? <>
        <label htmlFor="unregistered-project">Project</label>
        <select id="unregistered-project" value={projectId} disabled={busy} onChange={event => {
          setProjectId(event.target.value);
          if (!edited) setName(defaultName(event.target.value));
        }}>{candidates.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <label htmlFor="unregistered-name">Session name</label>
        <input id="unregistered-name" value={name} maxLength={100} required disabled={busy}
          onChange={event => { setName(event.target.value); setEdited(true); }} />
      </> : <p className="field-note">Add a project on {hostName} to keep this session.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="button secondary" type="button" onClick={() => { setConfirmStop(true); setError(''); }} disabled={busy}><Power size={16} />Stop</button>
        <button className="button primary" disabled={busy || !projectId || !name.trim()}><Plus size={16} />{busy ? 'Adding…' : 'Add to project'}</button>
      </div>
    </form>
  </Modal>;
}
