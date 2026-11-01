/** Tipo di errore senza il messaggio: i messaggi del database potrebbero citare il contenuto di una cena. */
export function errorKind(err: unknown) {
  const e = err as { code?: unknown; name?: unknown };
  return String(e?.code ?? e?.name ?? 'sconosciuto');
}

/**
 * Vero se è caduto il collegamento, non se la richiesta era sbagliata.
 * I codici Postgres delle classi 08, 53 e 57 riguardano connessioni e risorse; XX000 è anche l'errore del pooler di Supabase.
 * Gli errori senza un codice di cinque caratteri arrivano dal driver o dalla rete.
 */
export function isConnectionError(err: unknown) {
  const code = (err as { code?: unknown })?.code;
  if (typeof code !== 'string' || code.length !== 5) return true;
  return /^(08|53|57)/.test(code) || code === 'XX000';
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Riprova solo se è caduto il collegamento. Va usato dove ripetere non può applicare due volte una modifica. */
export async function retryConnection<T>(fn: () => Promise<T>, attempts = 6, delayMs = 200): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !isConnectionError(err)) throw err;
      await wait(delayMs * attempt);
    }
  }
}
