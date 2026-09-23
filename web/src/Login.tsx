import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { api, errorMessage, forgetToken } from './api';

export function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [token, setToken] = useState('');
  const [remember, setRemember] = useState(false);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const clean = token.trim();
      await api(clean, '/projects');
      forgetToken();
      (remember ? localStorage : sessionStorage).setItem('jelly-token', clean);
      onLogin(clean);
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <main className="login-page">
    <header className="login-brand"><img src="/jelly.svg" alt="" /><span>jelly<span className="brand-period">.</span></span></header>
    <section className="login-card" aria-labelledby="login-title">
      <h1 id="login-title">서버 연결</h1>
      <form onSubmit={submit}>
        <label htmlFor="token">연결 키</label>
        <div className="secret-input"><KeyRound size={17} /><input id="token" type={show ? 'text' : 'password'} value={token} onChange={e => setToken(e.target.value)} placeholder="연결 키 붙여넣기" autoComplete="off" spellCheck={false} required /><button type="button" className="icon-button" aria-label={show ? '연결 키 숨기기' : '연결 키 보기'} onClick={() => setShow(!show)}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
        <label className="checkbox"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />이 기기에 연결 키 저장</label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button primary wide" disabled={busy || !token.trim()}>{busy ? '연결 중…' : '연결'}</button>
      </form>
      <details className="key-help"><summary>연결 키 확인</summary><p>줼리 서버에서 실행</p><code>cat ~/jelly/.data/token</code></details>
    </section>
  </main>;
}
