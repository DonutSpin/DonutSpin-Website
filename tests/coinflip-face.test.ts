import { describe, expect, it } from 'vitest';
import { COIN_TURNS, faceDegrees, landingDegrees, normalizeDegrees } from '../src/lib/coin.ts';

/**
 * The animation must visualize the server result, never decide it. These tests
 * pin the geometry: whatever angle the coin starts from, the angle it stops on
 * shows the face the server returned.
 */
describe('coinflip landing geometry', () => {
  it('maps heads to the front face and tails to the back face', () => {
    expect(faceDegrees('heads')).toBe(0);
    expect(faceDegrees('tails')).toBe(180);
  });

  it('always stops on the face the server returned', () => {
    for (let from = -1440; from <= 1440; from += 17) {
      for (const outcome of ['heads', 'tails'] as const) {
        const landed = landingDegrees(from, outcome);
        expect(normalizeDegrees(landed), `from ${from} to ${outcome}`).toBe(faceDegrees(outcome));
      }
    }
  });

  it('spins forwards for several full turns instead of snapping backwards', () => {
    for (let from = -720; from <= 720; from += 13) {
      for (const outcome of ['heads', 'tails'] as const) {
        const landed = landingDegrees(from, outcome);
        // Normalising the start keeps the forward distance comparable.
        const start = normalizeDegrees(from);
        const distance = landed - start;
        expect(distance).toBeGreaterThan(COIN_TURNS * 360);
        expect(distance).toBeLessThan((COIN_TURNS + 2) * 360);
      }
    }
  });

  it('is stable once the coin is resting, so a rebuild cannot flip the face', () => {
    for (const outcome of ['heads', 'tails'] as const) {
      const resting = faceDegrees(outcome);
      expect(normalizeDegrees(landingDegrees(resting, outcome))).toBe(resting);
    }
  });

  it('normalises arbitrary angles into [0, 360)', () => {
    expect(normalizeDegrees(-180)).toBe(180);
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(1260)).toBe(180);
    expect(normalizeDegrees(0)).toBe(0);
  });
});
