import { Buffer } from 'node:buffer';
import { createHash, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { collectAssets, type Pack, type PackPublic, type PackSecret } from './pack.ts';
import type { Db, Queryable } from './types.ts';

export class GameError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PIN_LOCK_AFTER = 5;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function hashSecret(secret: string, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(secret, salt, 32).toString('hex')}`;
}

export function secretMatches(secret: string, stored: string) {
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(scryptSync(secret, salt, 32), Buffer.from(hash, 'hex'));
}

export async function accountFromToken(q: Queryable, token: unknown) {
  if (typeof token !== 'string' || !token) return null;
  const [row] = await q.query<{ account_id: string }>(
    'select account_id from account_sessions where token_hash = $1', [hashToken(token)],
  );
  return row?.account_id ?? null;
}

function cleanName(name: unknown) {
  const out = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (out.length < 1 || out.length > 30) throw new GameError('Scrivi un nome di massimo 30 caratteri.');
  return out;
}

function cleanPin(pin: unknown) {
  const out = String(pin ?? '');
  if (!/^\d{4}$/.test(out)) throw new GameError('Il PIN deve avere 4 cifre.');
  return out;
}

/** Con un account si rientra da lì, quindi il PIN è facoltativo. */
const pinOrRandom = (pin: unknown, accountId: string | null) =>
  !pin && accountId ? String(randomInt(10000)).padStart(4, '0') : cleanPin(pin);

function shuffle<T>(items: T[]) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Tutte le schede vengono sempre distribuite: chi è in più resta senza scheda, se si è meno qualcuno ne ha due. */
export function dealCards(playerIds: string[], cardNumbers: number[]) {
  const players = shuffle(playerIds);
  const cards = shuffle(cardNumbers);
  const hands = new Map<string, number[]>(players.map((id) => [id, []]));
  cards.forEach((card, i) => hands.get(players[i % players.length])!.push(card));
  return hands;
}

type GameRow = { code: string; pack_id: string; mode: 'master' | 'nomaster'; dealt: boolean; step: number; version: number };
type PlayerRow = {
  id: string; name: string; role: 'player' | 'master'; is_host: boolean; cards: number[]; ready_step: number;
};

async function loadGame(q: Queryable, code: string, lock = false) {
  const rows = await q.query<GameRow>(`select * from games where code = $1${lock ? ' for update' : ''}`, [code]);
  if (!rows[0]) throw new GameError('Partita non trovata.', 404);
  return rows[0];
}

async function loadPack(q: Queryable, id: string) {
  const rows = await q.query<{ title: string; public: PackPublic; secret: PackSecret }>(
    'select title, public, secret from packs where id = $1', [id],
  );
  if (!rows[0]) throw new GameError('Cena non trovata.', 404);
  return rows[0];
}

const bump = (q: Queryable, code: string) => q.query('update games set version = version + 1 where code = $1', [code]);
const logEvent = (q: Queryable, code: string, text: string) =>
  q.query('insert into events (game_code, text) values ($1, $2)', [code, text]);

async function addPlayer(
  q: Queryable, code: string, name: string, pin: string, role: 'player' | 'master', isHost: boolean, accountId: string | null,
) {
  const token = randomBytes(32).toString('base64url');
  const id = randomUUID();
  await q.query(
    `insert into players (id, game_code, name, name_key, pin_hash, token_hash, role, is_host, account_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, code, name, name.toLowerCase(), hashSecret(pin), hashToken(token), role, isHost, accountId],
  );
  return { token, playerId: id };
}

/** La cena conta come fatta da quando si può leggere qualcosa di segreto: da lì in poi non si può più rigiocare alla pari. */
async function recordParticipation(q: Queryable, code: string, packId: string) {
  await q.query(
    `insert into account_dinners (account_id, pack_id, role, source)
     select account_id, $2, role, 'game' from players where game_code = $1 and account_id is not null
     on conflict (account_id, pack_id) do update set source = 'game', role = excluded.role`,
    [code, packId],
  );
}

