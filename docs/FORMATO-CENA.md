# Formato di una cena

Una cena è un solo file JSON. I tipi esatti sono in `src/lib/pack.ts` e `examples/prova.pack.json` è un esempio completo.

```bash
npm run pack:check -- percorso/cena.pack.json
```

Il controllo stampa solo conteggi e percorsi degli errori, mai il contenuto.

## Le due metà

| Parte | Chi la vede | Contiene |
|---|---|---|
| `public` | Tutti, anche prima della cena | Manuale, cast con la riga pubblica, programma, domande del voto |
| `secret` | Nessuno finché non si arriva a quel passo | Schede, buste, finale, numero del colpevole |
| `assets` | Solo chi può già vedere il blocco che le usa | Immagini in base64 |

**Regola:** in `public` non va nulla che non sia già nel manuale senza spoiler della cena.

## Blocchi di testo

`{ "t": "h" | "p" | "quote" | "note", "text": "..." }` (`**grassetto**` ammesso), `{ "t": "list", "items": [] }`, `{ "t": "table", "rows": [[]] }`, `{ "t": "img", "asset": "id", "alt": "..." }`.

## Programma

`public.program` è la scaletta della serata. Ogni passo ha un `kind`:

- `info`: solo istruzioni
- `cards`: da qui si apre la scheda di ognuno (esattamente uno)
- `envelope`: apre la busta indicata in `envelope`
- `vote`: si vota (esattamente uno)
- `finale`: apre finale, classifica e tutte le schede (esattamente uno, dopo il voto)

## Scrivere o importare una cena senza rovinarla

Chi gioca non deve vedere il contenuto, quindi il lavoro va delegato a un subagente che:

1. scrive il file in `packs-private/` (fuori da git e dal deploy), senza nomi di personaggi nel nome del file;
2. nel rapporto finale dà solo esiti e conteggi, mai trama, indizi, nomi del colpevole o citazioni.
