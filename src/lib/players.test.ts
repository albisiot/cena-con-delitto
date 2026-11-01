import { describe, expect, it } from 'vitest';
import { dealCards } from '../../supabase/functions/api/game.ts';
import { fitFor } from './players';

const twelve = { min: 9, ideal: 12 };

describe('quante persone per una cena', () => {
  it('riconosce il numero giusto', () => {
    expect(fitFor(twelve, 12)).toEqual({ gap: 0, label: 'Numero giusto' });
  });

  it('con meno persone dice quante avranno due personaggi', () => {
    expect(fitFor(twelve, 11)?.label).toBe('1 persona con due personaggi');
    expect(fitFor(twelve, 9)?.label).toBe('3 persone con due personaggi');
  });

  it('con più persone dice quanti saranno assistenti', () => {
    expect(fitFor(twelve, 13)?.label).toBe('1 assistente');
    expect(fitFor(twelve, 14)?.label).toBe('2 assistenti');
  });

  it('esclude chi è sotto il minimo o troppo oltre', () => {
    expect(fitFor(twelve, 8)).toBeNull();
    expect(fitFor(twelve, 15)).toBeNull();
    expect(fitFor({ min: 12, ideal: 12 }, 11)).toBeNull();
  });

  it('una cena può indicare un massimo diverso', () => {
    expect(fitFor({ min: 4, ideal: 6, max: 6 }, 7)).toBeNull();
    expect(fitFor({ min: 4, ideal: 6, max: 10 }, 10)?.label).toBe('4 assistenti');
  });

  it('un numero non valido non è compatibile', () => {
    expect(fitFor(twelve, Number.NaN)).toBeNull();
    expect(fitFor(twelve, 10.5)).toBeNull();
  });

  it('quello che promette corrisponde alla vera distribuzione delle schede', () => {
    const cards = Array.from({ length: 12 }, (_, i) => i + 1);
    const seats = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
    const counts = (n: number) => [...dealCards(seats(n), cards).values()].map((hand) => hand.length);
    expect(counts(9).filter((c) => c === 2)).toHaveLength(3);
    expect(counts(14).filter((c) => c === 0)).toHaveLength(2);
    expect(counts(12).every((c) => c === 1)).toBe(true);
  });
});
