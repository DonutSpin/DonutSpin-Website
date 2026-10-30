/**
 * Coinflip face geometry.
 *
 * The visible face of the coin is decided only by the rotation modulo 360°.
 * Heads is the front face (0°) and tails is the back face (180°), which is how
 * `.coin-face.back` is defined in the stylesheet. Deriving the angle from the
 * server outcome is what guarantees the coin cannot land on the losing side.
 */

export type CoinSide = 'heads' | 'tails';

/** Full turns added before landing, so the flip reads as a real toss. */
export const COIN_TURNS = 4;

/** Rotation that shows `side`. */
export function faceDegrees(side: CoinSide): number {
  return side === 'tails' ? 180 : 0;
}

export function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

/**
 * Absolute rotation angle whose visible face is `outcome`.
 *
 * The ending angle is derived from the server result and nothing else, and it
 * always advances forwards so the coin keeps spinning the same way instead of
 * snapping backwards to reach a face.
 */
export function landingDegrees(from: number, outcome: CoinSide): number {
  const current = normalizeDegrees(from);
  const raw = (((faceDegrees(outcome) - current) % 360) + 360) % 360;
  // A remaining angle under 45° would look like an abrupt snap on landing.
  const delta = raw < 45 ? raw + 360 : raw;
  return current + COIN_TURNS * 360 + delta;
}
