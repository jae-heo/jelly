import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, Code, Download, File, Folder, Search } from 'lucide-react';
import { api, ApiError, errorMessage, type Project } from './api';
import { Modal } from './Modal';
import { Markdown } from './ChatMarkdown';

interface Entry { name: string; path: string; kind: 'directory' | 'file' }
interface Listing { path: string; parent: string | null; entries: Entry[]; truncated: boolean }
type Preview = { kind: 'text'; text: string } | { kind: 'image' | 'pdf' | 'page'; url: string };
// Markdown and HTML open rendered; Source shows the text.
const rendered = (name: string) => /\.(md|markdown|mdx)$/i.test(name) ? 'markdown' : /\.html?$/i.test(name) ? 'html' : null;
const fileError = (error: unknown) => error instanceof ApiError && [400, 403, 404, 413, 415, 429].includes(error.status) ? error.message : errorMessage(error);

export function ProjectFiles({ token, project, initialPath = '', onClose }: { token: string; project: Project; initialPath?: string; onClose: () => void }) {
  // A file link opens its folder, then the file itself once the folder lists it.
  const [target, setTarget] = useState({ path: initialPath.split('/').slice(0, -1).join('/'), hidden: initialPath.split('/').some(part => part.startsWith('.')) });
  const reveal = useRef(initialPath.split('/').at(-1) ?? '');
  const [listing, setListing] = useState<Listing | null>(null);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [source, setSource] = useState(false);
  const format = selected && !source ? rendered(selected.name) : null;
  const lifetime = useRef<AbortController | null>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setPreview(null);
    let objectURL: string | undefined;
    let moved = false;
    async function load() {
      try {
        if (!selected) {
          const name = reveal.current; reveal.current = '';
          const query = new URLSearchParams({ path: target.path, hidden: String(target.hidden) });
          const result = await api<Listing>(token, `/projects/${project.id}/files?${query}`, 'GET', undefined, controller.signal);
          if (controller.signal.aborted) return;
          setListing(result); setFilter('');
          // A long folder may not list the file; its preview then says whether it exists.
          const entry = result.entries.find(entry => entry.name === name) ?? (name && { name, path: initialPath, kind: 'file' as const });
          if (entry) { moved = true; return entry.kind === 'directory' ? navigate(entry.path) : open(entry); }
        } else if (format === 'html') {
          const grant = await api<{ url: string }>(token, `/projects/${project.id}/views`, 'POST', { path: selected.path }, controller.signal);
          if (!controller.signal.aborted) setPreview({ kind: 'page', url: grant.url });
        } else {
          const response = await fetch(`/api/projects/${project.id}/preview?${new URLSearchParams({ path: selected.path })}`, {
            headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]), redirect: 'error',
          });
          if (!response.ok) throw new ApiError(response.status, (await response.json()).error);
          const kind = response.headers.get('X-Jelly-Preview');
          if (kind === 'text') {
            const text = await response.text();
            if (!controller.signal.aborted) setPreview({ kind, text });
          } else if (kind === 'image' || kind === 'pdf') {
            const blob = await response.blob();
            if (!controller.signal.aborted) { objectURL = URL.createObjectURL(blob); setPreview({ kind, url: objectURL }); }
          } else throw new Error('Invalid preview');
        }
        content.current?.scrollTo(0, 0);
      } catch (error) { if (!controller.signal.aborted) setError(fileError(error)); }
      finally { if (!controller.signal.aborted && !moved) setLoading(false); }
    }
    void load();
    return () => { controller.abort(); if (objectURL) URL.revokeObjectURL(objectURL); };
  }, [token, project.id, target, selected, format === 'html']);
  const navigate = (path: string) => { setLoading(true); setSelected(null); setTarget(current => ({ ...current, path })); };
  const open = (entry: Entry) => { setLoading(true); setSource(false); setSelected(entry); };
  const download = async () => {
    if (!selected || downloading) return;
    setDownloading(true); setError('');
    try {
      const grant = await api<{ url: string; name: string }>(token, `/projects/${project.id}/downloads`, 'POST', { path: selected.path }, lifetime.current?.signal);
      if (lifetime.current?.signal.aborted) return;
      const link = document.createElement('a');
      link.href = grant.url; link.download = grant.name; link.rel = 'noreferrer';
      document.body.append(link); link.click(); link.remove();
    } catch (error) { if (!lifetime.current?.signal.aborted) setError(fileError(error)); }
    finally { if (!lifetime.current?.signal.aborted) setDownloading(false); }
  };
  const visible = listing?.entries.filter(entry => entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())) ?? [];
  return <Modal title="Files" className="files-dialog" onClose={onClose}>
    <div className="files-toolbar">
      {selected ? <button className="button secondary" onClick={() => { setLoading(true); setSelected(null); }}><ArrowLeft size={15} />Back</button>
        : <button className="button secondary" disabled={loading || listing?.parent == null} onClick={() => listing?.parent != null && navigate(listing.parent)}><ArrowUp size={15} />Parent</button>}
      <span className="files-location" title={selected?.path ?? listing?.path}>{project.name}{(selected?.path ?? listing?.path) ? ' / ' + (selected?.path ?? listing?.path) : ''}</span>
      {selected && rendered(selected.name) && <button className="button secondary" aria-label="Source" title="Source" aria-pressed={source} disabled={loading} onClick={() => { if (rendered(selected.name) === 'html') setLoading(true); setSource(!source); }}><Code size={15} /><span className="files-button-label">Source</span></button>}
      {selected ? <button className="button secondary" disabled={downloading} onClick={() => void download()}><Download size={15} />{downloading ? 'Preparing…' : 'Download'}</button>
        : <label className="checkbox"><input type="checkbox" checked={target.hidden} disabled={loading} onChange={event => setTarget(current => ({ ...current, hidden: event.target.checked }))} />Hidden files</label>}
    </div>
    {!selected && <div className="directory-search"><Search size={15} /><input type="search" aria-label="Search files" placeholder="Search this folder" value={filter} disabled={loading} onChange={event => setFilter(event.target.value)} /></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div ref={content} className={`files-content ${selected ? 'file-preview' : 'directory-list'}`} role="region" aria-label={selected ? 'File preview' : 'Project files'} aria-busy={loading}>
      {loading ? <div className="directory-empty" role="status"><div className="spinner" />Loading…</div> : selected ? <>
        {preview?.kind === 'text' && (format === 'markdown' ? <div className="file-markdown markdown"><Markdown text={preview.text} /></div> : <pre>{preview.text}</pre>)}
        {preview?.kind === 'page' && <iframe title={selected.name} src={preview.url} sandbox="allow-scripts" referrerPolicy="no-referrer" />}
        {preview?.kind === 'image' && <img src={preview.url} alt={selected.name} onError={() => setError('Image could not be displayed. Download it instead.')} />}
        {preview?.kind === 'pdf' && <iframe title={selected.name} src={preview.url} />}
      </> : visible.length ? <ul>{visible.map(entry => <li key={entry.path}><button className="directory-entry" title={entry.name} onClick={() => entry.kind === 'directory' ? navigate(entry.path) : open(entry)}>{entry.kind === 'directory' ? <Folder size={19} /> : <File size={19} />}<span>{entry.name}</span></button></li>)}</ul> : <div className="directory-empty">{filter ? 'No results' : 'No files'}</div>}
    </div>
    {!selected && listing?.truncated && <p className="field-note">Showing the first 1,000 entries.</p>}
  </Modal>;
}
