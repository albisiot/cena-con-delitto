import { beforeEach, describe, expect, it } from 'vitest';
import { handleRequest, sha256 } from '../../supabase/functions/api/router.ts';
import type { Db } from '../../supabase/functions/api/types.ts';
import { readFileSync } from 'node:fs';
import { openPglite } from './db';

const pack = JSON.parse(readFileSync('examples/prova.pack.json', 'utf8'));
const base = 'https://esempio.supabase.co/functions/v1/api';
let db: Db;

const call = (path: string, init: RequestInit = {}) =>
  handleRequest(new Request(base + path, init), async () => db);
const send = (path: string, body: unknown, token?: string, method = 'POST') =>
  call(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  db = await openPglite();
  await db.query(`insert into app_settings (key, value) values ('admin_token_hash', $1)`, [sha256('carica')]);
  await send('/admin/packs', pack, 'carica', 'PUT');
});

describe('server', () => {
  it('permette le chiamate dalle pagine ospitate altrove', async () => {
    const res = await call('/packs', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')).toContain('authorization');
    expect((await call('/packs')).headers.get('access-control-allow-origin')).toBe('*');
  });

  it('non carica cene senza il codice giusto', async () => {
    expect((await send('/admin/packs', pack, 'sbagliato', 'PUT')).status).toBe(401);
    expect((await send('/admin/packs', pack, undefined, 'PUT')).status).toBe(401);
    expect((await send('/admin/packs/cena-di-prova/assets', {}, 'sbagliato')).status).toBe(401);
  });

  it('il catalogo e la pagina pubblica non contengono la parte segreta', async () => {
    const list = await (await call('/packs')).text();
    const detail = await (await call('/packs/cena-di-prova')).text();
    for (const raw of [list, detail]) {
      expect(raw).not.toContain('Hai rubato');
      expect(raw).not.toContain('culprit');
    }
  });

  it('richiede il codice del gruppo quando è impostato', async () => {
    await db.query(`insert into app_settings (key, value) values ('group_code_hash', $1)`, [sha256('amici')]);
    const input = { packId: 'cena-di-prova', mode: 'nomaster', name: 'Ada', pin: '1234' };
    expect((await send('/games', input)).status).toBe(403);
    expect((await send('/games', { ...input, groupCode: 'amici' })).status).toBe(201);
  });

  it('gioca attraverso gli indirizzi veri', async () => {
    const { code, token } = await (await send('/games', { packId: 'cena-di-prova', mode: 'nomaster', name: 'Ada', pin: '1234' })).json();
    const state = await call(`/games/${code.toLowerCase()}/state`, { headers: { Authorization: `Bearer ${token}` } });
    expect((await state.json()).me.name).toBe('Ada');
    expect((await call(`/games/${code}/state`)).status).toBe(401);
    expect((await call('/inesistente')).status).toBe(404);
  });
});
