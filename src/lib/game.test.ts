import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../supabase/functions/api/types.ts';
import { openPglite } from './db';
import { act, createGame, dealCards, getAsset, getPublicAsset, getPublicPack, getState, joinGame, listPacks, saveAsset, savePack } from '../../supabase/functions/api/game.ts';
import { validatePack, type Pack } from '../../supabase/functions/api/pack.ts';

// Ogni segreto contiene un marcatore: se compare dove non deve, il test lo vede.
const card = (n: number) => [{ t: 'p' as const, text: `SEGRETO_SCHEDA_${n}` }];
const pack: Pack = {
  format: 1,
  id: 'cena-test',
  title: 'Cena test',
  public: {
    tagline: 'pubblico',
    players: { min: 3, ideal: 4 },
    durationMinutes: 10,
    manual: [{ title: 'Manuale', blocks: [{ t: 'p', text: 'pubblico' }] }],
    cast: [1, 2, 3, 4].map((n) => ({ n, name: `Nome ${n}`, role: 'Ruolo', line: 'riga' })),
    program: [
      { id: 'a', title: 'Aperitivo', kind: 'info', instructions: 'x' },
      { id: 'b', title: 'Schede', kind: 'cards', instructions: 'x' },
      { id: 'c', title: 'Atto I', kind: 'envelope', envelope: 'A', instructions: 'x' },
      { id: 'd', title: 'Atto II', kind: 'envelope', envelope: 'B', instructions: 'x' },
      { id: 'e', title: 'Voto', kind: 'vote', instructions: 'x' },
      { id: 'f', title: 'Finale', kind: 'finale', instructions: 'x' },
    ],
    vote: { accusedPoints: 3, fields: [{ id: 'movente', label: 'Perché', points: 1 }], missionPoints: 1 },
  },
  secret: {
    cards: { 1: card(1), 2: card(2), 3: card(3), 4: card(4) },
    envelopes: [
      { id: 'A', title: 'A', documents: [{ id: 'a1', title: 'SEGRETO_TITOLO_A', blocks: [{ t: 'img', asset: 'foto-a' }] }] },
      { id: 'B', title: 'B', documents: [{ id: 'b1', title: 'SEGRETO_TITOLO_B', blocks: [{ t: 'p', text: 'SEGRETO_BUSTA_B' }] }] },
    ],
    finale: [{ t: 'p', text: 'SEGRETO_FINALE' }],
    solution: { culprit: 3 },
  },
  assets: { 'foto-a': { mime: 'image/png', base64: 'AAAA' } },
};

const text = (v: unknown) => JSON.stringify(v);
const otherCardsOf = (mine: number[]) => [1, 2, 3, 4].filter((n) => !mine.includes(n));

let db: Db;
let code: string;
let tokens: string[];

async function table(mode: 'nomaster' | 'master', seats = 4) {
  const first = await createGame(db, { packId: pack.id, mode, name: 'Primo', pin: '1111' });
  code = first.code;
  tokens = mode === 'master' ? [] : [first.token];
  const masterToken = first.token;
  for (let i = tokens.length; i < seats; i++) {
    tokens.push((await joinGame(db, code, { name: `Giocatore ${i}`, pin: '2222' })).token);
  }
  return masterToken;
}

const allReady = async () => {
  for (const t of tokens) {
    const s: any = await getState(db, code, t);
    if (!s.me.ready) await act(db, code, t, { type: 'ready' }).catch(() => {});
  }
};
const stateOf = async (t: string) => (await getState(db, code, t)) as any;
const goToStep = async (kind: string) => {
  for (let i = 0; i < 20; i++) {
    const s = await stateOf(tokens[0]);
    if (s.step >= 0 && s.public.program[s.step].kind === kind) return s;
    await act(db, code, tokens[0], { type: 'ready' }).catch(() => {});
    await act(db, code, tokens[1], { type: 'ready' }).catch(() => {});
    await act(db, code, tokens[2], { type: 'ready' }).catch(() => {});
  }
  throw new Error(`Passo ${kind} non raggiunto`);
};

beforeEach(async () => {
  db = await openPglite();
  await savePack(db, pack);
  await saveAsset(db, pack.id, 'foto-a', 'image/png', 'AAAA');
});

describe('formato della cena', () => {
  it('accetta una cena corretta e controlla le schede mancanti', () => {
    expect(validatePack(pack)).toEqual([]);
    const broken = structuredClone(pack) as any;
    delete broken.secret.cards[2];
    expect(validatePack(broken).join()).toContain('secret.cards.2');
  });

  it('gli errori di validazione non citano mai il contenuto', () => {
    const broken = structuredClone(pack) as any;
    broken.secret.envelopes[0].documents[0].blocks = [{ t: 'boh', text: 'SEGRETO_X' }];
    expect(validatePack(broken).join()).not.toContain('SEGRETO');
  });
});

