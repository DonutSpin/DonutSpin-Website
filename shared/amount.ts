const UNITS = [
  { suffix: 't', divisor: 1_000_000_000_000, symbol: 'T' },
  { suffix: 'b', divisor: 1_000_000_000, symbol: 'B' },
  { suffix: 'm', divisor: 1_000_000, symbol: 'M' },
  { suffix: 'k', divisor: 1_000, symbol: 'K' },
] as const;

const SUFFIXES: Record<string, number> = Object.fromEntries(UNITS.map((unit) => [unit.suffix, unit.divisor]));

export interface ParseAmountOptions {
  allowNegative?: boolean;
}

/**
 * Parse a human amount such as `100000`, `100k`, `1.5M`, `2b` or `1t`.
 * Returns null when the text is not a valid amount.
 */
export function parseAmount(input: string | number, options: ParseAmountOptions = {}): number | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.trunc(input) : null;
  }

  const cleaned = input.trim().toLowerCase().replace(/[\s,_]/g, '');
  if (!cleaned) return null;

  const match = /^([+-]?)(\d*\.?\d+)([kmbt])?$/.exec(cleaned);
  if (!match) return null;

  const [, sign, digits, suffix] = match;
  if (sign === '-' && !options.allowNegative) return null;

  const base = Number(digits);
  if (!Number.isFinite(base)) return null;

  const value = Math.round(base * (suffix ? (SUFFIXES[suffix] ?? 1) : 1));
  if (!Number.isFinite(value)) return null;
  if (sign === '-' && value !== 0) return -value;
  return value;
}

function shortNumber(value: number): string {
  const digits = value < 10 ? 2 : value < 100 ? 1 : 0;
  return value
    .toFixed(digits)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*[1-9])0+$/, '$1');
}

/** Format a value with a K/M/B/T suffix, e.g. 1500000 → `1.5M`. */
export function compactAmount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  for (let index = 0; index < UNITS.length; index += 1) {
    const unit = UNITS[index];
    if (!unit || abs < unit.divisor) continue;
    const scaled = abs / unit.divisor;
    const formatted = shortNumber(scaled);
    // Rounding can push 999.9K up to 1000K; promote it to the next unit.
    if (Number(formatted) >= 1000 && index > 0) {
      const next = UNITS[index - 1];
      if (next) return `${sign}${shortNumber(abs / next.divisor)}${next.symbol}`;
    }
    return `${sign}${formatted}${unit.symbol}`;
  }
  return `${sign}${Math.trunc(abs)}`;
}
