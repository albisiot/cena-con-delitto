import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../../supabase/functions/api/types.ts';

/** Database su file o in memoria, per sviluppo locale e test. In produzione c'è Postgres di Supabase. */
export async function openPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const lite = new PGlite(dataDir);
  await lite.exec(readFileSync(join(process.cwd(), 'db', 'schema.sql'), 'utf8'));
  return {
    query: async (sql, params = []) => (await lite.query(sql, params as any[])).rows as any[],
    tx: (fn) =>
      lite.transaction((t) =>
        fn({ query: async (s, p = []) => (await t.query(s, p as any[])).rows as any[] }),
      ) as Promise<any>,
  };
}
