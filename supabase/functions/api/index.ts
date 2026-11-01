import pg from 'npm:pg@8';
import { handleRequest } from './router.ts';
import type { Db } from './types.ts';

const pool = new pg.Pool({
  connectionString: Deno.env.get('SUPABASE_DB_URL'),
  max: 2,
  idleTimeoutMillis: 10_000,
  ssl: { rejectUnauthorized: false },
});

const db: Db = {
  query: async (sql, params = []) => (await pool.query(sql, params as any[])).rows,
  tx: async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const out = await fn({ query: async (s, p = []) => (await client.query(s, p as any[])).rows });
      await client.query('commit');
      return out;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  },
};

Deno.serve((req) => handleRequest(req, async () => db));
