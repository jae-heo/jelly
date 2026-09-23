import { useEffect, useState } from 'react';
import { Check, Plus, RefreshCw, Server, Trash2 } from 'lucide-react';
import { api, errorMessage, type Host, type Project } from './api';
import { Modal } from './Modal';

export function useAliases(token: string) {
  const [aliases, setAliases] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void api<{ aliases: string[] }>(token, '/ssh/aliases', 'GET', undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) setAliases(result.aliases); })
      .catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)); });
    return () => controller.abort();
  }, [token, revision]);
  return { aliases, error, reload: () => setRevision(n => n + 1) };
}

export function HostForm({ token, aliases, initialTarget = '', onAdded, onCancel }: { token: string; aliases: string[]; initialTarget?: string; onAdded: (host: Host) => void; onCancel: () => void }) {
  const [name, setName] = useState(initialTarget);
  const [target, setTarget] = useState(initialTarget);
  const [port, setPort] = useState('');
  const [identityFile, setIdentityFile] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState('');
  const input = { name: name.trim() || target.trim(), target: target.trim(), port: port ? Number(port) : null, identityFile: identityFile.trim() || null };
  const signature = JSON.stringify(input);
  async function check() {
    setBusy(true); setError('');
    try { await api(token, '/hosts/check', 'POST', input); setChecked(signature); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <form onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { onAdded(await api<Host>(token, '/hosts', 'POST', input)); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }}>
    <p className="dialog-description">줼리 서버의 SSH 키·설정 사용</p>
    <label htmlFor="host-name">서버 이름</label><input id="host-name" value={name} onChange={e => setName(e.target.value)} placeholder="개발 서버" maxLength={100} autoFocus />
    <label htmlFor="host-target">SSH 접속 대상</label><input id="host-target" value={target} onChange={e => setTarget(e.target.value)} list="ssh-aliases" placeholder="my-server 또는 user@host" pattern="[a-zA-Z0-9_][a-zA-Z0-9_.:@\-]{0,254}" required autoCapitalize="off" autoComplete="off" spellCheck={false} />
    <datalist id="ssh-aliases">{aliases.map(alias => <option key={alias} value={alias} />)}</datalist>
    <details className="host-advanced"><summary>포트·키 파일 직접 지정</summary><label htmlFor="host-port">SSH 포트</label><input id="host-port" type="number" min={1} max={65535} value={port} onChange={e => setPort(e.target.value)} placeholder="SSH 설정 사용 (기본 22)" /><label htmlFor="host-identity">줼리 서버의 키 파일 경로</label><input id="host-identity" value={identityFile} onChange={e => setIdentityFile(e.target.value)} placeholder="~/.ssh/id_ed25519" autoCapitalize="off" spellCheck={false} /></details>
    <p className="field-note">대상 서버: SSH 키 인증 · tmux 3.2 이상</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {checked === signature && <p className="host-success" role="status"><Check size={15} />SSH·tmux 연결 확인 완료</p>}
    <div className="host-form-actions"><button type="button" className="text-button" disabled={busy || !target} onClick={() => void check()}><RefreshCw size={14} />연결 확인</button><div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onCancel}>돌아가기</button><button className="button primary" disabled={busy}>{busy ? '처리 중…' : '서버 추가'}</button></div></div>
  </form>;
}

export function HostManager({ token, hosts, projects, onChanged, onClose }: { token: string; hosts: Host[]; projects: Project[]; onChanged: () => void; onClose: () => void }) {
  const { aliases, error: aliasesError, reload } = useAliases(token);
  const [adding, setAdding] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filter, setFilter] = useState('');
  async function check(host: Host) {
    setBusy(host.id); setError(''); setSuccess('');
    try { await api(token, `/hosts/${host.id}/check`, 'POST'); setSuccess(host.id); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(''); }
  }
  return <Modal title={adding === null ? 'SSH 서버' : 'SSH 서버 추가'} className="hosts-dialog" onClose={() => adding === null ? onClose() : setAdding(null)}>
    {adding !== null ? <HostForm token={token} aliases={aliases} initialTarget={adding} onCancel={() => setAdding(null)} onAdded={() => { onChanged(); setAdding(null); }} /> : <>
      {!!hosts.length && <div className="hosts-list">{hosts.map(host => <div className="host-row" key={host.id}><Server size={19} /><span><strong>{host.target}</strong>{host.port && <small>포트 {host.port}</small>}</span><button className="icon-button" aria-label={`${host.target} 연결 확인`} title="연결 확인" disabled={!!busy} onClick={() => void check(host)}>{success === host.id ? <Check size={17} /> : <RefreshCw size={17} />}</button><button className="icon-button" aria-label={`${host.target} 서버 삭제`} title={projects.some(p => p.hostId === host.id) ? '프로젝트가 등록된 서버' : '등록 삭제'} disabled={!!busy || projects.some(p => p.hostId === host.id)} onClick={async () => { setBusy(host.id); setError(''); try { await api(token, `/hosts/${host.id}`, 'DELETE'); onChanged(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(''); } }}><Trash2 size={16} /></button></div>)}</div>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="host-alias-heading"><label htmlFor="alias-search">SSH 별칭 · {aliases.length}</label><button className="text-button" onClick={reload} aria-label="SSH 별칭 새로고침"><RefreshCw size={14} /></button></div>
      <input id="alias-search" type="search" placeholder="별칭 검색" value={filter} onChange={e => setFilter(e.target.value)} />
      {aliasesError && <p className="form-error" role="alert">{aliasesError}</p>}
      <div className="host-alias-list">{aliases.filter(alias => alias.toLowerCase().includes(filter.toLowerCase())).map(alias => <button className="host-alias" key={alias} onClick={() => setAdding(alias)}><Server size={15} /><span>{alias}</span><Plus size={14} /></button>)}</div>
      {!aliases.length && <p className="field-note">SSH 별칭 없음</p>}
      <p className="field-note">별칭 출처: 줼리 서버의 ~/.ssh/config 및 Include</p>
      <div className="dialog-actions"><button className="button primary" onClick={() => setAdding('')}><Plus size={16} />SSH 서버 추가</button></div>
    </>}
  </Modal>;
}