describe('nessuno spoiler', () => {
  it('catalogo e pagina pubblica non contengono segreti', async () => {
    expect(text(await listPacks(db))).not.toContain('SEGRETO');
    expect(text(await getPublicPack(db, pack.id))).not.toContain('SEGRETO');
    await expect(getPublicAsset(db, pack.id, 'foto-a')).rejects.toThrow();
  });

  it('senza master: ognuno vede solo ciò che è stato aperto', async () => {
    await table('nomaster');
    const lobby = await stateOf(tokens[1]);
    expect(text(lobby)).not.toContain('SEGRETO');

    await act(db, code, tokens[0], { type: 'deal' });
    const dealt = await stateOf(tokens[0]);
    expect(dealt.me.cardNumbers).toHaveLength(1);
    expect(text(dealt)).not.toContain('SEGRETO');

    const schede = await goToStep('cards');
    expect(schede.cards.map((c: any) => c.n)).toEqual(schede.me.cardNumbers);
    for (const n of otherCardsOf(schede.me.cardNumbers)) expect(text(schede)).not.toContain(`SEGRETO_SCHEDA_${n}`);
    expect(text(schede)).not.toContain('SEGRETO_TITOLO_A');

    const atto1 = await goToStep('envelope');
    expect(text(atto1)).toContain('SEGRETO_TITOLO_A');
    expect(text(atto1)).not.toContain('SEGRETO_TITOLO_B');
    expect(text(atto1)).not.toContain('SEGRETO_FINALE');
    expect(text(atto1)).not.toContain('culprit');
    expect(atto1.master).toBeNull();
  });

  it('chi crea la partita senza master non ha privilegi sui segreti', async () => {
    await table('nomaster');
    await act(db, code, tokens[0], { type: 'deal' });
    const host = await stateOf(tokens[0]);
    expect(host.me.isHost).toBe(true);
    expect(host.master).toBeNull();
    await expect(act(db, code, tokens[0], { type: 'advance' })).rejects.toThrow();
  });

  it('il finale si apre solo quando tutti hanno votato e premuto avanti', async () => {
    await table('nomaster');
    await act(db, code, tokens[0], { type: 'deal' });
    await goToStep('vote');
    expect((await stateOf(tokens[0])).readyNeeded).toBe(4);
    for (const t of tokens) await expect(act(db, code, t, { type: 'ready' })).rejects.toThrow('Prima vota');
    expect(text(await stateOf(tokens[0]))).not.toContain('SEGRETO_FINALE');
    for (const t of tokens) {
      await act(db, code, t, { type: 'vote', accused: 3, answers: { movente: 'soldi' } });
    }
    for (const t of tokens.slice(0, 3)) await act(db, code, t, { type: 'ready' });
    expect(text(await stateOf(tokens[0]))).not.toContain('SEGRETO_FINALE');
    await act(db, code, tokens[3], { type: 'ready' });
    const finale = await stateOf(tokens[0]);
    expect(text(finale)).toContain('SEGRETO_FINALE');
    expect(finale.results.find((r: any) => r.name === 'Primo').points).toBe(3);
  });

  it('solo chi ha creato la stanza può aprire il finale senza aspettare, e tutti lo vedono', async () => {
    await table('nomaster');
    await act(db, code, tokens[0], { type: 'deal' });
    await expect(act(db, code, tokens[0], { type: 'forceFinale' })).rejects.toThrow('Ora non si può');
    await goToStep('vote');
    await expect(act(db, code, tokens[0], { type: 'forceFinale' })).rejects.toThrow('Prima vota');
    await act(db, code, tokens[1], { type: 'vote', accused: 3, answers: {} });
    await expect(act(db, code, tokens[1], { type: 'forceFinale' })).rejects.toThrow('creato la stanza');
    expect(text(await stateOf(tokens[1]))).not.toContain('SEGRETO_FINALE');

    await act(db, code, tokens[0], { type: 'vote', accused: 3, answers: {} });
    await act(db, code, tokens[1], { type: 'ready' });
    await act(db, code, tokens[0], { type: 'forceFinale' });
    const after = await stateOf(tokens[2]);
    expect(text(after)).toContain('SEGRETO_FINALE');
    expect(after.events[0]).toContain('senza aspettare Giocatore 2, Giocatore 3');
    expect(after.events[0]).not.toContain('Giocatore 1');
  });

  it('con il master il finale lo apre lui e non esiste l\'apertura di emergenza', async () => {
    const master = await table('master');
    await expect(act(db, code, master, { type: 'forceFinale' })).rejects.toThrow('creato la stanza');
  });

  it('i voti altrui restano nascosti fino al finale', async () => {
    await table('nomaster');
    await act(db, code, tokens[0], { type: 'deal' });
    await goToStep('vote');
    await act(db, code, tokens[0], { type: 'vote', accused: 1, answers: { movente: 'SEGRETO_VOTO' } });
    expect(text(await stateOf(tokens[1]))).not.toContain('SEGRETO_VOTO');
  });

  it('un\'immagine si scarica solo dopo che la sua busta è aperta', async () => {
    await table('nomaster');
    await act(db, code, tokens[0], { type: 'deal' });
    await expect(getAsset(db, code, tokens[0], 'foto-a')).rejects.toThrow();
    await goToStep('envelope');
    expect((await getAsset(db, code, tokens[0], 'foto-a')).mime).toBe('image/png');
  });

  it('un codice sbagliato non vede nulla', async () => {
    await table('nomaster');
    await expect(getState(db, code, 'inventato')).rejects.toThrow();
    await expect(getState(db, code, null)).rejects.toThrow();
  });
});

