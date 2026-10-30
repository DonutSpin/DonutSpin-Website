import { describe, expect, it } from 'vitest';
import { compactAmount, parseAmount } from '../shared/amount.ts';

describe('amount shorthand', () => {
  it('parses K, M, B, and T suffixes', () => {
    expect(parseAmount('100k')).toBe(100_000);
    expect(parseAmount('1.5M')).toBe(1_500_000);
    expect(parseAmount('2b')).toBe(2_000_000_000);
    expect(parseAmount('1t')).toBe(1_000_000_000_000);
    expect(parseAmount('1.5T')).toBe(1_500_000_000_000);
    expect(parseAmount('1,250k')).toBe(1_250_000);
    expect(parseAmount(' 25 k ')).toBe(25_000);
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('-1t')).toBeNull();
    expect(parseAmount('-1t', { allowNegative: true })).toBe(-1_000_000_000_000);
  });

  it('displays money in the short format', () => {
    expect(compactAmount(0)).toBe('0');
    expect(compactAmount(999)).toBe('999');
    expect(compactAmount(1_000)).toBe('1K');
    expect(compactAmount(250_000)).toBe('250K');
    expect(compactAmount(1_500_000)).toBe('1.5M');
    expect(compactAmount(5_000_000_000)).toBe('5B');
    expect(compactAmount(1_500_000_000_000)).toBe('1.5T');
    expect(compactAmount(999_999)).toBe('1M');
    expect(compactAmount(999_999_999)).toBe('1B');
    expect(compactAmount(-1_500_000)).toBe('-1.5M');
  });
});
