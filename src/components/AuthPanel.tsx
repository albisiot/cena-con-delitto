'use client';

import { useState } from 'react';
import { api, saveAccountToken } from '@/lib/client';

type Mode = 'login' | 'register' | 'recover';

const TITLES: Record<Mode, string> = {
  login: 'Accedi',
  register: 'Crea un account',
  recover: 'Recupera l\'account',
};

/** Accesso, registrazione e recupero. `onDone` scatta quando si è dentro, dopo aver visto l'eventuale codice di recupero. */
export function AuthPanel({ onDone }: { onDone: () => void }) {
  const [recoveryCode, setRecoveryCode] = useState('');

  if (recoveryCode) {
    return (
      <div className="card warning" role="status">
        <h2>Salva il codice di recupero</h2>
        <div className="code" style={{ fontSize: 24, overflowWrap: 'anywhere' }}>{recoveryCode}</div>
        <p className="muted" style={{ marginTop: 8 }}>
          Te lo mostro solo ora: è l&apos;unico modo per entrare se dimentichi la password. Non c&apos;è nessuna email di recupero.
        </p>
        <button onClick={onDone}>L&apos;ho salvato</button>
      </div>
    );
  }
  return <AuthForm onDone={(code) => (code ? setRecoveryCode(code) : onDone())} />;
}

function AuthForm({ onDone }: { onDone: (recoveryCode?: string) => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const out = mode === 'login'
        ? await api('/api/accounts/login', { body: { username, password } })
        : mode === 'register'
          ? await api('/api/accounts', { body: { username, password } })
          : await api('/api/accounts/recover', { body: { username, recoveryCode: code, newPassword: password } });
      saveAccountToken(out.token);
      onDone(out.recoveryCode);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>{TITLES[mode]}</h2>
      {mode === 'register' && <p className="muted">Serve solo per ricordare a quali cene hai già partecipato. Non ti chiedo l&apos;email.</p>}
      <label htmlFor="username">Nome utente</label>
      <input
        id="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoCapitalize="none"
        autoComplete="username"
        required
      />
      {mode === 'recover' && (
        <>
          <label htmlFor="recovery">Codice di recupero</label>
          <input id="recovery" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" required />
        </>
      )}
      <label htmlFor="password">{mode === 'recover' ? 'Nuova password' : 'Password'}</label>
      <input
        id="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        required
      />
      {mode !== 'login' && <p className="muted" style={{ marginTop: 4 }}>Almeno 8 caratteri.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <button disabled={busy}>{TITLES[mode]}</button>
      {(Object.keys(TITLES) as Mode[]).filter((m) => m !== mode).map((m) => (
        <button type="button" className="ghost" key={m} onClick={() => { setMode(m); setError(''); }}>
          {TITLES[m]}
        </button>
      ))}
    </form>
  );
}
