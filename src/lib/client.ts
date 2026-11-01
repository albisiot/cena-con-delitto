export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';

export async function api<T = any>(path: string, options: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(API_BASE + path, {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  }).catch(() => {
    throw new Error('Connessione assente. Riprova.');
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'Connessione assente. Riprova.'), { status: res.status });
  return data as T;
}

export type Account = {
  username: string;
  dinners: { packId: string; title: string; role: string; source: string; at: string }[];
};

const ACCOUNT_KEY = 'cena.account';

const tokenKey = (code: string) => `cena.token.${code}`;

function safely<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

// Vale finché resta aperto il sito: alla prossima apertura si può scegliere di nuovo se accedere.
export const chooseGuest = () => safely(() => sessionStorage.setItem('cena.guest', '1'));
export const isGuest = () => safely(() => sessionStorage.getItem('cena.guest')) === '1';

export const loadAccountToken = () => safely(() => localStorage.getItem(ACCOUNT_KEY)) ?? undefined;
export const saveAccountToken = (token: string) => safely(() => localStorage.setItem(ACCOUNT_KEY, token));
export const forgetAccountToken = () => safely(() => localStorage.removeItem(ACCOUNT_KEY));

/** L'account di questo telefono, oppure null. Se la sessione non vale più la dimentica. */
export async function fetchAccount(): Promise<Account | null> {
  const token = loadAccountToken();
  if (!token) return null;
  try {
    return await api<Account>('/api/accounts/me', { token });
  } catch (err) {
    if ((err as { status?: number }).status === 401) forgetAccountToken();
    return null;
  }
}

export const saveSession = (code: string, token: string) =>
  safely(() => {
    localStorage.setItem(tokenKey(code), token);
    localStorage.setItem('cena.last', code);
  });
export const loadToken = (code: string) => safely(() => localStorage.getItem(tokenKey(code)));
export const forgetToken = (code: string) => safely(() => localStorage.removeItem(tokenKey(code)));
export const lastGame = () => safely(() => localStorage.getItem('cena.last'));
export const loadNotes = (code: string) => safely(() => localStorage.getItem(`cena.notes.${code}`)) ?? '';
export const saveNotes = (code: string, text: string) => safely(() => localStorage.setItem(`cena.notes.${code}`, text));
