import pg from 'npm:pg@8';
import { errorKind, retryConnection } from './retry.ts';
import { handleRequest } from './router.ts';
import type { Db } from './types.ts';

const pool = new pg.Pool({
  connectionString: Deno.env.get('SUPABASE_DB_URL'),
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 8_000,
  ssl: { rejectUnauthorized: false },
});

// Senza questo, un collegamento inattivo che cade farebbe crollare l'intero processo con tutte le richieste in corso.
pool.on('error', (err: unknown) => console.error('Collegamento inattivo caduto:', errorKind(err)));

const db: Db = {
  // Le query fuori da una transazione sono letture o scritture ripetibili senza danni.
  query: (sql, params = []) => retryConnection(async () => (await pool.query(sql, params as any[])).rows),
  tx: async (fn) => {
    // Si riprova solo fino a `begin`: una volta iniziato il lavoro, ripetere potrebbe applicarlo due volte.
    const client = await retryConnection(async () => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        return c;
      } catch (err) {
        c.release(true);
        throw err;
      }
    });
    let broken = false;
    try {
      const out = await fn({ query: async (s, p = []) => (await client.query(s, p as any[])).rows });
      await client.query('commit');
      return out;
    } catch (err) {
      await client.query('rollback').catch(() => { broken = true; });
      throw err;
    } finally {
      client.release(broken);
    }
  },
};

Deno.serve((req) => handleRequest(req, async () => db));
