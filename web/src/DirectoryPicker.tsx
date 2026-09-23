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
        setError(error instanceof ApiError && error.status === 403 ? '폴더 접근 권한이 없습니다.'
          : error instanceof ApiError && error.status === 404 ? '폴더를 찾을 수 없습니다. 경로를 확인하세요.'
          : error instanceof ApiError && error.status === 400 ? '폴더의 절대 경로를 입력하세요.'
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
      <button type="button" className="button secondary" onClick={() => navigate(listing?.home ?? '')} disabled={loading} autoFocus><Home size={15} />홈</button>
      <button type="button" className="button secondary" onClick={() => listing?.parent && navigate(listing.parent)} disabled={loading || !listing?.parent}><ArrowUp size={15} />상위</button>
      <label className="checkbox"><input type="checkbox" checked={target.hidden} disabled={loading} onChange={e => { setLoading(true); setTarget({ path: listing?.path ?? target.path, hidden: e.target.checked }); }} />숨김 폴더</label>
    </div>
    <div className="directory-location">
      <nav className="directory-crumbs" aria-label="현재 폴더 경로" ref={crumbs}>
        {listing ? <><button type="button" disabled={loading} onClick={() => navigate('/')} aria-label="서버 최상위 폴더">/</button>{segments.map((name, i) => {
          const path = '/' + segments.slice(0, i + 1).join('/');
          return <span key={path}><ChevronRight size={12} /><button type="button" title={path} aria-current={i === segments.length - 1 ? 'location' : undefined} disabled={loading} onClick={() => navigate(path)}>{name}</button></span>;
        })}</> : <span>서버 폴더</span>}
      </nav>
      <button type="button" className="text-button" aria-expanded={editingPath} onClick={() => setEditingPath(!editingPath)}>경로 입력</button>
    </div>
    {editingPath && <div className="directory-jump"><input aria-label="이동할 폴더 경로" value={pathInput} onChange={e => setPathInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); if (!loading && pathInput) navigate(pathInput); } }} placeholder="/home/user/projects" autoComplete="off" spellCheck={false} autoCapitalize="off" /><button type="button" className="button secondary" disabled={loading || !pathInput} onClick={() => navigate(pathInput)}>이동</button></div>}
    <div className="directory-search"><Search size={15} /><input type="search" aria-label="폴더 이름 검색" placeholder="현재 폴더에서 이름 검색" value={filter} disabled={loading} onChange={e => setFilter(e.target.value)} autoComplete="off" spellCheck={false} /></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="directory-list" ref={list} role="region" aria-label="서버 폴더 목록" aria-busy={loading}>
      {loading ? <div className="directory-empty" role="status"><div className="spinner" />폴더를 불러오는 중…</div> : visible.length ? <ul>{visible.map(entry => <li key={entry.path}><button type="button" className="directory-entry" onClick={() => navigate(entry.path)} title={entry.name}><Folder size={19} /><span>{entry.name}</span><ChevronRight size={16} /></button></li>)}</ul> : <div className="directory-empty"><FolderOpen size={27} /><p>{!listing ? '폴더를 선택하세요.' : filter ? '검색 결과 없음' : '하위 폴더 없음'}</p></div>}
    </div>
    {listing?.truncated && <p className="field-note">일부 폴더만 표시 중. ‘경로 입력’으로 직접 이동할 수 있습니다.</p>}
    <div className="directory-selection"><FolderOpen size={16} /><span>선택할 폴더<strong>{listing?.path ?? '선택 안 됨'}</strong></span></div>
    <div className="dialog-actions"><button type="button" className="button secondary" onClick={onCancel}>돌아가기</button><button type="button" className="button primary" disabled={loading || !listing} onClick={() => listing && onSelect(listing.path)}>이 폴더 선택</button></div>
  </div>;
}