describe('documenti uno alla volta', () => {
  const twoDocs = structuredClone(pack);
  twoDocs.id = 'cena-due-documenti';
  twoDocs.secret.envelopes[0].documents = [
    { id: 'a1', title: 'SEGRETO_DOC_1', blocks: [{ t: 'p', text: 'SEGRETO_TESTO_1' }] },
    { id: 'a2', title: 'SEGRETO_DOC_2', blocks: [{ t: 'img', asset: 'foto-a' }] },
    { id: 'a3', title: 'SEGRETO_DOC_3', blocks: [{ t: 'p', text: 'SEGRETO_TESTO_3' }] },
  ];

  async function atFirstEnvelope(mode: 'nomaster' | 'master' = 'nomaster') {
    await savePack(db, twoDocs);
    await saveAsset(db, twoDocs.id, 'foto-a', 'image/png', 'AAAA');
    const first = await createGame(db, { packId: twoDocs.id, mode, name: 'Primo', pin: '1111' });
    code = first.code;
    tokens = mode === 'master' ? [] : [first.token];
    for (let i = tokens.length; i < 4; i++) {
      tokens.push((await joinGame(db, code, { name: `Giocatore ${i}`, pin: '2222' })).token);
    }
    if (mode === 'master') {
      await act(db, code, first.token, { type: 'deal' });
      for (let i = 0; i < 3; i++) await act(db, code, first.token, { type: 'advance' });
    } else {
      await act(db, code, tokens[0], { type: 'deal' });
      await goToStep('envelope');
    }
    return first.token;
  }

  it('aprendo la busta si vede solo il primo documento, il resto arriva dopo', async () => {
    await atFirstEnvelope();
    const start = await stateOf(tokens[1]);
    expect(start.currentEnvelope).toEqual({ id: 'A', shown: 1, total: 3 });
    expect(text(start)).toContain('SEGRETO_DOC_1');
    expect(text(start)).not.toContain('SEGRETO_DOC_2');
    expect(text(start)).not.toContain('SEGRETO_DOC_3');
    await expect(getAsset(db, code, tokens[1], 'foto-a')).rejects.toThrow();

    await act(db, code, tokens[1], { type: 'nextDocument', expected: 1 });
    const second = await stateOf(tokens[2]);
    expect(text(second)).toContain('SEGRETO_DOC_2');
    expect(text(second)).not.toContain('SEGRETO_DOC_3');
    expect((await getAsset(db, code, tokens[2], 'foto-a')).mime).toBe('image/png');
  });

  it('due tocchi insieme non fanno saltare un documento', async () => {
    await atFirstEnvelope();
    await act(db, code, tokens[0], { type: 'nextDocument', expected: 1 });
    await act(db, code, tokens[1], { type: 'nextDocument', expected: 1 });
    expect((await stateOf(tokens[0])).currentEnvelope.shown).toBe(2);
  });

  it('non si avanza finché non sono usciti tutti, e poi la busta resta intera', async () => {
    await atFirstEnvelope();
    await expect(act(db, code, tokens[0], { type: 'ready' })).rejects.toThrow('tutti i documenti');
    await act(db, code, tokens[0], { type: 'nextDocument', expected: 1 });
    await act(db, code, tokens[0], { type: 'nextDocument', expected: 2 });
    await act(db, code, tokens[0], { type: 'nextDocument', expected: 3 });
    expect((await stateOf(tokens[0])).currentEnvelope).toEqual({ id: 'A', shown: 3, total: 3 });
    for (const t of tokens.slice(0, 3)) await act(db, code, t, { type: 'ready' });
    const next = await stateOf(tokens[0]);
    expect(next.currentEnvelope.id).toBe('B');
    expect(next.envelopes[0].documents).toHaveLength(3);
    expect(next.envelopes[1].documents).toHaveLength(1);
  });

  it('con il master i documenti li fa passare solo lui, che li vede già tutti', async () => {
    const master = await atFirstEnvelope('master');
    await expect(act(db, code, tokens[0], { type: 'nextDocument', expected: 1 })).rejects.toThrow('master');
    await expect(act(db, code, master, { type: 'advance' })).rejects.toThrow('tutti i documenti');
    expect(text(await getState(db, code, master))).toContain('SEGRETO_DOC_3');
    expect(text(await stateOf(tokens[0]))).not.toContain('SEGRETO_DOC_2');
    await act(db, code, master, { type: 'nextDocument', expected: 1 });
    expect(text(await stateOf(tokens[0]))).toContain('SEGRETO_DOC_2');
  });
});

