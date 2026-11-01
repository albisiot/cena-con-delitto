import { randomBytes, randomUUID } from 'node:crypto';
import { accountFromToken, GameError, hashSecret, hashToken, secretMatches } from './game.ts';
import type { Db, Queryable } from './types.ts';

const LOCK_AFTER = 5;

function cleanUsername(value: unknown) {
  const out = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(out)) {
    throw new GameError('Il nome utente deve avere da 3 a 30 caratteri: lettere, numeri, punti e trattini.');
  }
  return out;
}

function cleanPassword(value: unknown) {
  const out = String(value ?? '');
  if (out.length < 8 || out.length > 200) throw new GameError('La password deve avere almeno 8 caratteri.');
  return out;
}

const newRecoveryCode = () => randomBytes(9).toString('base64url');

async function openSession(q: Queryable, accountId: string) {
  const token = randomBytes(32).toString('base64url');
  await q.query('insert into account_sessions (token_hash, account_id) values ($1, $2)', [hashToken(token), accountId]);
  return token;
}

export async function register(db: Db, input: { username: unknown; password: unknown }) {
  const username = cleanUsername(input.username);
  const password = cleanPassword(input.password);
  return db.tx(async (q) => {
    const taken = await q.query('select 1 from accounts where username = $1', [username]);
    if (taken.length) throw new GameError('Questo nome utente esiste già.', 409);
    const id = randomUUID();
    const recoveryCode = newRecoveryCode();
    await q.query(
      'insert into accounts (id, username, password_hash, recovery_hash) values ($1, $2, $3, $4)',
      [id, username, hashSecret(password), hashSecret(recoveryCode)],
    );
    return { username, recoveryCode, token: await openSession(q, id) };
  });
}

type AccountRow = {
  id: string; username: string; password_hash: string; recovery_hash: string;
  failed_logins: number; locked_until: Date | string | null;
};

/** Stesso messaggio per nome inesistente e segreto sbagliato: non si scopre chi ha un account. */
async function checkSecret(db: Db, username: string, column: 'password_hash' | 'recovery_hash', secret: string) {
  return db.tx(async (q) => {
    const [account] = await q.query<AccountRow>('select * from accounts where username = $1 for update', [username]);
    const wrong = new GameError('Nome utente o codice errati.', 401);
    if (!account) return { error: wrong };
    if (account.locked_until && new Date(account.locked_until) > new Date()) {
      return { error: new GameError('Troppi tentativi: riprova tra qualche minuto.', 429) };
    }
    if (!secretMatches(secret, account[column])) {
      const failed = account.failed_logins + 1;
      const lock = failed >= LOCK_AFTER;
      await q.query(
        `update accounts set failed_logins = $2,
           locked_until = case when $3::boolean then now() + interval '5 minutes' else null end
         where id = $1`,
        [account.id, lock ? 0 : failed, lock],
      );
      return { error: wrong };
    }
    await q.query('update accounts set failed_logins = 0, locked_until = null where id = $1', [account.id]);
    return { account };
  });
}

export async function login(db: Db, input: { username: unknown; password: unknown }) {
  const username = cleanUsername(input.username);
  const { account, error } = await checkSecret(db, username, 'password_hash', String(input.password ?? ''));
  if (error) throw error;
  return db.tx(async (q) => ({ username, token: await openSession(q, account!.id) }));
}

/** Il codice di recupero vale una volta sola: chi lo usa ne riceve uno nuovo e gli altri telefoni escono. */
export async function recover(db: Db, input: { username: unknown; recoveryCode: unknown; newPassword: unknown }) {
  const username = cleanUsername(input.username);
  const password = cleanPassword(input.newPassword);
  const { account, error } = await checkSecret(db, username, 'recovery_hash', String(input.recoveryCode ?? '').trim());
  if (error) throw error;
  const recoveryCode = newRecoveryCode();
  return db.tx(async (q) => {
    await q.query('update accounts set password_hash = $2, recovery_hash = $3 where id = $1', [
      account!.id, hashSecret(password), hashSecret(recoveryCode),
    ]);
    await q.query('delete from account_sessions where account_id = $1', [account!.id]);
    return { username, recoveryCode, token: await openSession(q, account!.id) };
  });
}

async function requireAccount(db: Db, token: string | null) {
  const account = await accountFromToken(db, token);
  if (!account) throw new GameError('Accedi di nuovo.', 401);
  return account;
}

export async function logout(db: Db, token: string | null) {
  if (token) await db.query('delete from account_sessions where token_hash = $1', [hashToken(token)]);
  return { ok: true };
}

export async function me(db: Db, token: string | null) {
  const accountId = await requireAccount(db, token);
  const [account] = await db.query<{ username: string }>('select username from accounts where id = $1', [accountId]);
  const dinners = await db.query<{ pack_id: string; title: string; role: string; source: string; at: string }>(
    `select d.pack_id, p.title, d.role, d.source, d.at from account_dinners d
     join packs p on p.id = d.pack_id where d.account_id = $1 order by d.at desc`,
    [accountId],
  );
  return {
    username: account.username,
    dinners: dinners.map((d) => ({ packId: d.pack_id, title: d.title, role: d.role, source: d.source, at: d.at })),
  };
}

/** Per le cene giocate fuori dall'app. Quelle registrate da una partita non si possono togliere. */
export async function markDinner(db: Db, token: string | null, input: { packId: unknown; played: unknown }) {
  const accountId = await requireAccount(db, token);
  const packId = String(input.packId ?? '');
  if (input.played) {
    const exists = await db.query('select 1 from packs where id = $1', [packId]);
    if (!exists.length) throw new GameError('Cena non trovata.', 404);
    await db.query(
      `insert into account_dinners (account_id, pack_id, role, source) values ($1, $2, 'player', 'manual')
       on conflict (account_id, pack_id) do nothing`,
      [accountId, packId],
    );
  } else {
    await db.query(`delete from account_dinners where account_id = $1 and pack_id = $2 and source = 'manual'`, [
      accountId, packId,
    ]);
  }
  return me(db, token);
}
