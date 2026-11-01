'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Blocks } from '@/components/Blocks';
import {
  type Account, api, fetchAccount, forgetToken, loadAccountToken, loadNotes, loadToken, saveNotes, saveSession,
} from '@/lib/client';
import type { Block, CastMember, PackPublic } from '@/lib/pack';

const POLL_MS = 4000;
const CARD_COVER_MS = 2 * 60 * 1000;

type Player = {
  id: string; name: string; role: string; isHost: boolean; cards: number[]; ready: boolean; voted: boolean; alreadyPlayed: boolean;
};
type Envelope = { id: string; title: string; documents: { id: string; title: string; blocks: Block[] }[] };
type Result = {
  playerId: string; name: string; accused: number | null; answers: Record<string, string>;
  award: number | null; accusedRight: boolean; marks: string[]; points: number;
};
type GameView = {
  code: string; version: number; mode: 'master' | 'nomaster'; title: string; public: PackPublic;
  dealt: boolean; step: number;
  me: { id: string; name: string; role: string; isHost: boolean; cardNumbers: number[]; ready: boolean; assistant: boolean };
  players: Player[]; readyNeeded: number;
  myVote: { accused: number | null; answers: Record<string, string>; award: number | null } | null;
  events: string[];
  cards: { n: number; blocks: Block[] }[];
  envelopes: Envelope[];
  currentEnvelope: { id: string; shown: number; total: number } | null;
  finale: Block[] | null;
  culprit?: number;
  results: Result[] | null;
  allCards: { n: number; blocks: Block[] }[] | null;
  master: { cards: Record<string, Block[]>; envelopes: Envelope[]; finale: Block[]; culprit: number } | null;
};

export default function GamePage() {
  return <Suspense><GameLoader /></Suspense>;
}

function GameLoader() {
  const code = (useSearchParams().get('code') ?? '').toUpperCase();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [view, setView] = useState<GameView | null>(null);
  const [error, setError] = useState('');
  const versionRef = useRef<number | undefined>(undefined);

  useEffect(() => setToken(loadToken(code)), [code]);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const v = versionRef.current;
      const next = await api(`/api/games/${code}/state${v ? `?v=${v}` : ''}`, { token });
      if (!next.unchanged) {
        versionRef.current = next.version;
        setView(next);
      }
      setError('');
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        forgetToken(code);
        setToken(null);
      } else if (status === 404) {
        setError('Partita non trovata.');
      } else {
        setError('Connessione assente: riprovo da solo.');
      }
    }
  }, [code, token]);

  useEffect(() => {
    if (!token) return;
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [token, refresh]);

  const send = useCallback(async (action: Record<string, unknown>) => {
    const next = await api(`/api/games/${code}/action`, { body: action, token: token! });
    versionRef.current = next.version;
    setView(next);
  }, [code, token]);

  if (token === undefined) return <main className="page"><p className="muted">Carico…</p></main>;
  if (!token) return <JoinForm code={code} onJoined={(t) => { saveSession(code, t); setToken(t); }} />;
  if (!view) return <main className="page">{error ? <p className="error">{error}</p> : <p className="muted">Carico…</p>}</main>;

  // Il colore della cena resta una fascia in alto: testi e fondi non dipendono dal suo contrasto.
  const accent = view.public.theme?.accent;

  return (
    <div style={accent ? { borderTop: `6px solid ${accent}` } : undefined}>
      {error && <p className="error" role="status" style={{ textAlign: 'center' }}>{error}</p>}
      <Game view={view} token={token} send={send} />
    </div>
  );
}

