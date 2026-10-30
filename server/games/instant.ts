import { z } from 'zod';
import type {
  CoinflipView,
  GameSessionSummary,
  PlinkoView,
  RouletteBet,
  RouletteView,
} from '../../shared/types.ts';
import { parse } from '../lib/validation.ts';
import { amountSchema } from '../lib/amount.ts';
import { badRequest, parseJson } from '../lib/core.ts';
import { balanceOf } from '../lib/wallet.ts';
import { payoutFor } from '../../shared/payout.ts';
import {
  baseView,
  configuredWinChance,
  creditPayout,
  debitWager,
  findReplay,
  finishSession,
  insertSession,
  maxPayout,
  newSessionId,
  numberConfig,
  secureInt,
  type GameModule,
  type GameSessionRow,
} from './common.ts';

function summary(row: GameSessionRow): GameSessionSummary {
  return {
    id: row.id,
    game: row.game_id,
    bet: row.bet,
    payout: row.payout,
    status: row.status,
    createdAt: row.created_at,
    endedAt: row.ended_at,
  };
}

/* ------------------------------- Coinflip ------------------------------- */

interface CoinflipState {
  pick: 'heads' | 'tails';
  outcome: 'heads' | 'tails';
  multiplier: number;
  winChance?: number;
}

const coinflipSchema = z.object({ pick: z.enum(['heads', 'tails']) });

/**
 * The chance is applied once, at round creation. The outcome is still drawn
 * from the CSPRNG; a 50% configuration keeps the original fair coin.
 */
export function resolveCoinflip(
  pick: 'heads' | 'tails',
  winChance: number,
  roll: number,
): { outcome: 'heads' | 'tails'; won: boolean } {
  const won = roll < winChance / 100;
  return { outcome: won ? pick : pick === 'heads' ? 'tails' : 'heads', won };
}

export const coinflip: GameModule = {
  start(ctx) {
    const replay = findReplay(ctx.db, ctx.user.id, ctx.requestId);
    if (replay) return this.resume(replay, balanceOf(ctx.db, ctx.user.id), maxPayout(ctx.db));
    const { pick } = parse(coinflipSchema, ctx.body);
    const winChance = configuredWinChance(ctx.game.id, ctx.gameConfig);
    const { outcome, won } = resolveCoinflip(pick, winChance, secureInt(1_000_000) / 1_000_000);
    const multiplier = Math.min(2, Math.max(1.5, numberConfig(ctx.gameConfig, 'winMultiplier', 1.96)));
    const payout = won ? payoutFor(ctx.bet, multiplier, maxPayout(ctx.db)) : 0;
    const sessionId = newSessionId();
    const state: CoinflipState = { pick, outcome, multiplier, winChance };
    const wagerLedgerId = debitWager(ctx.db, ctx.user.id, sessionId, ctx.bet, ctx.game.id);
    insertSession(ctx.db, {
      id: sessionId,
      userId: ctx.user.id,
      gameId: ctx.game.id,
      bet: ctx.bet,
      status: 'active',
      state,
      requestId: ctx.requestId,
      wagerLedgerId,
      gameConfig: ctx.gameConfig,
    });
    const payoutLedgerId = creditPayout(
      ctx.db,
      { id: sessionId, user_id: ctx.user.id, game_id: ctx.game.id },
      payout,
      won ? 'Coinflip win' : 'Coinflip loss',
    );
    const row = finishSession(ctx.db, sessionId, {
      status: won ? 'won' : 'lost',
      payout,
      state,
      outcome: { pick, outcome },
      payoutLedgerId,
    });
    const view: CoinflipView = {
      ...baseView(row, balanceOf(ctx.db, ctx.user.id)),
      pick,
      outcome,
      won,
      multiplier,
    };
    return view;
  },
  resume(row, balance) {
    const state = parseJson<CoinflipState>(row.state, { pick: 'heads', outcome: 'heads', multiplier: 1.96, winChance: 50 });
    return {
      ...baseView(row, balance),
      pick: state.pick,
      outcome: state.outcome,
      won: row.status === 'won',
      multiplier: state.multiplier,
    } satisfies CoinflipView;
  },
};

