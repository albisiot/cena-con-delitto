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

  it('il finale non si apre prima che la maggioranza abbia votato', async () => {
    await table('nomaster');
    await act(db, code, tokens[0], { type: 'deal' });
    await goToStep('vote');
    for (const t of tokens) await expect(act(db, code, t, { type: 'ready' })).rejects.toThrow('Prima vota');
    expect(text(await stateOf(tokens[0]))).not.toContain('SEGRETO_FINALE');
    for (const t of tokens.slice(0, 3)) {
      await act(db, code, t, { type: 'vote', accused: 3, answers: { movente: 'soldi' } });
    }
    await act(db, code, tokens[0], { type: 'ready' });
    await act(db, code, tokens[1], { type: 'ready' });
    expect(text(await stateOf(tokens[0]))).not.toContain('SEGRETO_FINALE');
    await act(db, code, tokens[2], { type: 'ready' });
    const finale = await stateOf(tokens[0]);
    expect(text(finale)).toContain('SEGRETO_FINALE');
    expect(finale.results.find((r: any) => r.name === 'Primo').points).toBe(3);
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