function JoinForm({ code, onJoined }: { code: string; onJoined: (token: string) => void }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    fetchAccount().then((a) => {
      setAccount(a);
      if (a) setName((current) => current || a.username);
    });
  }, []);

  return (
    <main className="page">
      <Link href="/">← Inizio</Link>
      <div className="eyebrow" style={{ marginTop: 16 }}>Stanza</div>
      <div className="code">{code}</div>
      <form
        className="card"
        style={{ marginTop: 16 }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            const out = await api(`/api/games/${code}/join`, { body: { name, pin, accountToken: loadAccountToken() } });
            onJoined(out.token);
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <label htmlFor="name">Il tuo nome</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoComplete="given-name" required />
        {account ? (
          <p className="muted" style={{ marginTop: 8 }}>Entri come {account.username}: la cena finirà nel tuo storico.</p>
        ) : (
          <>
            <label htmlFor="pin">PIN di 4 cifre</label>
            <input id="pin" value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="off" required />
            <p className="muted" style={{ marginTop: 4 }}>Se è la prima volta, scegline uno. Se stai rientrando, usa lo stesso nome e PIN.</p>
            <p className="muted"><Link href="/account">Accedi</Link> per salvare questa cena tra quelle che hai fatto.</p>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <button disabled={busy}>Entra</button>
      </form>
    </main>
  );
}

type Send = (action: Record<string, unknown>) => Promise<void>;
type Tab = 'serata' | 'scheda' | 'documenti' | 'taccuino' | 'voto' | 'finale' | 'master';

/** Tiene acceso lo schermo durante la partita. Dove il telefono non lo permette, resta tutto come prima. */
function useKeepScreenOn() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (stopped) next.release();
        else lock = next;
      } catch {
        // Batteria scarica o permesso negato: si gioca lo stesso.
      }
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', acquire);
      lock?.release().catch(() => {});
    };
  }, []);
}

