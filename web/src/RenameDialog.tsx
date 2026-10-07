import { useState } from 'react';
import { Modal } from './Modal';
import { errorMessage } from './api';

export function RenameDialog({ kind, name, onSave, onClose }: {
  kind: 'project' | 'session'; name: string; onSave: (name: string) => Promise<void>; onClose: () => void;
}) {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => { if (!busy) onClose(); };
  return <Modal title={`Rename ${kind}`} onClose={close}>
    <form onSubmit={async event => {
      event.preventDefault();
      if (busy || !value.trim()) return;
      setBusy(true); setError('');
      try { await onSave(value.trim()); onClose(); }
      catch (error) { setError(errorMessage(error)); }
      finally { setBusy(false); }
    }}>
      <label htmlFor="rename-name">{kind === 'project' ? 'Project name' : 'Session name'}</label>
      <input id="rename-name" value={value} onChange={event => setValue(event.target.value)}
        maxLength={100} required autoFocus disabled={busy} onFocus={event => event.target.select()} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="button secondary" type="button" onClick={close} disabled={busy}>Cancel</button>
        <button className="button primary" disabled={busy || !value.trim()}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  </Modal>;
}