export async function savePack(db: Db, pack: Pack) {
  await db.tx(async (q) => {
    await q.query(
      `insert into packs (id, title, public, secret) values ($1, $2, $3::jsonb, $4::jsonb)
       on conflict (id) do update set title = excluded.title, public = excluded.public, secret = excluded.secret, updated_at = now()`,
      [pack.id, pack.title, JSON.stringify(pack.public), JSON.stringify(pack.secret)],
    );
    await q.query('delete from pack_assets where pack_id = $1', [pack.id]);
  });
}

export async function saveAsset(db: Db, packId: string, assetId: string, mime: string, base64: string) {
  await db.query(
    `insert into pack_assets (pack_id, asset_id, mime, data) values ($1, $2, $3, $4)
     on conflict (pack_id, asset_id) do update set mime = excluded.mime, data = excluded.data`,
    [packId, assetId, mime, base64],
  );
}

export async function listPacks(db: Db) {
  const rows = await db.query<{ id: string; title: string; public: PackPublic }>(
    'select id, title, public from packs order by updated_at desc',
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    tagline: r.public.tagline,
    players: r.public.players,
    durationMinutes: r.public.durationMinutes,
    theme: r.public.theme,
  }));
}

export async function getPublicPack(db: Db, id: string) {
  const rows = await db.query<{ id: string; title: string; public: PackPublic }>(
    'select id, title, public from packs where id = $1', [id],
  );
  if (!rows[0]) throw new GameError('Cena non trovata.', 404);
  return rows[0];
}

export async function createGame(
  db: Db, input: { packId: string; mode: string; name: unknown; pin?: unknown; accountToken?: unknown },
) {
  const mode = input.mode === 'master' ? 'master' : 'nomaster';
  const name = cleanName(input.name);
  return db.tx(async (q) => {
    const accountId = await accountFromToken(q, input.accountToken);
    const pin = pinOrRandom(input.pin, accountId);
    await loadPack(q, input.packId);
    let code = '';
    for (let tries = 0; tries < 10 && !code; tries++) {
      const candidate = Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      const taken = await q.query('select 1 from games where code = $1', [candidate]);
      if (!taken.length) code = candidate;
    }
    if (!code) throw new GameError('Riprova tra un momento.', 503);
    await q.query('insert into games (code, pack_id, mode) values ($1, $2, $3)', [code, input.packId, mode]);
    const { token } = await addPlayer(q, code, name, pin, mode === 'master' ? 'master' : 'player', true, accountId);
    // Il master vede la soluzione appena la stanza esiste.
    if (mode === 'master') await recordParticipation(q, code, input.packId);
    return { code, token };
  });
}

