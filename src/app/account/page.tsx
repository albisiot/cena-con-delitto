'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  type Account, api, fetchAccount, forgetAccountToken, loadAccountToken, saveAccountToken,
} from '@/lib/client';

type Mode = 'login' | 'register' | 'recover';

const TITLES: Record<Mode, string> = {
  login: 'Accedi',
  register: 'Crea un account',
  recover: 'Recupera l\'account',
};

export default function AccountPage() {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [recoveryCode, setRecoveryCode] = useState('');

  const refresh = () => fetchAccount().then(setAccount);
  useEffect(() => { refresh(); }, []);

  return (
    <main className="page">
      <Link href="/">← Tutte le cene</Link>
      <h1 style={{ marginTop: 16 }}>Il tuo account</h1>
      {recoveryCode && (
        <div className="card warning" role="status">
          <h2>Salva il codice di recupero</h2>
          <div className="code" style={{ fontSize: 24, overflowWrap: 'anywhere' }}>{recoveryCode}</div>
          <p className="muted" style={{ marginTop: 8 }}>
            Te lo mostro solo ora: è l&apos;unico modo per entrare se dimentichi la password. Non c&apos;è nessuna email di recupero.
          </p>
          <button className="ghost" onClick={() => setRecoveryCode('')}>L&apos;ho salvato</button>
        </div>
      )}
      {account === undefined && <p className="muted">Carico…</p>}
      {account === null && <AuthForm onDone={(code) => { setRecoveryCode(code ?? ''); refresh(); }} />}
      {account && <Profile account={account} onLogout={() => setAccount(null)} />}
    </main>
  );
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

function Profile({ account, onLogout }: { account: Account; onLogout: () => void }) {
  return (
    <>
      <div className="card">
        <div className="eyebrow">Sei dentro come</div>
        <h2>{account.username}</h2>
        <button
          className="ghost"
          onClick={async () => {
            await api('/api/accounts/logout', { body: {}, token: loadAccountToken() }).catch(() => {});
            forgetAccountToken();
            onLogout();
          }}
        >
          Esci
        </button>
      </div>
      <div className="card">
        <h2>Cene già fatte</h2>
        {account.dinners.length === 0 && (
          <p className="muted">
            Ancora nessuna. Una cena si aggiunge da sola quando si apre la tua scheda, oppure puoi segnarla dalla sua pagina.
          </p>
        )}
        {account.dinners.map((d) => (
          <div className="row" key={d.packId}>
            <div>
              <Link href={`/cena?id=${d.packId}`}><strong>{d.title}</strong></Link><br />
              <span className="muted">
                {new Date(d.at).toLocaleDateString('it-IT')}
                {d.role === 'master' ? ', come master' : ''}
                {d.source === 'manual' ? ', segnata a mano' : ''}
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
