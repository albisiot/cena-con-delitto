import { createHash } from 'node:crypto';
import { login, logout, markDinner, me, recover, register } from './accounts.ts';
import {
  act, createGame, GameError, getAsset, getPublicAsset, getPublicPack, getState, joinGame, listPacks, saveAsset, savePack,
} from './game.ts';
import { packSummary, validatePack, type Pack } from './pack.ts';
import type { Db } from './types.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const image = (asset: { mime: string; body: Uint8Array }) =>
  new Response(new Uint8Array(asset.body), {
    headers: { ...CORS, 'Content-Type': asset.mime, 'Cache-Control': 'private, max-age=3600' },
  });

function bearer(req: Request) {
  const header = req.headers.get('authorization');
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

async function setting(db: Db, key: string) {
  const [row] = await db.query<{ value: string }>('select value from app_settings where key = $1', [key]);
  return row?.value ?? null;
}

async function requireAdmin(req: Request, db: Db) {
  const expected = await setting(db, 'admin_token_hash');
  const given = bearer(req);
  if (!expected || !given || sha256(given) !== expected) throw new GameError('Codice di caricamento errato.', 401);
}

/** Senza un codice del gruppo impostato (sviluppo locale) chiunque può aprire una partita. */
async function requireGroupCode(db: Db, given: unknown) {
  const expected = await setting(db, 'group_code_hash');
  if (expected && sha256(String(given ?? '')) !== expected) throw new GameError('Codice del gruppo errato.', 403);
}

async function body(req: Request) {
  try {
    return await req.json();
  } catch {
    throw new GameError('Richiesta non valida.');
  }
}

async function dispatch(req: Request, db: Db) {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^.*?\/api(?=\/|$)/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const route = `${req.method} ${parts.map((p, i) => (i % 2 ? ':' : p)).join('/')}`;
  const [, second, , fourth] = parts;

  switch (route) {
    case 'GET packs':
      return json(await listPacks(db));
    case 'GET packs/:':
      return json(await getPublicPack(db, second));
    case 'GET packs/:/assets/:':
      return image(await getPublicAsset(db, second, fourth));
    case 'POST games': {
      const input = await body(req);
      await requireGroupCode(db, input.groupCode);
      return json(await createGame(db, input), 201);
    }
    case 'POST games/:/join':
      return json(await joinGame(db, second.toUpperCase(), await body(req)));
    case 'GET games/:/state': {
      const known = url.searchParams.get('v');
      return json(await getState(db, second.toUpperCase(), bearer(req), known ? Number(known) : undefined));
    }
    case 'POST games/:/action':
      return json(await act(db, second.toUpperCase(), bearer(req), await body(req)));
    case 'GET games/:/assets/:':
      return image(await getAsset(db, second.toUpperCase(), bearer(req), fourth));
  }

  switch (`${req.method} ${parts.join('/')}`) {
    case 'POST accounts':
      return json(await register(db, await body(req)), 201);
    case 'POST accounts/login':
      return json(await login(db, await body(req)));
    case 'POST accounts/recover':
      return json(await recover(db, await body(req)));
    case 'POST accounts/logout':
      return json(await logout(db, bearer(req)));
    case 'GET accounts/me':
      return json(await me(db, bearer(req)));
    case 'POST accounts/dinners':
      return json(await markDinner(db, bearer(req), await body(req)));
  }

  if (req.method === 'PUT' && parts.join('/') === 'admin/packs') {
    await requireAdmin(req, db);
    // Le immagini arrivano a parte, una alla volta: `assetIds` serve solo a validare i riferimenti.
    const { assetIds = [], ...pack } = (await body(req)) as Pack & { assetIds?: string[] };
    const assets = Object.fromEntries(assetIds.map((id) => [id, { mime: 'image/png', base64: '' }]));
    const errors = validatePack({ ...pack, assets });
    if (errors.length) throw new GameError(`Cena non valida: ${errors.slice(0, 5).join('; ')}`);
    await savePack(db, pack);
    return json(packSummary({ ...pack, assets }));
  }

  if (req.method === 'POST' && parts[0] === 'admin' && parts[1] === 'packs' && parts[3] === 'assets' && parts.length === 4) {
    await requireAdmin(req, db);
    const { assetId, mime, base64 } = await body(req);
    if (!assetId || !/^image\/(png|jpeg|webp|gif)$/.test(mime) || !base64) throw new GameError('Immagine non valida.');
    await saveAsset(db, parts[2], assetId, mime, base64);
    return json({ ok: true });
  }

  throw new GameError('Non trovato.', 404);
}

export async function handleRequest(req: Request, getDb: () => Promise<Db>): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    return await dispatch(req, await getDb());
  } catch (err) {
    if (err instanceof GameError) return json({ error: err.message }, err.status);
    // Nei log solo il tipo di errore: i messaggi del database potrebbero citare il contenuto di una cena.
    console.error(err instanceof Error ? err.name : 'Errore sconosciuto');
    return json({ error: 'Qualcosa è andato storto. Riprova.' }, 500);
  }
}
