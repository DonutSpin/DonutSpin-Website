/**
 * Payout arithmetic shared by the server (which pays) and the client (which
 * displays). Keeping one implementation guarantees that the amount shown is the
 * amount that is actually credited.
 *
 * Multipliers carry two decimals, so the calculation is done in integer space
 * with BigInt: current 64-bit floats cannot represent `bet * 1.96` exactly for
 * large wagers, and a rounding difference here is real money.
 */

/** Rounds a multiplier to the two decimals the game tables define. */
export function normalizeMultiplier(multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return 0;
  return Math.round(multiplier * 100) / 100;
}

/**
 * Exact payout for `bet × multiplier`, rounded down to whole credits and capped.
 * Returns 0 for invalid input, which the games treat as a loss.
 */
export function payoutFor(bet: number, multiplier: number, cap = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isFinite(bet) || bet <= 0) return 0;
  const normalized = normalizeMultiplier(multiplier);
  if (normalized <= 0) return 0;

  const betInt = BigInt(Math.trunc(bet));
  const hundredths = BigInt(Math.round(normalized * 100));
  const capInt = BigInt(Math.max(0, Math.trunc(cap)));

  const raw = (betInt * hundredths) / 100n;
  return Number(raw < capInt ? raw : capInt);
}

/** True when a wager could never be returned by a 1x round because of the cap. */
export function capBelowWager(bet: number, cap: number): boolean {
  return Number.isFinite(cap) && cap > 0 && bet > cap;
}
