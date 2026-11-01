# Cena con delitto

App da telefono per giocare cene con delitto tra amici, con o senza master. L'autore dell'app gioca: non deve scoprire nulla.

## Regole anti-spoiler

- Non leggere né stampare in chat `packs-private/`, la parte `secret` di una cena o i PDF segreti nella cartella superiore. Delega a un subagente che riporta solo esiti e conteggi (`docs/FORMATO-CENA.md`).
- `buildView` in `supabase/functions/api/game.ts` è l'unico punto che decide cosa riceve un telefono. Ogni nuovo dato segreto passa da lì e ha un test in `src/lib/game.test.ts`.
- Output di script, log ed errori di validazione non citano mai il contenuto di una cena.
- Le query SQL dirette sul progetto non selezionano mai `packs.secret`, `pack_assets.data` o le risposte in `votes`.
- Il repository è pubblico: niente cene vere, codici o password nei commit.
- Lo storico degli account (`account_dinners`) dice solo quale cena e quando: mai personaggio, voti o soluzione.

## Come è fatta

- `src/`: pagine statiche pubblicate su GitHub Pages. Nessun segreto può stare qui.
- `supabase/functions/api/`: il server, una Edge Function Supabase. Il database è accessibile solo da lì.

## Comandi

- `npm run dev:api` e `npm run dev`: server e pagine in locale, con database su file in `.data/`
- `npm test`: comprende i test sulle fughe di spoiler
- `npm run pack:check -- <file>` e `npm run pack:upload -- <file> <url>` (richiede `ADMIN_TOKEN`). In produzione `<url>` è `https://<progetto>.supabase.co/functions/v1`.

## Produzione

Schema in `db/schema.sql`. La Edge Function va pubblicata con `verify_jwt: false`, perché controlla da sola i codici. I codici di caricamento e del gruppo stanno come impronte SHA-256 in `app_settings`; l'originale del codice di caricamento è in `.env.local`, fuori da git. GitHub Pages si aggiorna a ogni push su `main` e legge l'indirizzo del server dalla variabile di repository `API_URL`.
