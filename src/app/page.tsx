'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthPanel } from '@/components/AuthPanel';
import { type Account, api, chooseGuest, fetchAccount, isGuest, lastGame, loadAccountToken } from '@/lib/client';
import { fitFor, type PlayerRange } from '@/lib/players';

type PackItem = { id: string; title: string; tagline: string; players: PlayerRange; durationMinutes: number };

export default function Home() {
  const [account, setAccount] = useState<Account | null>(null);
  const [entered, setEntered] = useState<boolean | undefined>(undefined);

  const load = async () => {
    const hadToken = Boolean(loadAccountToken());
    const found = await fetchAccount();
    setAccount(found);
    // Una sessione ancora salvata vale anche senza rete: si entra lo stesso. Se è scaduta, fetchAccount l'ha già tolta.
    setEntered(Boolean(found) || isGuest() || (hadToken && Boolean(loadAccountToken())));
  };
  useEffect(() => { load(); }, []);

  if (entered === undefined) return <main className="page"><p className="muted">Carico…</p></main>;
  if (!entered) {
    return (
      <Welcome
        onLogin={load}
        onGuest={() => {
          chooseGuest();
          setEntered(true);
        }}
      />
    );
  }
  return <Lobby account={account} />;
}

function Welcome({ onLogin, onGuest }: { onLogin: () => void; onGuest: () => void }) {
  return (
    <main className="page">
      <div className="eyebrow">Il nostro archivio</div>
      <h1>Cena con delitto</h1>
      <p className="muted">Ogni telefono mostra solo ciò che quella persona può sapere.</p>
      <AuthPanel onDone={onLogin} />
      <button className="ghost" onClick={onGuest}>Gioca come ospite</button>
      <p className="muted" style={{ marginTop: 8 }}>Da ospite giochi lo stesso, ma non resta traccia delle cene che hai fatto.</p>
    </main>
  );
}

function Lobby({ account }: { account: Account | null }) {
  const router = useRouter();
  const [packs, setPacks] = useState<PackItem[] | null>(null);
  const [code, setCode] = useState('');
  const [last, setLast] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [hidePlayed, setHidePlayed] = useState(false);

  const [people, setPeople] = useState('');

  const played = new Set(account?.dinners.map((d) => d.packId));
  const headcount = people.trim() ? Number(people) : null;
  const notPlayed = packs?.filter((p) => !hidePlayed || !played.has(p.id));
  const visible = notPlayed
    ?.map((pack) => ({ pack, fit: headcount === null ? null : fitFor(pack.players, headcount) }))
    .filter(({ fit }) => headcount === null || fit)
    .sort((a, b) => (a.fit?.gap ?? 0) - (b.fit?.gap ?? 0));

  useEffect(() => {
    setLast(lastGame());
    api<PackItem[]>('/api/packs').then(setPacks).catch((err) => setError(err.message));
  }, []);

  return (
    <main className="page">
      <div className="eyebrow">Il nostro archivio</div>
      <h1>Cena con delitto</h1>
      <p>
        <Link href="/account">
          {account
            ? `${account.username}: ${account.dinners.length === 1 ? '1 cena fatta' : `${account.dinners.length} cene fatte`}`
            : 'Sei ospite: accedi o crea un account'}
        </Link>
      </p>

      {last && (
        <Link className="card" href={`/partita?code=${last}`}>
          <strong>Torna alla partita {last}</strong>
        </Link>
      )}

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) router.push(`/partita?code=${encodeURIComponent(code.trim().toUpperCase())}`);
        }}
      >
        <h2>Entra in una partita</h2>
        <label htmlFor="code">Codice della stanza</label>
        <input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={5}
        />
        <button>Entra</button>
      </form>

      <h2 style={{ marginTop: 24 }}>Le cene</h2>
      {error && <p className="error">{error}</p>}
      {packs === null && !error && <p className="muted">Carico…</p>}
      {packs?.length === 0 && (
        <p className="muted">Nessuna cena ancora. <Link href="/carica">Caricane una</Link>.</p>
      )}
      {packs && packs.length > 0 && (
        <>
          <label htmlFor="people">Quante persone siete? Non contare il master.</label>
          <input
            id="people"
            type="number"
            inputMode="numeric"
            min={1}
            max={99}
            value={people}
            onChange={(e) => setPeople(e.target.value)}
            style={{ marginBottom: 12 }}
          />
        </>
      )}
      {account && played.size > 0 && (
        <label className="choice">
          <input type="checkbox" checked={hidePlayed} onChange={(e) => setHidePlayed(e.target.checked)} />
          <span>Nascondi quelle che ho già fatto</span>
        </label>
      )}
      {packs && packs.length > 0 && visible?.length === 0 && (
        <p className="muted" role="status">
          {headcount === null
            ? 'Le hai già fatte tutte.'
            : `Nessuna cena adatta a ${headcount} ${headcount === 1 ? 'persona' : 'persone'}${hidePlayed ? ' tra quelle che non hai ancora fatto' : ''}.`}
        </p>
      )}
      {visible?.map(({ pack: p, fit }) => (
        <Link className="card" key={p.id} href={`/cena?id=${p.id}`}>
          <h3>{p.title}</h3>
          <p className="muted">{p.tagline}</p>
          {played.has(p.id) && <><span className="badge on">Già fatta</span>{' '}</>}
          {fit && <><span className="badge on">{fit.label}</span>{' '}</>}
          <span className="badge">{p.players.min === p.players.ideal ? `${p.players.ideal} persone` : `${p.players.min}-${p.players.ideal} persone`}</span>{' '}
          <span className="badge">{p.durationMinutes} min</span>
        </Link>
      ))}
      <p className="muted" style={{ marginTop: 24 }}><Link href="/carica">Carica una nuova cena</Link></p>
    </main>
  );
}
