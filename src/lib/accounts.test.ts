import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { login, markDinner, me, recover, register } from '../../supabase/functions/api/accounts.ts';
import { act, createGame, getState, joinGame, savePack } from '../../supabase/functions/api/game.ts';
import type { Db } from '../../supabase/functions/api/types.ts';
import { openPglite } from './db';

const pack = JSON.parse(readFileSync('examples/prova.pack.json', 'utf8'));
let db: Db;

const signUp = (username: string) => register(db, { username, password: 'password-lunga' });
const dinnersOf = async (token: string) => (await me(db, token)).dinners.map((d) => d.packId);

beforeEach(async () => {
  db = await openPglite();
  await savePack(db, pack);
});

describe('account', () => {
  it('registra, accede e rifiuta i dati sbagliati', async () => {
    await signUp('Ada');
    await expect(signUp('ada')).rejects.toThrow('esiste già');
    expect((await login(db, { username: 'ADA', password: 'password-lunga' })).username).toBe('ada');
    await expect(login(db, { username: 'ada', password: 'sbagliata-sbagliata' })).rejects.toThrow('errati');
    await expect(login(db, { username: 'nessuno', password: 'password-lunga' })).rejects.toThrow('errati');
    await expect(register(db, { username: 'corto', password: '123' })).rejects.toThrow('almeno 8');
  });

  it('non conserva password né codici in chiaro', async () => {
    const { recoveryCode } = await signUp('ada');
    const raw = JSON.stringify(await db.query('select * from accounts'));
    expect(raw).not.toContain('password-lunga');
    expect(raw).not.toContain(recoveryCode);
  });

  it('blocca i tentativi di password ripetuti', async () => {
    await signUp('ada');
    for (let i = 0; i < 5; i++) await login(db, { username: 'ada', password: 'sbagliata-sbagliata' }).catch(() => {});
    await expect(login(db, { username: 'ada', password: 'password-lunga' })).rejects.toThrow('Troppi');
  });

  it('il codice di recupero cambia la password, vale una volta e chiude le altre sessioni', async () => {
    const first = await signUp('ada');
    const out = await recover(db, { username: 'ada', recoveryCode: first.recoveryCode, newPassword: 'nuova-password' });
    await expect(me(db, first.token)).rejects.toThrow();
    expect((await login(db, { username: 'ada', password: 'nuova-password' })).username).toBe('ada');
    await expect(recover(db, { username: 'ada', recoveryCode: first.recoveryCode, newPassword: 'altra-password' })).rejects.toThrow();
    expect(out.recoveryCode).not.toBe(first.recoveryCode);
  });
});

describe('cene già fatte', () => {
  async function table(accountToken: string) {
    const host = await createGame(db, { packId: pack.id, mode: 'nomaster', name: 'Ada', accountToken });
    const others = [];
    for (const name of ['Bruno', 'Carla']) others.push((await joinGame(db, host.code, { name, pin: '1111' })).token);
    return { code: host.code, tokens: [host.token, ...others] };
  }

  it('si registra quando si apre la scheda, non prima', async () => {
    const { token } = await signUp('ada');
    const { code, tokens } = await table(token);
    await act(db, code, tokens[0], { type: 'deal' });
    expect(await dinnersOf(token)).toEqual([]);
    await act(db, code, tokens[0], { type: 'ready' });
    await act(db, code, tokens[1], { type: 'ready' });
    expect(await dinnersOf(token)).toEqual([pack.id]);
  });

  it('il master la conta subito', async () => {
    const { token } = await signUp('regia');
    await createGame(db, { packId: pack.id, mode: 'master', name: 'Regia', accountToken: token });
    expect((await me(db, token)).dinners[0].role).toBe('master');
  });

  it('avvisa il tavolo prima di iniziare, senza contare il master', async () => {
    const ada = await signUp('ada');
    await markDinner(db, ada.token, { packId: pack.id, played: true });
    const { code, tokens } = await table(ada.token);
    const lobby = (await getState(db, code, tokens[1])) as any;
    expect(lobby.players.find((p: any) => p.name === 'Ada').alreadyPlayed).toBe(true);
    expect(lobby.players.find((p: any) => p.name === 'Bruno').alreadyPlayed).toBe(false);
  });

  it('il segno a mano si toglie, quello di una partita no', async () => {
    const { token } = await signUp('ada');
    await markDinner(db, token, { packId: pack.id, played: true });
    await markDinner(db, token, { packId: pack.id, played: false });
    expect(await dinnersOf(token)).toEqual([]);

    const { code, tokens } = await table(token);
    await act(db, code, tokens[0], { type: 'deal' });
    await act(db, code, tokens[0], { type: 'ready' });
    await act(db, code, tokens[1], { type: 'ready' });
    await markDinner(db, token, { packId: pack.id, played: false });
    expect(await dinnersOf(token)).toEqual([pack.id]);
  });

  it('con l\'account si rientra senza PIN', async () => {
    const { token } = await signUp('ada');
    const { code } = await table(token);
    const { token: again } = await login(db, { username: 'ada', password: 'password-lunga' });
    const back = await joinGame(db, code, { name: 'Altro nome', accountToken: again });
    expect(((await getState(db, code, back.token)) as any).me.name).toBe('Ada');
  });

  it('un nome occupato da altri non si prende con l\'account', async () => {
    const ada = await signUp('ada');
    const { code } = await table(ada.token);
    const bruno = await signUp('bruno');
    await expect(joinGame(db, code, { name: 'Bruno', accountToken: bruno.token })).rejects.toThrow('già in partita');
  });

  it('lo storico non contiene nulla di segreto', async () => {
    const { token } = await signUp('ada');
    const { code, tokens } = await table(token);
    await act(db, code, tokens[0], { type: 'deal' });
    await act(db, code, tokens[0], { type: 'ready' });
    await act(db, code, tokens[1], { type: 'ready' });
    const raw = JSON.stringify(await me(db, token));
    expect(raw).not.toContain('Hai rubato');
    expect(raw).not.toContain('culprit');
    expect(raw).not.toContain('cards');
  });

  it('senza account si gioca come prima', async () => {
    const guest = await createGame(db, { packId: pack.id, mode: 'nomaster', name: 'Ospite', pin: '1234' });
    await expect(joinGame(db, guest.code, { name: 'Senza pin' })).rejects.toThrow('PIN');
  });
});