export async function joinGame(db: Db, code: string, input: { name: unknown; pin?: unknown; accountToken?: unknown }) {
  const name = cleanName(input.name);
  return db.tx(async (q) => {
    const game = await loadGame(q, code, true);
    const accountId = await accountFromToken(q, input.accountToken);
    const reissue = async (playerId: string) => {
      const token = randomBytes(32).toString('base64url');
      await q.query('update players set token_hash = $2, failed_pins = 0, locked_until = null where id = $1', [
        playerId, hashToken(token),
      ]);
      return { code, token };
    };
    if (accountId) {
      const [mine] = await q.query<{ id: string }>(
        'select id from players where game_code = $1 and account_id = $2', [code, accountId],
      );
      if (mine) return reissue(mine.id);
    }
    const [existing] = await q.query<{
      id: string; pin_hash: string; failed_pins: number; locked_until: Date | null; account_id: string | null;
    }>(
      'select id, pin_hash, failed_pins, locked_until, account_id from players where game_code = $1 and name_key = $2',
      [code, name.toLowerCase()],
    );
    if (existing && !input.pin && accountId) {
      throw new GameError('Questo nome è già in partita: scegline un altro.', 409);
    }
    const pin = pinOrRandom(input.pin, accountId);
    const pack = await loadPack(q, game.pack_id);
    const cardsIndex = pack.public.program.findIndex((s) => s.kind === 'cards');
    const secretsOpen = game.step >= cardsIndex;
    if (existing) {
      if (existing.locked_until && new Date(existing.locked_until) > new Date()) {
        throw new GameError('Troppi tentativi: riprova tra qualche minuto.', 429);
      }
      if (!secretMatches(pin, existing.pin_hash)) {
        const failed = existing.failed_pins + 1;
        const lock = failed >= PIN_LOCK_AFTER;
        await q.query(
          `update players set failed_pins = $2,
             locked_until = case when $3::boolean then now() + interval '5 minutes' else null end
           where id = $1`,
          [existing.id, lock ? 0 : failed, lock],
        );
        return { error: 'Questo nome è già in partita e il PIN non corrisponde.' };
      }
      if (accountId && !existing.account_id) {
        await q.query('update players set account_id = $2 where id = $1', [existing.id, accountId]);
        if (secretsOpen) await recordParticipation(q, code, game.pack_id);
      }
      return reissue(existing.id);
    }
    const { token } = await addPlayer(q, code, name, pin, 'player', false, accountId);
    if (secretsOpen) await recordParticipation(q, code, game.pack_id);
    await bump(q, game.code);
    return { code, token };
  }).then((out) => {
    if ('error' in out) throw new GameError(out.error as string, 403);
    return out;
  });
}

async function authenticate(q: Queryable, code: string, token: string | null) {
  if (!token) throw new GameError('Entra di nuovo nella partita.', 401);
  const [player] = await q.query<PlayerRow>(
    'select id, name, role, is_host, cards, ready_step from players where game_code = $1 and token_hash = $2',
    [code, hashToken(token)],
  );
  if (!player) throw new GameError('Entra di nuovo nella partita.', 401);
  return player;
}

const seatedPlayers = (players: PlayerRow[]) => players.filter((p) => p.role === 'player');
const majorityOf = (n: number) => Math.floor(n / 2) + 1;
/** Si avanza a maggioranza, tranne verso il finale: lì devono esserci tutti. */
const readyNeededFor = (nextIsFinale: boolean, seats: number) => (nextIsFinale ? seats : majorityOf(seats));

/**
 * L'unico punto che decide che cosa vede un telefono.
 * Tutto ciò che arriva dalla parte segreta della cena passa da qui, in base al passo raggiunto.
 */
