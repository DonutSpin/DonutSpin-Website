import { z } from 'zod';
import { parse } from '../lib/validation.ts';

const schemas: Record<string, z.ZodType> = {
  coinflip: z
    .object({
      winMultiplier: z.number().min(1.5, 'Minimum multiplier is 1.5x.').max(2, 'Maximum multiplier is 2x.'),
    })
    .strict(),
  mines: z
    .object({
      maxMines: z.number().int().min(1).max(24),
      houseEdge: z.number().min(0).max(0.1),
    })
    .strict(),
  blackjack: z
    .object({
      decks: z.number().int().min(1).max(8),
      dealerStandsSoft17: z.boolean(),
      blackjackPays: z.number().min(1).max(2),
      allowDouble: z.boolean(),
    })
    .strict(),
  roulette: z
    .object({
      maxBetsPerSpin: z.number().int().min(1).max(30),
    })
    .strict(),
  towers: z
    .object({
      levels: z.number().int().min(3).max(12),
      houseEdge: z.number().min(0).max(0.1),
    })
    .strict(),
  plinko: z
    .object({
      enabledRisks: z.array(z.enum(['low', 'medium', 'high'])).min(1, 'Keep at least one risk level enabled.'),
    })
    .strict(),
};

export function validateGameConfig(slug: string, raw: unknown): Record<string, unknown> {
  const schema = schemas[slug];
  if (!schema) throw new Error(`Unknown game ${slug}`);
  return parse(schema, raw) as Record<string, unknown>;
}

export function defaultGameConfig(slug: string): Record<string, unknown> {
  switch (slug) {
    case 'coinflip':
      return { winMultiplier: 1.96 };
    case 'mines':
      return { maxMines: 20, houseEdge: 0.03 };
    case 'blackjack':
      return { decks: 6, dealerStandsSoft17: true, blackjackPays: 1.5, allowDouble: true };
    case 'roulette':
      return { maxBetsPerSpin: 10 };
    case 'towers':
      return { levels: 9, houseEdge: 0.03 };
    case 'plinko':
      return { enabledRisks: ['low', 'medium', 'high'] };
    default:
      return {};
  }
}
