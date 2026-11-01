'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Blocks } from '@/components/Blocks';
import { type Account, api, fetchAccount, loadAccountToken, saveSession } from '@/lib/client';
import type { PackPublic } from '@/lib/pack';

export default function PackPage() {
  return <Suspense><PackDetails /></Suspense>;
}

function PackDetails() {
  const id = useSearchParams().get('id') ?? '';
  const router = useRouter();
  const [pack, setPack] = useState<{ id: string; title: string; public: PackPublic } | null>(null);
  const [mode, setMode] = useState<'nomaster' | 'master'>('nomaster');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [spoilerOk, setSpoilerOk] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [account, setAccount] = useState<Account | null>(null);
  const myDinner = account?.dinners.find((d) => d.packId === id);

  useEffect(() => {
    api(`/api/packs/${id}`).then(setPack).catch((err) => setError(err.message));
    fetchAccount().then((a) => {
      setAccount(a);
      if (a) setName((current) => current || a.username);
    });
  }, [id]);

  async function mark(played: boolean) {
    setError('');
    try {
      setAccount(await api('/api/accounts/dinners', { body: { packId: id, played }, token: loadAccountToken() }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const out = await api('/api/games', {
        body: { packId: id, mode, name, pin, groupCode, accountToken: loadAccountToken() },
      });
      saveSession(out.code, out.token);
      router.push(`/partita?code=${out.code}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!pack) return <main className="page">{error ? <p className="error">{error}</p> : <p className="muted">Carico…</p>}</main>;

  return (
    <main className="page">
      <Link href="/">← Tutte le cene</Link>
      <h1 style={{ marginTop: 16 }}>{pack.title}</h1>
      <p>{pack.public.tagline}</p>

      {myDinner && (
        <div className="card warning">
          <p><strong>Questa cena l&apos;hai già fatta</strong>{myDinner.role === 'master' ? ', come master' : ''}.</p>
          <p className="muted">Se la rigiochi conosci già la soluzione. Puoi sempre farla da master per un altro gruppo.</p>
          {myDinner.source === 'manual' && <button className="ghost" onClick={() => mark(false)}>Non l&apos;ho fatta: togli il segno</button>}
        </div>
      )}
      {account && !myDinner && (
        <button className="ghost" style={{ marginBottom: 12 }} onClick={() => mark(true)}>L&apos;ho già giocata fuori dall&apos;app</button>
      )}

      <div className="card">
        <h2>Il manuale</h2>
        <p className="muted">Senza spoiler: si può leggere prima della cena.</p>
        {pack.public.manual.map((section, i) => (
          <details key={i}>
            <summary>{section.title}</summary>
            <Blocks blocks={section.blocks} assetBase={`/api/packs/${id}/assets`} />
          </details>
        ))}
        <details>
          <summary>Il cast</summary>
          {pack.public.cast.map((c) => (
            <div className="row" key={c.n}>
              <div><strong>{c.n}. {c.name}</strong><br /><span className="muted">{c.role}. {c.line}</span></div>
            </div>
          ))}
        </details>
      </div>

      <form className="card" onSubmit={create}>
        <h2>Apri una partita</h2>
        <label className="choice">
          <input type="radio" name="mode" checked={mode === 'nomaster'} onChange={() => setMode('nomaster')} />
          <span><strong>Senza master.</strong> Giochi anche tu e nessuno conosce la soluzione.</span>
        </label>
        <label className="choice">
          <input type="radio" name="mode" checked={mode === 'master'} onChange={() => { setMode('master'); setSpoilerOk(false); }} />
          <span><strong>Con me come master.</strong> Non giochi: vedrai subito tutta la soluzione.</span>
        </label>
        {mode === 'master' && (
          <label className="choice">
            <input type="checkbox" checked={spoilerOk} onChange={(e) => setSpoilerOk(e.target.checked)} />
            <span>Ho capito: questa cena sarà rovinata per me.</span>
          </label>
        )}
        <label htmlFor="name">Il tuo nome</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoComplete="given-name" required />
        {!account && (
          <>
            <label htmlFor="pin">Scegli un PIN di 4 cifre</label>
            <input id="pin" value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="off" required />
            <p className="muted" style={{ marginTop: 4 }}>Serve per rientrare se cambi telefono o chiudi la pagina.</p>
          </>
        )}
        <label htmlFor="group">Codice del gruppo</label>
        <input id="group" value={groupCode} onChange={(e) => setGroupCode(e.target.value)} autoComplete="off" />
        {error && <p className="error">{error}</p>}
        <button disabled={busy || (mode === 'master' && !spoilerOk)}>Crea la stanza</button>
      </form>
    </main>
  );
}