export function buildView(input: {
  game: GameRow;
  pack: { title: string; public: PackPublic; secret: PackSecret };
  me: PlayerRow;
  players: PlayerRow[];
  votes: { player_id: string; accused: number | null; answers: Record<string, string>; award: number | null }[];
  marks: { player_id: string; item: string }[];
  events: { text: string; at: Date | string }[];
  alreadyPlayed: string[];
}) {
  const { game, pack, me, players, votes, marks, events, alreadyPlayed } = input;
  const program = pack.public.program;
  const isMaster = me.role === 'master';
  const stepIndex = (kind: string) => program.findIndex((s) => s.kind === kind);
  const finaleOpen = game.step >= stepIndex('finale');
  const seated = seatedPlayers(players);

  const cardsOpen = game.dealt && game.step >= stepIndex('cards');
  const openedEnvelopes = program
    .slice(0, Math.max(game.step + 1, 0))
    .filter((s) => s.kind === 'envelope')
    .map((s) => s.envelope);

  const myVote = votes.find((v) => v.player_id === me.id);

  const view: Record<string, unknown> = {
    code: game.code,
    version: game.version,
    mode: game.mode,
    packId: game.pack_id,
    title: pack.title,
    public: pack.public,
    dealt: game.dealt,
    step: game.step,
    me: {
      id: me.id,
      name: me.name,
      role: me.role,
      isHost: me.is_host,
      cardNumbers: me.cards,
      ready: me.ready_step === game.step,
      assistant: game.dealt && me.role === 'player' && me.cards.length === 0,
    },
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      isHost: p.is_host,
      cards: p.cards,
      ready: p.ready_step === game.step,
      voted: votes.some((v) => v.player_id === p.id),
      // Solo prima di iniziare: dopo, la partita stessa finisce nello storico di tutti.
      alreadyPlayed: !game.dealt && alreadyPlayed.includes(p.id),
    })),
    readyNeeded: readyNeededFor(game.step + 1 === stepIndex('finale'), seated.length),
    myVote: myVote ? { accused: myVote.accused, answers: myVote.answers, award: myVote.award } : null,
    events: events.map((e) => e.text),
    cards: cardsOpen ? me.cards.map((n) => ({ n, blocks: pack.secret.cards[String(n)] })) : [],
    envelopes: pack.secret.envelopes.filter((env) => openedEnvelopes.includes(env.id)),
    finale: finaleOpen ? pack.secret.finale : null,
    results: null,
    allCards: null,
    master: null,
  };

  if (finaleOpen) {
    const culprit = pack.secret.solution.culprit;
    view.culprit = culprit;
    view.allCards = pack.public.cast.map((c) => ({ n: c.n, blocks: pack.secret.cards[String(c.n)] }));
    view.results = seated.map((p) => {
      const vote = votes.find((v) => v.player_id === p.id);
      const own = marks.filter((m) => m.player_id === p.id).map((m) => m.item);
      const fieldPoints = pack.public.vote.fields
        .filter((f) => own.includes(f.id))
        .reduce((sum, f) => sum + f.points, 0);
      const mission = own.includes('mission') ? pack.public.vote.missionPoints ?? 0 : 0;
      const accusedRight = vote?.accused === culprit;
      return {
        playerId: p.id,
        name: p.name,
        accused: vote?.accused ?? null,
        answers: vote?.answers ?? {},
        award: vote?.award ?? null,
        accusedRight,
        marks: own,
        points: (accusedRight ? pack.public.vote.accusedPoints : 0) + fieldPoints + mission,
      };
    });
  }

  if (isMaster) {
    view.master = {
      cards: pack.secret.cards,
      envelopes: pack.secret.envelopes,
      finale: pack.secret.finale,
      culprit: pack.secret.solution.culprit,
      votes,
    };
  }
  return view;
}

async function loadView(q: Queryable, code: string, me: PlayerRow) {
  const game = await loadGame(q, code);
  const pack = await loadPack(q, game.pack_id);
  const players = await q.query<PlayerRow>(
    'select id, name, role, is_host, cards, ready_step from players where game_code = $1 order by joined_at', [code],
  );
  const votes = await q.query<any>('select player_id, accused, answers, award from votes where game_code = $1', [code]);
  const marks = await q.query<any>('select player_id, item from score_marks where game_code = $1', [code]);
  const events = await q.query<any>('select text, at from events where game_code = $1 order by id desc limit 20', [code]);
  const played = await q.query<{ id: string }>(
    `select p.id from players p join account_dinners d on d.account_id = p.account_id and d.pack_id = $2
     where p.game_code = $1 and p.role = 'player'`,
    [code, game.pack_id],
  );
  return buildView({ game, pack, me, players, votes, marks, events, alreadyPlayed: played.map((r) => r.id) });
}

export async function getState(db: Db, code: string, token: string | null, knownVersion?: number) {
  const me = await authenticate(db, code, token);
  if (knownVersion !== undefined) {
    const [row] = await db.query<{ version: number }>('select version from games where code = $1', [code]);
    if (row?.version === knownVersion) return { unchanged: true };
  }
  return loadView(db, code, me);
}

/** Un'immagine si può scaricare solo se compare in ciò che quel telefono può già vedere. */
export async function getAsset(db: Db, code: string, token: string | null, assetId: string) {
  const me = await authenticate(db, code, token);
  const view = await loadView(db, code, me);
  if (!collectAssets(view).has(assetId)) throw new GameError('Non disponibile.', 404);
  return readAsset(db, view.packId as string, assetId);
}

