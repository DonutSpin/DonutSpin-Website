import { z } from 'zod';
import { GAME_WIN_CHANCE_INFO } from '../../shared/types.ts';
import { parse } from '../lib/validation.ts';

export const configuredChanceSchema = z
  .number()
  .min(1, 'Win chance must be at least 1%.')
  .max(99, 'Win chance must be at most 99%.')
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9,
    'Use at most two decimal places.',
  );

const winChanceSchema = configuredChanceSchema;

const schemas: Record<string, z.ZodType> = {
  coinflip: z
    .object({
      winMultiplier: z.number().min(1.5, 'Minimum multiplier is 1.5x.').max(2, 'Maximum multiplier is 2x.'),
      winChance: winChanceSchema,
    })
    .strict(),
  mines: z
    .object({
      maxMines: z.number().int().min(1).max(24),
      houseEdge: z.number().min(0).max(0.1),
      winChance: winChanceSchema,
    })
    .strict(),
  blackjack: z
    .object({
      decks: z.number().int().min(1).max(8),
      dealerStandsSoft17: z.boolean(),
      blackjackPays: z.number().min(1).max(2),
      allowDouble: z.boolean(),
      winChance: winChanceSchema,
    })
    .strict(),
  roulette: z
    .object({
      maxBetsPerSpin: z.number().int().min(1).max(30),
      winChance: winChanceSchema,
    })
    .strict(),
  towers: z
    .object({
      levels: z.number().int().min(3).max(12),
      houseEdge: z.number().min(0).max(0.1),
      winChance: winChanceSchema,
    })
    .strict(),
  plinko: z
    .object({
      enabledRisks: z.array(z.enum(['low', 'medium', 'high'])).min(1, 'Keep at least one risk level enabled.'),
      winChance: winChanceSchema,
    })
    .strict(),
};

/** The monitoring baseline or outcome chance for a game. */
export function defaultWinChance(slug: string): number {
  return GAME_WIN_CHANCE_INFO[slug]?.defaultChance ?? 50;
}

/**
 * Older rows may predate the win-chance migration. Fill only the missing field
 * so a configuration update can never silently reset an admin's chosen value.
 */
export function validateGameConfig(slug: string, raw: unknown): Record<string, unknown> {
  const schema = schemas[slug];
  if (!schema) throw new Error(`Unknown game ${slug}`);
  const base = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return parse(schema, { winChance: defaultWinChance(slug), ...base }) as Record<string, unknown>;
}

export function defaultGameConfig(slug: string): Record<string, unknown> {
  switch (slug) {
    case 'coinflip':
      return { winMultiplier: 1.96, winChance: defaultWinChance(slug) };
    case 'mines':
      return { maxMines: 20, houseEdge: 0.03, winChance: defaultWinChance(slug) };
    case 'blackjack':
      return {
        decks: 6,
        dealerStandsSoft17: true,
        blackjackPays: 1.5,
        allowDouble: true,
        winChance: defaultWinChance(slug),
      };
    case 'roulette':
      return { maxBetsPerSpin: 10, winChance: defaultWinChance(slug) };
    case 'towers':
      return { levels: 9, houseEdge: 0.03, winChance: defaultWinChance(slug) };
    case 'plinko':
      return { enabledRisks: ['low', 'medium', 'high'], winChance: defaultWinChance(slug) };
    default:
      return {};
  }
}