describe('con il master', () => {
  it('il master vede tutto e fa avanzare, i giocatori no', async () => {
    const master = await table('master');
    const m = (await getState(db, code, master)) as any;
    expect(text(m)).toContain('SEGRETO_FINALE');
    expect(m.master.culprit).toBe(3);

    await act(db, code, master, { type: 'deal' });
    await expect(act(db, code, tokens[0], { type: 'advance' })).rejects.toThrow();
    await expect(act(db, code, tokens[0], { type: 'ready' })).rejects.toThrow();
    const player = await stateOf(tokens[0]);
    expect(player.master).toBeNull();
    expect(text(player)).not.toContain('SEGRETO_FINALE');

    await act(db, code, master, { type: 'advance' });
    expect((await stateOf(tokens[0])).step).toBe(0);
  });

  it('il master non riceve una scheda', async () => {
    const master = await table('master');
    await act(db, code, master, { type: 'deal' });
    const m = (await getState(db, code, master)) as any;
    expect(m.me.cardNumbers).toEqual([]);
    const dealt = m.players.filter((p: any) => p.role === 'player').flatMap((p: any) => p.cards);
    expect(dealt.sort()).toEqual([1, 2, 3, 4]);
  });
});

describe('tavolo e accessi', () => {
  it('distribuisce tutte le schede con meno o più persone', () => {
    const fewer = dealCards(['a', 'b', 'c'], [1, 2, 3, 4]);
    expect([...fewer.values()].flat().sort()).toEqual([1, 2, 3, 4]);
    expect([...fewer.values()].map((c) => c.length).sort()).toEqual([1, 1, 2]);
    const more = dealCards(['a', 'b', 'c', 'd', 'e', 'f'], [1, 2, 3, 4]);
    expect([...more.values()].filter((c) => c.length === 0)).toHaveLength(2);
  });

  it('rifiuta di distribuire sotto il minimo', async () => {
    await table('nomaster', 2);
    await expect(act(db, code, tokens[0], { type: 'deal' })).rejects.toThrow('almeno 3');
  });

  it('rientra con nome e PIN giusti, non con il PIN sbagliato', async () => {
    await table('nomaster');
    await expect(joinGame(db, code, { name: 'Primo', pin: '9999' })).rejects.toThrow('PIN');
    const back = await joinGame(db, code, { name: 'primo', pin: '1111' });
    expect((await stateOf(back.token)).me.name).toBe('Primo');
  });

  it('blocca i tentativi di PIN ripetuti', async () => {
    await table('nomaster');
    for (let i = 0; i < 5; i++) await joinGame(db, code, { name: 'Primo', pin: '9999' }).catch(() => {});
    await expect(joinGame(db, code, { name: 'Primo', pin: '1111' })).rejects.toThrow('Troppi');
  });

  it('il reset del PIN viene annunciato a tutti', async () => {
    await table('nomaster');
    const target = (await stateOf(tokens[1])).me.id;
    await act(db, code, tokens[0], { type: 'resetPin', playerId: target, pin: '3333' });
    expect((await stateOf(tokens[2])).events.join()).toContain('reimpostato il PIN');
    await expect(joinGame(db, code, { name: 'Giocatore 1', pin: '2222' })).rejects.toThrow();
    await expect(joinGame(db, code, { name: 'Giocatore 1', pin: '3333' })).resolves.toBeTruthy();
  });

  it('chi non è organizzatore non può distribuire né reimpostare PIN', async () => {
    await table('nomaster');
    await expect(act(db, code, tokens[1], { type: 'deal' })).rejects.toThrow();
    const target = (await stateOf(tokens[0])).me.id;
    await expect(act(db, code, tokens[1], { type: 'resetPin', playerId: target, pin: '3333' })).rejects.toThrow();
  });
});