export async function getPublicAsset(db: Db, packId: string, assetId: string) {
  const pack = await getPublicPack(db, packId);
  const allowed = collectAssets(pack.public);
  if (pack.public.cover) allowed.add(pack.public.cover);
  if (!allowed.has(assetId)) throw new GameError('Non disponibile.', 404);
  return readAsset(db, packId, assetId);
}

async function readAsset(db: Db, packId: string, assetId: string) {
  const [row] = await db.query<{ mime: string; data: string }>(
    'select mime, data from pack_assets where pack_id = $1 and asset_id = $2', [packId, assetId],
  );
  if (!row) throw new GameError('Non disponibile.', 404);
  return { mime: row.mime, body: Buffer.from(row.data, 'base64') };
}

async function moveToStep(q: Queryable, game: GameRow, pack: { public: PackPublic }, next: number) {
  await q.query('update games set step = $2 where code = $1', [game.code, next]);
  if (next >= pack.public.program.findIndex((s) => s.kind === 'cards')) {
    await recordParticipation(q, game.code, game.pack_id);
  }
  await logEvent(q, game.code, `Si passa a: ${pack.public.program[next].title}`);
}

export async function act(db: Db, code: string, token: string | null, action: any) {
  await db.tx(async (q) => {
    const game = await loadGame(q, code, true);
    const me = await authenticate(q, code, token);
    const pack = await loadPack(q, game.pack_id);
    const program = pack.public.program;
    const players = await q.query<PlayerRow>(
      'select id, name, role, is_host, cards, ready_step from players where game_code = $1', [code],
    );
    const seated = seatedPlayers(players);
    const finaleIndex = program.findIndex((s) => s.kind === 'finale');
    const voteIndex = program.findIndex((s) => s.kind === 'vote');
    const castNumbers = pack.public.cast.map((c) => c.n);
    const isOrganizer = me.role === 'master' || (game.mode === 'nomaster' && me.is_host);

    switch (action?.type) {
      case 'deal': {
        if (!isOrganizer) throw new GameError('Solo chi ha creato la partita può distribuire i ruoli.', 403);
        if (game.dealt) throw new GameError('I ruoli sono già stati distribuiti.');
        if (seated.length < pack.public.players.min) {
          throw new GameError(`Servono almeno ${pack.public.players.min} persone.`);
        }
        const hands = dealCards(seated.map((p) => p.id), castNumbers);
        for (const [id, cards] of hands) {
          await q.query('update players set cards = $2::int[] where id = $1', [id, cards]);
        }
        await q.query('update games set dealt = true where code = $1', [code]);
        await logEvent(q, code, 'I personaggi sono stati assegnati.');
        break;
      }
      case 'ready': {
        if (me.role !== 'player') throw new GameError('Il master avanza direttamente.');
        if (game.mode === 'master') throw new GameError('In questa partita decide il master.');
        if (!game.dealt) throw new GameError('Prima si distribuiscono i ruoli.');
        if (game.step >= finaleIndex) throw new GameError('La serata è già al finale.');
        // Al voto "avanti" vale solo dopo aver votato, e il finale aspetta tutti: nessuno perde il voto.
        if (game.step === voteIndex) {
          const voted = await q.query('select 1 from votes where game_code = $1 and player_id = $2', [code, me.id]);
          if (!voted.length) throw new GameError('Prima vota.');
        }
        await q.query('update players set ready_step = $2 where id = $1', [me.id, game.step]);
        const readyCount = seated.filter((p) => p.id === me.id || p.ready_step === game.step).length;
        if (readyCount >= readyNeededFor(game.step + 1 === finaleIndex, seated.length)) {
          await moveToStep(q, game, pack, game.step + 1);
        }
        break;
      }
      case 'forceFinale': {
        // Uscita di emergenza se qualcuno non può più rispondere: tutti vedono chi l'ha usata e chi mancava.
        if (game.mode !== 'nomaster' || !me.is_host) throw new GameError('Solo chi ha creato la stanza può farlo.', 403);
        if (game.step !== voteIndex) throw new GameError('Ora non si può aprire il finale.');
        const voted = await q.query('select 1 from votes where game_code = $1 and player_id = $2', [code, me.id]);
        if (!voted.length) throw new GameError('Prima vota.');
        const missing = seated.filter((p) => p.id !== me.id && p.ready_step !== game.step).map((p) => p.name);
        await moveToStep(q, game, pack, finaleIndex);
        await logEvent(q, code, `Attenzione: ${me.name} ha aperto il finale senza aspettare ${missing.join(', ') || 'nessuno'}.`);
        break;
      }
      case 'advance': {
        if (me.role !== 'master') throw new GameError('Solo il master può avanzare.', 403);
        if (!game.dealt) throw new GameError('Prima si distribuiscono i ruoli.');
        if (game.step >= finaleIndex) throw new GameError('La serata è già al finale.');
        await moveToStep(q, game, pack, game.step + 1);
        break;
      }
      case 'vote': {
        if (me.role !== 'player') throw new GameError('Il master non vota.');
        if (game.step !== voteIndex) throw new GameError('Ora non si vota.');
        const assistant = me.cards.length === 0;
        const accused = assistant ? null : Number(action.accused);
        if (!assistant && !castNumbers.includes(accused as number)) throw new GameError('Scegli chi accusare.');
        const answers: Record<string, string> = {};
        if (!assistant) {
          for (const f of pack.public.vote.fields) answers[f.id] = String(action.answers?.[f.id] ?? '').slice(0, 2000);
        }
        const award = action.award === undefined || action.award === null ? null : Number(action.award);
        if (award !== null && !castNumbers.includes(award)) throw new GameError('Scelta del premio non valida.');
        await q.query(
          `insert into votes (game_code, player_id, accused, answers, award) values ($1, $2, $3, $4::jsonb, $5)
           on conflict (game_code, player_id) do update
           set accused = excluded.accused, answers = excluded.answers, award = excluded.award`,
          [code, me.id, accused, JSON.stringify(answers), award],
        );
        break;
      }
      case 'mark': {
        if (game.step < finaleIndex) throw new GameError('I punti si assegnano al finale.');
        if (game.mode === 'master' && me.role !== 'master') throw new GameError('I punti li assegna il master.', 403);
        const validItems = [...pack.public.vote.fields.map((f) => f.id), 'mission'];
        if (!validItems.includes(action.item) || !seated.some((p) => p.id === action.playerId)) {
          throw new GameError('Punto non valido.');
        }
        if (action.on) {
          await q.query(
            'insert into score_marks (game_code, player_id, item) values ($1, $2, $3) on conflict do nothing',
            [code, action.playerId, action.item],
          );
        } else {
          await q.query('delete from score_marks where game_code = $1 and player_id = $2 and item = $3', [
            code, action.playerId, action.item,
          ]);
        }
        break;
      }
      case 'resetPin': {
        if (!isOrganizer) throw new GameError('Solo chi ha creato la partita può farlo.', 403);
        const target = players.find((p) => p.id === action.playerId);
        if (!target) throw new GameError('Persona non trovata.');
        await q.query(
          'update players set pin_hash = $2, token_hash = $3, failed_pins = 0, locked_until = null where id = $1',
          [target.id, hashSecret(cleanPin(action.pin)), hashToken(randomBytes(32).toString('base64url'))],
        );
        // Annuncio pubblico: reimpostare un PIN permetterebbe di sbirciare la scheda altrui.
        await logEvent(q, code, `Attenzione: ${me.name} ha reimpostato il PIN di ${target.name}.`);
        break;
      }
      default:
        throw new GameError('Azione sconosciuta.');
    }
    await bump(q, code);
  });
  return getState(db, code, token);
}
