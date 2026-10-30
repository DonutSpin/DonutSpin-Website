import type { GameModule } from './common.ts';
import { coinflip, plinko, roulette } from './instant.ts';
import { blackjack } from './blackjack.ts';
import { mines, towers } from './table.ts';

export const GAME_MODULES: Record<string, GameModule> = {
  coinflip,
  mines,
  blackjack,
  roulette,
  towers,
  plinko,
};

export function getGameModule(slug: string): GameModule | undefined {
  return GAME_MODULES[slug];
}

const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

export function publicGameConfig(slug: string, config: Record<string, unknown>): Record<string, unknown> {
  switch (slug) {
    case 'mines':
      return { ...config, gridSize: 25 };
    case 'roulette':
      return { ...config, redNumbers: RED_NUMBERS };
    case 'towers':
      return { ...config, tilesPerLevel: 3 };
    case 'plinko':
      return {
        ...config,
        rows: 12,
        tables: {
          low: [10, 3, 1.6, 1.3, 1.1, 0.7, 0.5, 0.7, 1.1, 1.3, 1.6, 3, 10],
          medium: [33, 11, 4, 2, 1.2, 0.5, 0.2, 0.5, 1.2, 2, 4, 11, 33],
          high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
        },
      };
    default:
      return config;
  }
}
