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
}

const coinflipSchema = z.object({ pick: z.enum(['heads', 'tails']) });

export const coinflip: GameModule = {
  start(ctx) {
    const replay = findReplay(ctx.db, ctx.user.id, ctx.requestId);
    if (replay) return this.resume(replay, balanceOf(ctx.db, ctx.user.id), maxPayout(ctx.db));
    const { pick } = parse(coinflipSchema, ctx.body);
    const outcome = secureInt(2) === 0 ? 'heads' : 'tails';
    const multiplier = Math.min(2, Math.max(1.5, numberConfig(ctx.gameConfig, 'winMultiplier', 1.96)));
    const won = pick === outcome;
    const payout = won ? payoutFor(ctx.bet, multiplier, maxPayout(ctx.db)) : 0;
    const sessionId = newSessionId();
    const state: CoinflipState = { pick, outcome, multiplier };
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
    const state = parseJson<CoinflipState>(row.state, { pick: 'heads', outcome: 'heads', multiplier: 1.96 });
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

const rouletteSchema = z.object({
  bets: z
    .array(
      z.object({
        type: z.enum(ROULETTE_BET_TYPES),
        number: z.number().int().min(0).max(36).optional(),
        amount: amountSchema({ max: 1_000_000_000_000 }),
      }),
    )
    .min(1, 'Place at least one bet.')
    .max(30),
});

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export function rouletteColor(n: number): 'red' | 'black' | 'green' {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

function betWins(bet: RouletteBet, winning: number): number {
  const amount = bet.amount;
  if (bet.type === 'straight') return bet.number === winning ? amount * 36 : 0;
  if (winning === 0) return 0;
  switch (bet.type) {
    case 'red':
      return rouletteColor(winning) === 'red' ? amount * 2 : 0;
    case 'black':
      return rouletteColor(winning) === 'black' ? amount * 2 : 0;
    case 'odd':
      return winning % 2 === 1 ? amount * 2 : 0;
    case 'even':
      return winning % 2 === 0 ? amount * 2 : 0;
    case 'low':
      return winning <= 18 ? amount * 2 : 0;
    case 'high':
      return winning >= 19 ? amount * 2 : 0;
    case 'dozen1':
      return winning <= 12 ? amount * 3 : 0;
    case 'dozen2':
      return winning >= 13 && winning <= 24 ? amount * 3 : 0;
    case 'dozen3':
      return winning >= 25 ? amount * 3 : 0;
    case 'column1':
      return winning % 3 === 1 ? amount * 3 : 0;
    case 'column2':
      return winning % 3 === 2 ? amount * 3 : 0;
    case 'column3':
      return winning % 3 === 0 ? amount * 3 : 0;
    default:
      return 0;
  }
}

interface RouletteState {
  bets: RouletteBet[];
  winningNumber: number;
  totalPayout: number;
}

export const roulette: GameModule = {
  start(ctx) {
    const replay = findReplay(ctx.db, ctx.user.id, ctx.requestId);
    if (replay) return this.resume(replay, balanceOf(ctx.db, ctx.user.id), maxPayout(ctx.db));
    const parsed = parse(rouletteSchema, ctx.body);
    const maxBets = Math.max(1, Math.floor(numberConfig(ctx.gameConfig, 'maxBetsPerSpin', 10)));
    if (parsed.bets.length > maxBets) {
      throw badRequest(`You can place at most ${maxBets} bets per spin.`, 'TOO_MANY_BETS');
    }
    const bets: RouletteBet[] = parsed.bets.map((bet) => {
      const type = bet.type as RouletteBet['type'];
      if (type === 'straight' && bet.number === undefined) {
        throw badRequest('Choose a number for a straight bet.', 'INVALID_BET', { fields: { bets: 'Straight bets need a number.' } });
      }
      return { type, ...(type === 'straight' ? { number: bet.number } : {}), amount: bet.amount };
    });
    const total = bets.reduce((sum, bet) => sum + bet.amount, 0);
    if (total !== ctx.bet) {
      throw badRequest('Wager total does not match the placed bets.', 'BET_MISMATCH');
    }
    const winningNumber = secureInt(37);
    let payoutRaw = 0;
    for (const bet of bets) payoutRaw += betWins(bet, winningNumber);
    const totalPayout = Math.min(payoutRaw, maxPayout(ctx.db));
    const won = totalPayout > 0;
    const sessionId = newSessionId();
    const state: RouletteState = { bets, winningNumber, totalPayout };
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
      won,
    } satisfies RouletteView;
  },
  resume(row, balance) {
    const state = parseJson<RouletteState>(row.state, { bets: [], winningNumber: 0, totalPayout: 0 });
    return {
      ...baseView(row, balance),
      bets: state.bets,
      winningNumber: state.winningNumber,
      color: rouletteColor(state.winningNumber),
      totalPayout: state.totalPayout,
      won: row.status === 'won',
    } satisfies RouletteView;
  },
};

export function sessionSummaryOf(row: GameSessionRow): GameSessionSummary {
  return summary(row);
}
