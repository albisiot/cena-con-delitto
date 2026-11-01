import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { handleRequest, sha256 } from '../supabase/functions/api/router.ts';
import { openPglite } from '../src/lib/db';

// Il server in locale: stesso codice della funzione Supabase, con un database su file in .data/.
const dir = join(process.cwd(), '.data');
mkdirSync(dir, { recursive: true });
const db = await openPglite(join(dir, 'pg'));
await db.query(
  `insert into app_settings (key, value) values ('admin_token_hash', $1)
   on conflict (key) do update set value = excluded.value`,
  [sha256(process.env.ADMIN_TOKEN ?? 'prova-locale')],
);

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && chunks.length > 0;
  const response = await handleRequest(
    new Request(`http://localhost:8787${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: hasBody ? Buffer.concat(chunks) : undefined,
    }),
    async () => db,
  );
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(8787, () => console.log('API locale su http://localhost:8787'));
