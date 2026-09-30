import { useState, type FormEvent } from 'react';
import { FolderOpen } from 'lucide-react';
import { DirectoryPicker } from './DirectoryPicker';
import { Modal } from './Modal';
import { api, errorMessage, type Host } from './api';
import { HostForm, useAliases } from './Hosts';

interface Props { token: string; hosts: Host[]; onHostAdded: (host: Host) => void; busy: boolean; error: string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }

export function ProjectDialog({ token, hosts, onHostAdded, busy, error, onClose, onSubmit }: Props) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [hostId, setHostId] = useState('');
  const [addingHost, setAddingHost] = useState(false);
  const [changing, setChanging] = useState(false);
  const [hostError, setHostError] = useState('');
  const { aliases, error: aliasesError } = useAliases(token);
  const hostName = hosts.find(host => host.id === hostId)?.target;
  function added(host: Host) { onHostAdded(host); setHostId(host.id); setPath(''); setAddingHost(false); }
  return <Modal title={addingHost ? 'Add SSH host' : browsing ? 'Choose a server folder' : 'Add project'} className={browsing ? 'directory-dialog' : ''} onClose={() => { if (!busy && !changing) { if (addingHost) setAddingHost(false); else if (browsing) setBrowsing(false); else onClose(); } }}>
    {addingHost ? <HostForm token={token} aliases={aliases} onAdded={added} onCancel={() => setAddingHost(false)} /> : browsing ? <DirectoryPicker token={token} hostId={hostId || undefined} hostName={hostName} initialPath={path} onCancel={() => setBrowsing(false)} onSelect={selected => {
      setPath(selected); if (!name.trim()) setName((selected.split('/').pop() || 'Project').slice(0, 100)); setBrowsing(false);
    }} /> : <form onSubmit={onSubmit}>
      <div className="project-server-label"><label htmlFor="project-server">Project server</label><button type="button" className="text-button" onClick={() => setAddingHost(true)}>Add SSH host</button></div>
      <select id="project-server" name="hostId" value={hostId} disabled={busy || changing} onChange={async e => {
        const value = e.target.value; setHostError('');
        if (value.startsWith('alias:')) {
          setChanging(true);
          const target = value.slice(6);
          try { added(await api<Host>(token, '/hosts', 'POST', { name: target, target })); }
          catch (error) { setHostError(errorMessage(error)); }
          finally { setChanging(false); }
        } else { setHostId(value); setPath(''); }
      }}>
        <option value="">This server · Jelly</option>
        {!!hosts.length && <optgroup label="Registered SSH hosts">{hosts.map(host => <option key={host.id} value={host.id}>{host.target}</option>)}</optgroup>}
        {!!aliases.length && <optgroup label="SSH config aliases">{aliases.filter(alias => !hosts.some(host => host.target === alias && !host.port && !host.identityFile)).map(alias => <option key={alias} value={`alias:${alias}`}>{alias}</option>)}</optgroup>}
      </select>
      {(hostError || aliasesError) && <p className="form-error" role="alert">{hostError || aliasesError}</p>}
      <label htmlFor="project-name">Project name</label>
      <input id="project-name" name="name" placeholder="My project" maxLength={100} required autoFocus value={name} onChange={e => setName(e.target.value)} />
      <label htmlFor="project-path">Server folder path</label>
      <div className="project-folder-field"><input id="project-path" name="path" placeholder="Choose a folder or enter a path" required spellCheck={false} autoCapitalize="off" value={path} onChange={e => setPath(e.target.value)} /><button type="button" className="button secondary" onClick={() => setBrowsing(true)} disabled={busy || changing}><FolderOpen size={16} />Browse</button></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button className="button secondary" type="button" onClick={onClose} disabled={busy || changing}>Cancel</button><button className="button primary" disabled={busy || changing}>{busy ? 'Adding…' : 'Add project'}</button></div>
    </form>}
  </Modal>;
}