/* -------------------------------- Plinko -------------------------------- */

const PLINKO_ROWS = 12;
const PLINKO_TABLES: Record<'low' | 'medium' | 'high', number[]> = {
  low: [10, 3, 1.6, 1.3, 1.1, 0.7, 0.5, 0.7, 1.1, 1.3, 1.6, 3, 10],
  medium: [33, 11, 4, 2, 1.2, 0.5, 0.2, 0.5, 1.2, 2, 4, 11, 33],
  high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
};

export function plinkoTable(risk: 'low' | 'medium' | 'high'): number[] {
  return PLINKO_TABLES[risk];
}

const plinkoSchema = z.object({ risk: z.enum(['low', 'medium', 'high']) });

interface PlinkoState {
  risk: 'low' | 'medium' | 'high';
  path: ('left' | 'right')[];
  slot: number;
  multiplier: number;
}

export const plinko: GameModule = {
  start(ctx) {
    const replay = findReplay(ctx.db, ctx.user.id, ctx.requestId);
    if (replay) return this.resume(replay, balanceOf(ctx.db, ctx.user.id), maxPayout(ctx.db));
    const { risk } = parse(plinkoSchema, ctx.body);
    const enabledRisks = Array.isArray(ctx.gameConfig.enabledRisks)
      ? (ctx.gameConfig.enabledRisks as string[])
      : ['low', 'medium', 'high'];
    if (!enabledRisks.includes(risk)) {
      throw badRequest('That risk level is disabled.', 'RISK_DISABLED', { fields: { risk: 'Choose an available risk level.' } });
    }
    const path: ('left' | 'right')[] = Array.from({ length: PLINKO_ROWS }, () => (secureInt(2) === 0 ? 'left' : 'right'));
    const slot = path.filter((step) => step === 'right').length;
    const multiplier = PLINKO_TABLES[risk][slot] ?? 0;
    const payout = payoutFor(ctx.bet, multiplier, maxPayout(ctx.db));
    const won = payout > 0;
    const sessionId = newSessionId();
    const state: PlinkoState = { risk, path, slot, multiplier };
    const wagerLedgerId = debitWager(ctx.db, ctx.user.id, sessionId, ctx.bet, ctx.game.id);
    insertSession(ctx.db, {
      id: sessionId,
      userId: ctx.user.id,
      gameId: ctx.game.id,
      bet: ctx.bet,
      status: 'active',
      state,
      requestId: ctx.requestId,
      wagerLedgerId,
      gameConfig: ctx.gameConfig,
    });
    const payoutLedgerId = creditPayout(
      ctx.db,
      { id: sessionId, user_id: ctx.user.id, game_id: ctx.game.id },
      payout,
      `Plinko ${risk} drop`,
    );
    const row = finishSession(ctx.db, sessionId, {
      status: won ? 'won' : 'lost',
      payout,
      state,
      outcome: { risk, slot, multiplier },
      payoutLedgerId,
    });
    return {
      ...baseView(row, balanceOf(ctx.db, ctx.user.id)),
      risk,
      path,
      slot,
      multiplier,
      won,
    } satisfies PlinkoView;
  },
  resume(row, balance) {
    const state = parseJson<PlinkoState>(row.state, { risk: 'medium', path: [], slot: 6, multiplier: 0 });
    return {
      ...baseView(row, balance),
      risk: state.risk,
      path: state.path,
      slot: state.slot,
      multiplier: state.multiplier,
      won: row.status === 'won',
    } satisfies PlinkoView;
  },
};

/* ------------------------------- Roulette ------------------------------- */

const ROULETTE_BET_TYPES = [
  'red',
  'black',
  'odd',
  'even',
  'low',
  'high',
  'dozen1',
  'dozen2',
  'dozen3',
  'column1',
  'column2',
  'column3',
  'straight',
] as const;

