export type PlayerRange = { min: number; ideal: number; max?: number };

/** Oltre il numero di personaggi chi avanza fa l'assistente, ma troppi assistenti non hanno senso. */
const DEFAULT_EXTRA_SEATS = 2;

/**
 * Se una cena si può giocare con `people` persone, master escluso.
 * Le schede si distribuiscono sempre tutte: con meno persone qualcuno ne riceve due, con più qualcuno resta senza.
 * `gap` serve a mettere in cima le cene più adatte.
 */
export function fitFor(players: PlayerRange, people: number) {
  const max = players.max ?? players.ideal + DEFAULT_EXTRA_SEATS;
  if (!Number.isInteger(people) || people < players.min || people > max) return null;
  const gap = Math.abs(players.ideal - people);
  if (people === players.ideal) return { gap, label: 'Numero giusto' };
  if (people < players.ideal) return { gap, label: gap === 1 ? '1 persona con due personaggi' : `${gap} persone con due personaggi` };
  return { gap, label: gap === 1 ? '1 assistente' : `${gap} assistenti` };
}
