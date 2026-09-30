import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronRight, Folder, FolderOpen, Home, Search } from 'lucide-react';
import { api, ApiError, errorMessage } from './api';

interface DirectoryListing {
  path: string; parent: string | null; home: string;
  directories: { name: string; path: string }[]; truncated: boolean;
}
interface Props { token: string; initialPath: string; hostId?: string; hostName?: string; onSelect: (path: string) => void; onCancel: () => void }

export function DirectoryPicker({ token, initialPath, hostId, hostName, onSelect, onCancel }: Props) {
  const [target, setTarget] = useState({ path: initialPath, hidden: false });
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState(initialPath);
  const crumbs = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const query = new URLSearchParams({ hidden: String(target.hidden) });
    if (target.path) query.set('path', target.path);
    if (hostId) query.set('hostId', hostId);
    void api<DirectoryListing>(token, `/directories?${query}`, 'GET', undefined, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        setListing(result); setPathInput(result.path); setFilter(''); setEditingPath(false);
        list.current?.scrollTo(0, 0);
      }).catch(error => {
        if (controller.signal.aborted) return;
        setError(error instanceof ApiError && error.status === 403 ? 'Permission denied for this folder.'
          : error instanceof ApiError && error.status === 404 ? 'Folder not found. Check the path.'
          : error instanceof ApiError && error.status === 400 ? 'Enter an absolute folder path.'
          : errorMessage(error));
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, target, hostId]);
  useEffect(() => { if (crumbs.current) crumbs.current.scrollLeft = crumbs.current.scrollWidth; }, [listing?.path]);

  function navigate(path: string) { setLoading(true); setTarget(current => ({ ...current, path })); }
  const segments = listing?.path.split('/').filter(Boolean) ?? [];
  const visible = listing?.directories.filter(entry => entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())) ?? [];

  return <div className="directory-picker">
    {hostName && <p className="dialog-description">{hostName}</p>}
    <div className="directory-toolbar">
      <button type="button" className="button secondary" onClick={() => navigate(listing?.home ?? '')} disabled={loading} autoFocus><Home size={15} />Home</button>
      <button type="button" className="button secondary" onClick={() => listing?.parent && navigate(listing.parent)} disabled={loading || !listing?.parent}><ArrowUp size={15} />Parent</button>
      <label className="checkbox"><input type="checkbox" checked={target.hidden} disabled={loading} onChange={e => { setLoading(true); setTarget({ path: listing?.path ?? target.path, hidden: e.target.checked }); }} />Hidden folders</label>
    </div>
    <div className="directory-location">
      <nav className="directory-crumbs" aria-label="Current folder path" ref={crumbs}>
        {listing ? <><button type="button" disabled={loading} onClick={() => navigate('/')} aria-label="Server root">/</button>{segments.map((name, i) => {
          const path = '/' + segments.slice(0, i + 1).join('/');
          return <span key={path}><ChevronRight size={12} /><button type="button" title={path} aria-current={i === segments.length - 1 ? 'location' : undefined} disabled={loading} onClick={() => navigate(path)}>{name}</button></span>;
        })}</> : <span>Server folders</span>}
      </nav>
      <button type="button" className="text-button" aria-expanded={editingPath} onClick={() => setEditingPath(!editingPath)}>Enter path</button>
    </div>
    {editingPath && <div className="directory-jump"><input aria-label="Folder path" value={pathInput} onChange={e => setPathInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); if (!loading && pathInput) navigate(pathInput); } }} placeholder="/home/user/projects" autoComplete="off" spellCheck={false} autoCapitalize="off" /><button type="button" className="button secondary" disabled={loading || !pathInput} onClick={() => navigate(pathInput)}>Go</button></div>}
    <div className="directory-search"><Search size={15} /><input type="search" aria-label="Search folders" placeholder="Search this folder" value={filter} disabled={loading} onChange={e => setFilter(e.target.value)} autoComplete="off" spellCheck={false} /></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="directory-list" ref={list} role="region" aria-label="Server folders" aria-busy={loading}>
      {loading ? <div className="directory-empty" role="status"><div className="spinner" />Loading folders…</div> : visible.length ? <ul>{visible.map(entry => <li key={entry.path}><button type="button" className="directory-entry" onClick={() => navigate(entry.path)} title={entry.name}><Folder size={19} /><span>{entry.name}</span><ChevronRight size={16} /></button></li>)}</ul> : <div className="directory-empty"><FolderOpen size={27} /><p>{!listing ? 'Choose a folder.' : filter ? 'No results' : 'No subfolders'}</p></div>}
    </div>
    {listing?.truncated && <p className="field-note">Only some folders are shown. Use Enter path to open a folder directly.</p>}
    <div className="directory-selection"><FolderOpen size={16} /><span>Selected folder<strong>{listing?.path ?? 'None selected'}</strong></span></div>
    <div className="dialog-actions"><button type="button" className="button secondary" onClick={onCancel}>Back</button><button type="button" className="button primary" disabled={loading || !listing} onClick={() => listing && onSelect(listing.path)}>Select this folder</button></div>
  </div>;
}