const MAX_ROUND_STAKE = 1_000_000_000_000;
const MAX_CHIP_VALUE = 1_000_000_000_000;
const MAX_CHIP_COUNT = 1_000_000;

const rouletteBetSchema = z
  .object({
    type: z.enum(ROULETTE_BET_TYPES),
    number: z.number().int().min(0).max(36).optional(),
    chips: z.number().int().min(1).max(MAX_CHIP_COUNT).optional(),
    amount: amountSchema({ max: MAX_ROUND_STAKE }).optional(),
  })
  .refine((bet) => bet.chips !== undefined || bet.amount !== undefined, {
    message: 'Place at least one chip.',
    path: ['chips'],
  });

const rouletteSchema = z.object({
  chipValue: z.number().int().min(1).max(MAX_CHIP_VALUE).optional(),
  bets: z.array(rouletteBetSchema).min(1, 'Place at least one bet.').max(30),
});

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export function rouletteColor(n: number): 'red' | 'black' | 'green' {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

/**
 * The payout multiple is independent of the chip value. The value is applied
 * once, after the chip multipliers are summed, so changing a chip cannot change
 * the game's ratios or house edge.
 */
export function rouletteMultiplier(
  bet: Pick<RouletteBet, 'type' | 'number'>,
  winning: number,
): number {
  if (bet.type === 'straight') return bet.number === winning ? 36 : 0;
  if (winning === 0) return 0;
  switch (bet.type) {
    case 'red':
      return rouletteColor(winning) === 'red' ? 2 : 0;
    case 'black':
      return rouletteColor(winning) === 'black' ? 2 : 0;
    case 'odd':
      return winning % 2 === 1 ? 2 : 0;
    case 'even':
      return winning % 2 === 0 ? 2 : 0;
    case 'low':
      return winning <= 18 ? 2 : 0;
    case 'high':
      return winning >= 19 ? 2 : 0;
    case 'dozen1':
      return winning <= 12 ? 3 : 0;
    case 'dozen2':
      return winning >= 13 && winning <= 24 ? 3 : 0;
    case 'dozen3':
      return winning >= 25 ? 3 : 0;
    case 'column1':
      return winning % 3 === 1 ? 3 : 0;
    case 'column2':
      return winning % 3 === 2 ? 3 : 0;
    case 'column3':
      return winning % 3 === 0 ? 3 : 0;
    default:
      return 0;
  }
}

export function roulettePayout(
  bets: Pick<RouletteBet, 'type' | 'number' | 'chips'>[],
  winning: number,
  chipValue: number,
  cap = Number.MAX_SAFE_INTEGER,
): number {
  const winningChips = bets.reduce(
    (sum, bet) => sum + bet.chips * rouletteMultiplier(bet, winning),
    0,
  );
  return Math.min(winningChips * chipValue, cap);
}

interface RouletteState {
  bets: RouletteBet[];
  winningNumber: number;
  totalPayout: number;
  chipValue: number;
}

export const roulette: GameModule = {
  start(ctx) {
    const replay = findReplay(ctx.db, ctx.user.id, ctx.requestId);
    if (replay) return this.resume(replay, balanceOf(ctx.db, ctx.user.id), maxPayout(ctx.db));
    const parsed = parse(rouletteSchema, ctx.body);
    const chipValue = parsed.chipValue ?? 1;
    const maxBets = Math.max(1, Math.floor(numberConfig(ctx.gameConfig, 'maxBetsPerSpin', 10)));
    if (parsed.bets.length > maxBets) {
      throw badRequest(`You can place at most ${maxBets} bets per spin.`, 'TOO_MANY_BETS');
    }
    const bets: RouletteBet[] = parsed.bets.map((bet, index) => {
      const type = bet.type as RouletteBet['type'];
      if (type === 'straight' && bet.number === undefined) {
        throw badRequest('Choose a number for a straight bet.', 'INVALID_BET', {
          fields: { bets: 'Straight bets need a number.' },
        });
      }
      if (bet.chips !== undefined) {
        const amount = bet.chips * chipValue;
        if (!Number.isSafeInteger(amount) || amount > MAX_ROUND_STAKE) {
          throw badRequest('That chip stack is above the platform stake limit.', 'BET_TOO_LARGE', {
            fields: { [`bets.${index}.chips`]: 'Reduce the number of chips or the chip value.' },
          });
        }
        if (bet.amount !== undefined && bet.amount !== amount) {
          throw badRequest('Chip count and money amount do not match.', 'CHIP_AMOUNT_MISMATCH', {
            fields: { [`bets.${index}.amount`]: `Expected ${amount}.` },
          });
        }
        return { type, ...(type === 'straight' ? { number: bet.number } : {}), chips: bet.chips, amount };
      }
      if (bet.amount === undefined) {
        throw badRequest('Place at least one chip.', 'INVALID_BET', { fields: { bets: 'Chip count is missing.' } });
      }
      if (bet.amount % chipValue !== 0) {
        throw badRequest('The bet amount must be a whole number of chips.', 'CHIP_AMOUNT_MISMATCH', {
          fields: { [`bets.${index}.amount`]: `Use a multiple of ${chipValue}.` },
        });
      }
      const chips = bet.amount / chipValue;
      if (!Number.isSafeInteger(chips) || chips < 1) {
        throw badRequest('The bet amount must be a whole number of chips.', 'CHIP_AMOUNT_MISMATCH', {
          fields: { [`bets.${index}.amount`]: `Use a multiple of ${chipValue}.` },
        });
      }
      return { type, ...(type === 'straight' ? { number: bet.number } : {}), chips, amount: bet.amount };
    });
    const total = bets.reduce((sum, bet) => sum + bet.amount, 0);
    if (total !== ctx.bet) {
      throw badRequest('Wager total does not match the placed bets.', 'BET_MISMATCH');
    }
    const winningNumber = secureInt(37);
    const totalPayout = roulettePayout(bets, winningNumber, chipValue, maxPayout(ctx.db));
    const won = totalPayout > 0;
    const sessionId = newSessionId();
    const state: RouletteState = { bets, winningNumber, totalPayout, chipValue };
    const wagerLedgerId = debitWager(ctx.db, ctx.user.id, sessionId, ctx.bet, ctx.game.id);
    insertSession(ctx.db, {
      id: sessionId,
      userId: ctx.user.id,
      gameId: ctx.game.id,
      bet: ctx.bet,
      status: 'active',
      state,
      requestId: ctx.requestId,
      wagerLedgerId,
      gameConfig: ctx.gameConfig,
    });
    const payoutLedgerId = creditPayout(
      ctx.db,
      { id: sessionId, user_id: ctx.user.id, game_id: ctx.game.id },
      totalPayout,
      `Roulette spin ${winningNumber}`,
    );
    const row = finishSession(ctx.db, sessionId, {
      status: won ? 'won' : 'lost',
      payout: totalPayout,
      state,
      outcome: { winningNumber },
      payoutLedgerId,
    });
    return {
      ...baseView(row, balanceOf(ctx.db, ctx.user.id)),
      bets,
      winningNumber,
      color: rouletteColor(winningNumber),
      totalPayout,
      chipValue,
      won,
    } satisfies RouletteView;
  },
  resume(row, balance) {
    const state = parseJson<RouletteState>(row.state, {
      bets: [],
      winningNumber: 0,
      totalPayout: 0,
      chipValue: 1,
    });
    const chipValue = state.chipValue ?? 1;
    return {
      ...baseView(row, balance),
      bets: state.bets.map((bet) => ({
        ...bet,
        chips: bet.chips ?? bet.amount,
        amount: bet.amount ?? (bet.chips ?? 1) * chipValue,
      })),
      winningNumber: state.winningNumber,
      color: rouletteColor(state.winningNumber),
      totalPayout: state.totalPayout,
      chipValue,
      won: row.status === 'won',
    } satisfies RouletteView;
  },
};

export function sessionSummaryOf(row: GameSessionRow): GameSessionSummary {
  return summary(row);
}
