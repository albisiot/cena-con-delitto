import { describe, expect, it } from 'vitest';
import { errorKind, isConnectionError, retryConnection } from '../../supabase/functions/api/retry.ts';
import { handleRequest } from '../../supabase/functions/api/router.ts';

const failing = (code?: string) => Object.assign(new Error('SEGRETO_NEL_MESSAGGIO'), code ? { code } : {});

describe('nuovi tentativi sul database', () => {
  it('distingue un collegamento caduto da una richiesta sbagliata', () => {
    for (const code of ['53300', '08006', '57P01', 'XX000', 'ECONNRESET', undefined]) {
      expect(isConnectionError(failing(code))).toBe(true);
    }
    for (const code of ['23505', '42P01', '22P02']) expect(isConnectionError(failing(code))).toBe(false);
  });

  it('riprova se cade il collegamento e poi riesce', async () => {
    let calls = 0;
    const out = await retryConnection(async () => {
      if (++calls < 3) throw failing('53300');
      return 'ok';
    }, 4, 1);
    expect(out).toBe('ok');
    expect(calls).toBe(3);
  });

  it('non riprova una richiesta sbagliata', async () => {
    let calls = 0;
    await expect(retryConnection(async () => { calls++; throw failing('23505'); }, 4, 1)).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('alla fine si arrende', async () => {
    let calls = 0;
    await expect(retryConnection(async () => { calls++; throw failing('53300'); }, 3, 1)).rejects.toThrow();
    expect(calls).toBe(3);
  });

  it('la risposta di errore dice il tipo ma non il messaggio', async () => {
    expect(errorKind(failing('53300'))).toBe('53300');
    const res = await handleRequest(new Request('https://esempio/api/packs'), async () => {
      throw failing('53300');
    });
    const raw = await res.text();
    expect(res.status).toBe(500);
    expect(raw).toContain('53300');
    expect(raw).not.toContain('SEGRETO');
  });
});
