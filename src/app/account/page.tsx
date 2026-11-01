'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AuthPanel } from '@/components/AuthPanel';
import { type Account, api, fetchAccount, forgetAccountToken, loadAccountToken } from '@/lib/client';

export default function AccountPage() {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);

  const refresh = () => fetchAccount().then(setAccount);
  useEffect(() => { refresh(); }, []);

  return (
    <main className="page">
      <Link href="/">← Tutte le cene</Link>
      <h1 style={{ marginTop: 16 }}>Il tuo account</h1>
      {account === undefined && <p className="muted">Carico…</p>}
      {account === null && <AuthPanel onDone={refresh} />}
      {account && <Profile account={account} onLogout={() => setAccount(null)} />}
    </main>
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
