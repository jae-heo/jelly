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
      <h1 id="login-title">Connect to server</h1>
      <form onSubmit={submit}>
        <label htmlFor="token">Connection key</label>
        <div className="secret-input"><KeyRound size={17} /><input id="token" type={show ? 'text' : 'password'} value={token} onChange={e => setToken(e.target.value)} placeholder="Paste connection key" autoComplete="off" spellCheck={false} required /><button type="button" className="icon-button" aria-label={show ? 'Hide connection key' : 'Show connection key'} onClick={() => setShow(!show)}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
        <label className="checkbox"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />Remember on this device</label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button primary wide" disabled={busy || !token.trim()}>{busy ? 'Connecting…' : 'Connect'}</button>
      </form>
      <details className="key-help"><summary>Find your connection key</summary><p>Run on the Jelly server</p><code>cat ~/jelly/.data/token</code></details>
    </section>
  </main>;
}