function Game({ view, token, send }: { view: GameView; token: string; send: Send }) {
  const [tab, setTab] = useState<Tab>('serata');
  useKeepScreenOn();
  const isMaster = view.me.role === 'master';
  const stepKind = view.step >= 0 ? view.public.program[view.step]?.kind : null;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'serata', label: 'Serata' },
    ...(isMaster ? [] : [{ id: 'scheda' as Tab, label: 'Scheda' }]),
    { id: 'documenti', label: 'Documenti' },
    ...(isMaster ? [] : [{ id: 'taccuino' as Tab, label: 'Taccuino' }]),
    ...(stepKind === 'vote' && !isMaster ? [{ id: 'voto' as Tab, label: 'Voto' }] : []),
    ...(view.finale ? [{ id: 'finale' as Tab, label: 'Finale' }] : []),
    ...(isMaster ? [{ id: 'master' as Tab, label: 'Master' }] : []),
  ];
  const active = tabs.some((t) => t.id === tab) ? tab : 'serata';

  return (
    <>
      <main className="page">
        {active === 'serata' && <Evening view={view} token={token} send={send} onOpenDocuments={() => setTab('documenti')} />}
        {active === 'scheda' && <MyCard view={view} token={token} />}
        {active === 'documenti' && <Documents view={view} token={token} send={send} />}
        {active === 'taccuino' && <Notebook code={view.code} />}
        {active === 'voto' && <VoteForm view={view} send={send} />}
        {active === 'finale' && <Finale view={view} token={token} send={send} />}
        {active === 'master' && <MasterPanel view={view} token={token} />}
      </main>
      <nav className="tabs" aria-label="Sezioni">
        {tabs.map((t) => (
          <button key={t.id} aria-current={active === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
    </>
  );
}

const castOf = (view: GameView, n: number): CastMember | undefined => view.public.cast.find((c) => c.n === n);
const assetBase = (view: GameView) => `/api/games/${view.code}/assets`;

function ActionButton({ onClick, className, disabled, children }: {
  onClick: () => Promise<void>; className?: string; disabled?: boolean; children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
      <button
        className={className}
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await onClick();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {children}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}

function InviteButton({ view }: { view: GameView }) {
  const invite = async () => {
    const url = window.location.href;
    const text = `Vieni a giocare a «${view.title}». Il codice della stanza è ${view.code}.`;
    if (navigator.share) {
      // Se chi invita annulla la condivisione non c'è nulla da fare.
      await navigator.share({ title: view.title, text, url }).catch(() => {});
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, '_blank', 'noopener');
    }
  };
  return <button className="ghost" onClick={invite}>Invita</button>;
}

function Evening({ view, token, send, onOpenDocuments }: {
  view: GameView; token: string; send: Send; onOpenDocuments: () => void;
}) {
  const program = view.public.program;
  const isMaster = view.me.role === 'master';
  const seated = view.players.filter((p) => p.role === 'player');
  const current = view.step >= 0 ? program[view.step] : null;
  const next = program[view.step + 1];
  const atEnd = !next;
  const readyCount = seated.filter((p) => p.ready).length;
  const notReady = seated.filter((p) => !p.ready).map((p) => p.name);
  const documentsLeft = view.currentEnvelope ? view.currentEnvelope.total - view.currentEnvelope.shown : 0;
  const canDeal = !view.dealt && (isMaster || view.me.isHost);
  const votedCount = seated.filter((p) => p.voted).length;

  return (
    <>
      <div className="eyebrow">{view.title}</div>
      <h1>{current ? current.title : view.dealt ? 'Personaggi assegnati' : 'Si aspetta il cast'}</h1>

      {!view.dealt && (
        <div className="card">
          <div className="eyebrow">Codice della stanza</div>
          <div className="code">{view.code}</div>
          <p className="muted" style={{ marginTop: 8 }}>
            Chi deve giocare lo inserisce nella pagina iniziale.
            {view.mode === 'master' ? ' Tu fai il master: non ricevi una scheda.' : ''}
          </p>
          <InviteButton view={view} />
          {canDeal ? (
            <ActionButton onClick={() => send({ type: 'deal' })} disabled={seated.length < view.public.players.min}>
              Distribuisci i personaggi ({seated.length} {seated.length === 1 ? 'persona' : 'persone'})
            </ActionButton>
          ) : <p className="muted">Quando ci siete tutti, chi ha creato la stanza distribuisce i personaggi.</p>}
          {seated.some((p) => p.alreadyPlayed) && (
            <p className="error" role="status" style={{ marginTop: 8 }}>
              Hanno già fatto questa cena: {seated.filter((p) => p.alreadyPlayed).map((p) => p.name).join(', ')}.
            </p>
          )}
          {seated.length < view.public.players.min && (
            <p className="muted" style={{ marginTop: 8 }}>Servono almeno {view.public.players.min} persone.</p>
          )}
          {seated.length > 0 && seated.length < view.public.cast.length && (
            <p className="muted" style={{ marginTop: 8 }}>
              I personaggi sono {view.public.cast.length}: se resta così, qualcuno ne riceverà due.
            </p>
          )}
        </div>
      )}

      {view.dealt && !isMaster && view.step < 0 && (
        <div className="card"><MyCharacter view={view} /></div>
      )}

      {current && (
        <div className="card">
          {current.when && <div className="eyebrow">Minuto {current.when}</div>}
          <p>{current.instructions}</p>
          {current.readAloud && (
            <>
              <h3>Da leggere ad alta voce</h3>
              <Blocks blocks={current.readAloud} assetBase={assetBase(view)} token={token} />
            </>
          )}
          {current.kind === 'vote' && <p className="muted">Hanno votato {votedCount} su {seated.length}.</p>}
        </div>
      )}

      {view.dealt && !atEnd && (
        <div className="card next">
          <h3>Prossimo: {next.title}</h3>
          {documentsLeft > 0 ? (
            <>
              <p className="muted">
                Prima leggete tutti i documenti della busta: siete al {view.currentEnvelope!.shown} di {view.currentEnvelope!.total}.
              </p>
              <button onClick={onOpenDocuments}>Vai ai documenti</button>
            </>
          ) : isMaster ? (
            <MasterAdvance
              key={next.id}
              title={next.title}
              missingVotes={next.kind === 'finale' ? seated.filter((p) => !p.voted).map((p) => p.name) : []}
              send={send}
            />
          ) : view.mode === 'master' ? (
            <p className="muted">Fa partire il master.</p>
          ) : (
            <>
              {next.kind === 'finale' ? (
                <>
                  <p className="muted">Il finale si apre solo quando tutti hanno votato e premuto il pulsante: {readyCount} su {view.readyNeeded}.</p>
                  {notReady.length > 0 && <p className="muted">Si aspettano: {notReady.join(', ')}.</p>}
                </>
              ) : (
                <p className="muted">Si passa quando è d&apos;accordo la maggioranza: {readyCount} su {view.readyNeeded}.</p>
              )}
              <ActionButton
                className={view.me.ready ? 'ghost' : undefined}
                disabled={view.me.ready || (next.kind === 'finale' && !view.myVote)}
                onClick={() => send({ type: 'ready' })}
              >
                {view.me.ready
                  ? 'Si aspettano gli altri'
                  : next.kind === 'finale' && !view.myVote ? 'Prima vota' : 'Si può andare avanti'}
              </ActionButton>
              {next.kind === 'finale' && view.me.isHost && notReady.length > 0 && (
                <ForceFinale missing={notReady.filter((name) => name !== view.me.name)} canForce={Boolean(view.myVote)} send={send} />
              )}
            </>
          )}
        </div>
      )}

      <div className="card">
        <h3>Programma</h3>
        {program.map((s, i) => (
          <div key={s.id} className={`step ${i < view.step ? 'done' : ''} ${i === view.step ? 'now' : ''}`}>
            <strong>{s.title}</strong>
            {s.when && <span className="muted"> · {s.when}</span>}
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Al tavolo</h3>
        {view.dealt && (
          <>
            <p className="muted">Codice della stanza: <strong>{view.code}</strong></p>
            <InviteButton view={view} />
          </>
        )}
        {view.players.map((p) => (
          <PlayerRow key={p.id} player={p} view={view} send={send} />
        ))}
      </div>

      {view.events.length > 0 && (
        <div className="card">
          <h3>Cronaca</h3>
          {view.events.slice(0, 6).map((e, i) => <p className="muted" key={i}>{e}</p>)}
        </div>
      )}
    </>
  );
}

/** Aprire una busta o il finale non si può annullare: serve una conferma, così un doppio tocco non salta un atto. */
function MasterAdvance({ title, missingVotes, send }: { title: string; missingVotes: string[]; send: Send }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) return <button onClick={() => setConfirming(true)}>Fai partire «{title}»</button>;
  return (
    <>
      <p>Tutti i telefoni passano a «{title}» e non si può tornare indietro.</p>
      {missingVotes.length > 0 && (
        <p className="error" role="alert">Non hanno ancora votato: {missingVotes.join(', ')}. Dopo non potranno più farlo.</p>
      )}
      <ActionButton onClick={() => send({ type: 'advance' })}>Sì, fai partire</ActionButton>
      <button className="ghost" onClick={() => setConfirming(false)}>Annulla</button>
    </>
  );
}

/** Per chi ha creato la stanza, se qualcuno non può più rispondere: altrimenti il finale non si aprirebbe mai. */
function ForceFinale({ missing, canForce, send }: { missing: string[]; canForce: boolean; send: Send }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return <button className="ghost" onClick={() => setOpen(true)}>Qualcuno non può più rispondere?</button>;
  }
  return (
    <div style={{ marginTop: 12 }}>
      <p>
        Prova prima a farlo rientrare da un altro telefono con il suo nome e PIN. Se apri il finale ora, chi non ha votato non potrà più farlo
        e tutti vedranno che l&apos;hai aperto tu{missing.length > 0 ? ` senza aspettare ${missing.join(', ')}` : ''}.
      </p>
      {!canForce && <p className="muted">Prima devi votare anche tu.</p>}
      <ActionButton className="danger" disabled={!canForce} onClick={() => send({ type: 'forceFinale' })}>
        Apri il finale senza aspettare
      </ActionButton>
      <button className="ghost" onClick={() => setOpen(false)}>Annulla</button>
    </div>
  );
}

function PlayerRow({ player, view, send }: { player: Player; view: GameView; send: Send }) {
  const [resetting, setResetting] = useState(false);
  const [pin, setPin] = useState('');
  const canReset = (view.me.role === 'master' || view.me.isHost) && player.id !== view.me.id;
  const character = player.cards.map((n) => castOf(view, n)?.name).filter(Boolean).join(' + ');
  return (
    <div>
      <div className="row">
        <div>
          <strong>{player.name}</strong>
          {player.role === 'master' && <span className="muted"> · master</span>}
          {character && <><br /><span className="muted">{character}</span></>}
        </div>
        {canReset && <button className="ghost small" onClick={() => setResetting(!resetting)}>PIN</button>}
      </div>
      {resetting && (
        <div style={{ paddingBottom: 12 }}>
          <label htmlFor={`pin-${player.id}`}>Nuovo PIN per {player.name}. Tutti vedranno che lo hai cambiato.</label>
          <input id={`pin-${player.id}`} value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" maxLength={4} />
          <ActionButton
            className="danger"
            onClick={async () => {
              await send({ type: 'resetPin', playerId: player.id, pin });
              setResetting(false);
              setPin('');
            }}
          >
            Cambia il PIN
          </ActionButton>
        </div>
      )}
    </div>
  );
}

function MyCharacter({ view }: { view: GameView }) {
  if (view.me.assistant) {
    return (
      <>
        <h3>Assistente di produzione</h3>
        <p>Non hai scheda né segreti. Aiuti a leggere, fai domande a tutti e voti solo il premio del pubblico.</p>
      </>
    );
  }
  return (
    <>
      {view.me.cardNumbers.map((n) => {
        const c = castOf(view, n);
        return (
          <div key={n} style={{ marginBottom: 8 }}>
            <div className="eyebrow">Il tuo personaggio · n. {n}</div>
            <h3>{c?.name}</h3>
            <p className="muted">{c?.role}. {c?.line}</p>
          </div>
        );
      })}
      {view.me.cardNumbers.length > 1 && <p className="muted">Hai due schede: rispondi per entrambi e voti una volta sola.</p>}
    </>
  );
}

function MyCard({ view, token }: { view: GameView; token: string }) {
  const [revealed, setRevealed] = useState(false);

  // La scheda si richiude da sola appena si cambia app.
  useEffect(() => {
    const hide = () => { if (document.visibilityState !== 'visible') setRevealed(false); };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);

  // Lo schermo resta acceso: una scheda dimenticata aperta sul tavolo deve coprirsi da sola.
  useEffect(() => {
    if (!revealed) return;
    let timer = setTimeout(() => setRevealed(false), CARD_COVER_MS);
    const touched = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setRevealed(false), CARD_COVER_MS);
    };
    const events = ['pointerdown', 'scroll', 'keydown'];
    events.forEach((name) => window.addEventListener(name, touched, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach((name) => window.removeEventListener(name, touched));
    };
  }, [revealed]);

  return (
    <>
      <div className="eyebrow">Scheda riservata</div>
      <h1>La tua scheda</h1>
      {!view.dealt && <p className="muted">I personaggi non sono ancora stati distribuiti.</p>}
      {view.dealt && <div className="card"><MyCharacter view={view} /></div>}
      {view.dealt && !view.me.assistant && view.cards.length === 0 && (
        <p className="muted">La scheda si aprirà quando la serata arriva a quel passo.</p>
      )}
      {view.cards.length > 0 && !revealed && (
        <div className="card cover-screen">
          <div className="stamp big" aria-hidden="true">Riservato</div>
          <p>Controlla che nessuno stia guardando.</p>
          <button onClick={() => setRevealed(true)}>Mostra la scheda</button>
        </div>
      )}
      {revealed && view.cards.map((c) => (
        <div className="card" key={c.n}>
          <div className="eyebrow">N. {c.n} · {castOf(view, c.n)?.name}</div>
          <Blocks blocks={c.blocks} assetBase={assetBase(view)} token={token} />
        </div>
      ))}
      {revealed && <button className="ghost" onClick={() => setRevealed(false)}>Copri la scheda</button>}
    </>
  );
}

function Documents({ view, token, send }: { view: GameView; token: string; send: Send }) {
  const cast = view.public.cast;
  const current = view.currentEnvelope;
  const canTurn = view.mode === 'nomaster' || view.me.role === 'master';
  let counter = 0;
  return (
    <>
      <div className="eyebrow">Sul tavolo</div>
      <h1>Documenti</h1>
      {view.envelopes.length === 0 && <p className="muted">Nessuna busta aperta per ora.</p>}
      {view.envelopes.map((env) => (
        <div className="card" key={env.id}>
          <h2>{env.title}</h2>
          {env.id === current?.id && <p className="muted">Documento {current.shown} di {current.total}</p>}
          {env.documents.map((d, i) => {
            const reader = cast[counter++ % cast.length];
            return (
              <details key={d.id} open={env.id === current?.id && i === env.documents.length - 1}>
                <summary>{d.title}</summary>
                <p className="muted" style={{ marginTop: 8 }}>Legge il n. {reader.n}, {reader.name}</p>
                <Blocks blocks={d.blocks} assetBase={assetBase(view)} token={token} />
              </details>
            );
          })}
          {env.id === current?.id && current.shown < current.total && (
            canTurn ? (
              <ActionButton onClick={() => send({ type: 'nextDocument', expected: current.shown })}>
                Letto: apri il prossimo documento
              </ActionButton>
            ) : (
              <p className="muted" style={{ marginTop: 12 }}>Il prossimo documento lo apre il master.</p>
            )
          )}
          {env.id === current?.id && current.shown >= current.total && (
            <p className="muted" style={{ marginTop: 12 }}>Tutti i documenti di questa busta sono sul tavolo.</p>
          )}
        </div>
      ))}
    </>
  );
}

function Notebook({ code }: { code: string }) {
  const [text, setText] = useState('');
  useEffect(() => setText(loadNotes(code)), [code]);
  return (
    <>
      <div className="eyebrow">Solo su questo telefono</div>
      <h1>Taccuino</h1>
      <label htmlFor="notes">I tuoi appunti</label>
      <textarea
        id="notes"
        style={{ minHeight: '50dvh' }}
        value={text}
        onChange={(e) => { setText(e.target.value); saveNotes(code, e.target.value); }}
      />
    </>
  );
}

function VoteForm({ view, send }: { view: GameView; send: Send }) {
  const vote = view.public.vote;
  const [accused, setAccused] = useState(view.myVote?.accused?.toString() ?? '');
  const [answers, setAnswers] = useState<Record<string, string>>(view.myVote?.answers ?? {});
  const [award, setAward] = useState(view.myVote?.award?.toString() ?? '');
  const [saved, setSaved] = useState(Boolean(view.myVote));
  const assistant = view.me.assistant;
  return (
    <>
      <div className="eyebrow">In segreto</div>
      <h1>Il tuo voto</h1>
      <div className="card">
        {!assistant && (
          <>
            <label htmlFor="accused">Chi è stato? ({vote.accusedPoints} punti)</label>
            <select id="accused" value={accused} onChange={(e) => { setAccused(e.target.value); setSaved(false); }}>
              <option value="">Scegli…</option>
              {view.public.cast.map((c) => <option key={c.n} value={c.n}>{c.n}. {c.name}</option>)}
            </select>
            {vote.fields.map((f) => (
              <div key={f.id}>
                <label htmlFor={f.id}>
                  {f.label}{f.points > 0 ? ` (${f.points} ${f.points === 1 ? 'punto' : 'punti'})` : ''}
                </label>
                <textarea
                  id={f.id}
                  value={answers[f.id] ?? ''}
                  onChange={(e) => { setAnswers({ ...answers, [f.id]: e.target.value }); setSaved(false); }}
                />
              </div>
            ))}
          </>
        )}
        {vote.awardLabel && (
          <>
            <label htmlFor="award">{vote.awardLabel}</label>
            <select id="award" value={award} onChange={(e) => { setAward(e.target.value); setSaved(false); }}>
              <option value="">Nessuno</option>
              {view.public.cast.map((c) => <option key={c.n} value={c.n}>{c.n}. {c.name}</option>)}
            </select>
          </>
        )}
        <ActionButton
          disabled={!assistant && !accused}
          onClick={async () => {
            await send({ type: 'vote', accused: Number(accused), answers, award: award ? Number(award) : null });
            setSaved(true);
          }}
        >
          {view.myVote ? 'Aggiorna il voto' : 'Vota'}
        </ActionButton>
        {saved && <p className="muted" role="status" style={{ marginTop: 8 }}>Voto salvato. Puoi cambiarlo finché non si apre il finale.</p>}
      </div>
    </>
  );
}

function Finale({ view, token, send }: { view: GameView; token: string; send: Send }) {
  const results = view.results ?? [];
  const vote = view.public.vote;
  const canMark = view.mode === 'nomaster' || view.me.role === 'master';
  const ranked = [...results].sort((a, b) => b.points - a.points);
  const items = [
    ...vote.fields.filter((f) => f.points > 0).map((f) => ({ id: f.id, label: `Risposta giusta (+${f.points}): ${f.label}` })),
    ...(vote.missionPoints ? [{ id: 'mission', label: `Missione riuscita (+${vote.missionPoints})` }] : []),
  ];
  const accusers = results.filter((r) => r.accused !== null);
  const awardVotes = new Map<number, number>();
  for (const r of results) if (r.award !== null) awardVotes.set(r.award, (awardVotes.get(r.award) ?? 0) + 1);
  const topAward = Math.max(0, ...awardVotes.values());
  const awardWinners = [...awardVotes].filter(([, votes]) => votes === topAward).map(([n]) => castOf(view, n)?.name);
  return (
    <>
      <div className="eyebrow">La verità</div>
      <h1>Finale</h1>
      <div className="card">
        <Blocks blocks={view.finale ?? []} assetBase={assetBase(view)} token={token} />
      </div>
      <div className="card">
        <h2>I voti</h2>
        <p>Hanno indovinato il colpevole: <strong>{accusers.filter((r) => r.accusedRight).length} su {accusers.length}</strong>.</p>
        {vote.awardLabel && awardWinners.length > 0 && (
          <p>{vote.awardLabel}: <strong>{awardWinners.join(', ')}</strong> ({topAward} {topAward === 1 ? 'voto' : 'voti'}).</p>
        )}
      </div>
      <div className="card">
        <h2>Classifica</h2>
        {canMark && <p className="muted">Apri ogni nome per leggere le risposte e assegnare i punti.</p>}
        {ranked.map((r) => (
          <details key={r.playerId}>
            <summary>
              {r.name}: {r.points} {r.points === 1 ? 'punto' : 'punti'}
            </summary>
            <p style={{ marginTop: 8 }}>
              Ha accusato {r.accused ? castOf(view, r.accused)?.name : 'nessuno'}
              {r.accusedRight ? `: giusto, +${vote.accusedPoints}` : ''}
            </p>
            {vote.fields.map((f) => (
              <p className="muted" key={f.id}><strong>{f.label}</strong><br />{r.answers[f.id] || 'Nessuna risposta'}</p>
            ))}
            {items.map((item) => (
              <label className="choice" key={item.id}>
                <input
                  type="checkbox"
                  disabled={!canMark}
                  checked={r.marks.includes(item.id)}
                  onChange={(e) => send({ type: 'mark', playerId: r.playerId, item: item.id, on: e.target.checked })}
                />
                <span>{item.label}</span>
              </label>
            ))}
          </details>
        ))}
      </div>
      {view.allCards && (
        <div className="card">
          <h2>Tutte le schede</h2>
          {view.allCards.map((c) => (
            <details key={c.n}>
              <summary>{c.n}. {castOf(view, c.n)?.name}</summary>
              <Blocks blocks={c.blocks} assetBase={assetBase(view)} token={token} />
            </details>
          ))}
        </div>
      )}
    </>
  );
}

function MasterPanel({ view, token }: { view: GameView; token: string }) {
  const m = view.master;
  if (!m) return null;
  const owner = (n: number) => view.players.find((p) => p.cards.includes(n))?.name;
  return (
    <>
      <div className="eyebrow">Solo per il master</div>
      <h1>Dietro le quinte</h1>
      <div className="card warning">
        <p><strong>Colpevole:</strong> {m.culprit}. {castOf(view, m.culprit)?.name}{owner(m.culprit) ? ` (${owner(m.culprit)})` : ''}</p>
        <p className="muted">Hanno votato {view.players.filter((p) => p.voted).length} persone.</p>
      </div>
      <div className="card">
        <h2>Schede</h2>
        {view.public.cast.map((c) => (
          <details key={c.n}>
            <summary>{c.n}. {c.name}{owner(c.n) ? ` · ${owner(c.n)}` : ''}</summary>
            <Blocks blocks={m.cards[String(c.n)]} assetBase={assetBase(view)} token={token} />
          </details>
        ))}
      </div>
      <div className="card">
        <h2>Buste</h2>
        {m.envelopes.map((env) => (
          <details key={env.id}>
            <summary>{env.title}</summary>
            {env.documents.map((d) => (
              <div key={d.id}>
                <h3 style={{ marginTop: 12 }}>{d.title}</h3>
                <Blocks blocks={d.blocks} assetBase={assetBase(view)} token={token} />
              </div>
            ))}
          </details>
        ))}
      </div>
      <div className="card">
        <h2>Finale</h2>
        <Blocks blocks={m.finale} assetBase={assetBase(view)} token={token} />
      </div>
    </>
  );
}
