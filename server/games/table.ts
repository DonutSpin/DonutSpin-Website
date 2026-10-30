import { z } from 'zod';
import type { MinesView, TowersView } from '../../shared/types.ts';
import { parse } from '../lib/validation.ts';
import { badRequest, conflict, notFound, parseJson } from '../lib/core.ts';
import { balanceOf } from '../lib/wallet.ts';
import {
  baseView,
  creditPayout,
  debitWager,
  findReplay,
  finishSession,
  getSessionRow,
  insertSession,
  maxPayout,
  newSessionId,
  numberConfig,
  secureInt,
  shuffle,
  updateSessionState,
  type GameModule,
  type GameSessionRow,
} from './common.ts';

const round2 = (value: number): number => Math.round(value * 100) / 100;

/* --------------------------------- Mines -------------------------------- */

interface MinesState {
  mineTiles: number[];
  revealed: number[];
  multiplier: number;
  edge: number;
  hitTile: number | null;
  lastActionId: string | null;
}

const GRID = 25;

function minesMultiplier(mines: number, picks: number, edge: number): number {
  if (picks === 0) return 1;
  let numerator = 1;
  let denominator = 1;
  for (let i = 0; i < picks; i += 1) {
    numerator *= GRID - i;
    denominator *= GRID - mines - i;
  }
  return round2((1 - edge) * (numerator / denominator));
}

const minesStartSchema = z.object({
  mines: z.number().int().min(1).max(24),
});

const minesActionSchema = z.object({
  action: z.enum(['reveal', 'cashout']),
  tile: z.number().int().min(0).max(GRID - 1).optional(),
});

function minesView(row: GameSessionRow, state: MinesState, balance: number, mineCount: number): MinesView {
  const active = row.status === 'active';
  const safeTiles = GRID - mineCount;
  return {
    ...baseView(row, balance),
    mines: mineCount,
    revealed: state.revealed,
    multiplier: state.multiplier,
    nextMultiplier:
      active && state.revealed.length < safeTiles
        ? minesMultiplier(mineCount, state.revealed.length + 1, state.edge)
        : null,
    potential: active && state.revealed.length > 0 ? Math.floor(row.bet * state.multiplier) : 0,
    mineTiles: active ? null : state.mineTiles,
    hitTile: active ? null : (state.hitTile ?? null),
  };
}

export const mines: GameModule = {
  start(ctx) {
    const replay = findReplay(ctx.db, ctx.user.id, ctx.requestId);
    if (replay) return this.resume(replay, balanceOf(ctx.db, ctx.user.id));

    const { mines: mineCount } = parse(minesStartSchema, ctx.body);
    const maxMines = Math.min(24, Math.max(1, Math.floor(numberConfig(ctx.gameConfig, 'maxMines', 20))));
    if (mineCount > maxMines) {
      throw badRequest(`This table allows at most ${maxMines} mines.`, 'INVALID_MINE_COUNT', {
        fields: { mines: `Choose between 1 and ${maxMines}.` },
      });
    }
    const positions = shuffle(Array.from({ length: GRID }, (_, index) => index));
    const state: MinesState = {
      mineTiles: positions.slice(0, mineCount),
      revealed: [],
      multiplier: 1,
      edge: Math.min(0.1, Math.max(0, numberConfig(ctx.gameConfig, 'houseEdge', 0.03))),
      hitTile: null,
      lastActionId: null,
    };
    const sessionId = newSessionId();
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
    const row = getSessionRow(ctx.db, sessionId);
    if (!row) throw new Error('Session missing');
    return minesView(row, state, balanceOf(ctx.db, ctx.user.id), mineCount);
  },

  action(ctx) {
    const body = parse(minesActionSchema, ctx.body);
    const session = getSessionRow(ctx.db, ctx.sessionId);
    if (!session || session.user_id !== ctx.user.id) throw notFound('Game session not found.');
    const state = parseJson<MinesState | null>(session.state, null);
    if (!state) throw new Error('Corrupt game state');

    if (state.lastActionId && state.lastActionId === ctx.requestId) {
      return minesView(session, state, balanceOf(ctx.db, ctx.user.id), state.mineTiles.length);
    }
    if (session.status !== 'active') throw conflict('This round is already complete.', 'ROUND_COMPLETE');

    const mineCount = state.mineTiles.length;
    const safeTiles = GRID - mineCount;
    const edge = state.edge;
    state.lastActionId = ctx.requestId;

    if (body.action === 'cashout') {
      if (state.revealed.length === 0) {
        throw badRequest('Reveal at least one safe tile before cashing out.', 'NOTHING_TO_CASH_OUT');
      }
      const payout = Math.min(Math.floor(session.bet * state.multiplier), maxPayout(ctx.db));
      const ledgerId = creditPayout(
        ctx.db,
        { id: session.id, user_id: session.user_id, game_id: session.game_id },
        payout,
        `Mines cash-out at ${state.multiplier.toFixed(2)}x`,
      );
      finishSession(ctx.db, session.id, {
        status: 'won',
        payout,
        state,
        outcome: { cashout: true, multiplier: state.multiplier },
        payoutLedgerId: ledgerId,
      });
    } else {
      if (body.tile === undefined) throw badRequest('Choose a tile to reveal.', 'TILE_REQUIRED');
      if (state.revealed.includes(body.tile)) {
        throw badRequest('That tile is already revealed.', 'TILE_ALREADY_REVEALED');
      }
      if (state.mineTiles.includes(body.tile)) {
        state.hitTile = body.tile;
        finishSession(ctx.db, session.id, {
          status: 'lost',
          payout: 0,
          state,
          outcome: { hitMine: body.tile },
        });
      } else {
        state.revealed.push(body.tile);
        state.multiplier = Math.min(minesMultiplier(mineCount, state.revealed.length, edge), 1_000_000);
        if (state.revealed.length === safeTiles) {
          const payout = Math.min(Math.floor(session.bet * state.multiplier), maxPayout(ctx.db));
          const ledgerId = creditPayout(
            ctx.db,
            { id: session.id, user_id: session.user_id, game_id: session.game_id },
            payout,
            'Mines — all safe tiles cleared',
          );
          finishSession(ctx.db, session.id, {
            status: 'won',
            payout,
            state,
            outcome: { cleared: true, multiplier: state.multiplier },
            payoutLedgerId: ledgerId,
          });
        } else {
          updateSessionState(ctx.db, session.id, state);
        }
      }
    }

    const updated = getSessionRow(ctx.db, session.id);
    if (!updated) throw new Error('Session missing');
    const finalState = parseJson<MinesState>(updated.state, state);
    return minesView(updated, finalState, balanceOf(ctx.db, ctx.user.id), mineCount);
  },

  resume(row, balance) {
    const state = parseJson<MinesState | null>(row.state, null);
    if (!state) throw new Error('Corrupt game state');
    return minesView(row, state, balance, state.mineTiles.length);
  },
};

/* --------------------------------- Towers ------------------------------- */

interface TowersState {
  traps: number[];
  choices: number[];
  level: number;
  multiplier: number;
  edge: number;
  failedLevel: number | null;
  lastActionId: string | null;
}

const TILES_PER_LEVEL = 3;

const towersActionSchema = z.object({
  action: z.enum(['reveal', 'cashout']),
  tile: z.number().int().min(0).max(TILES_PER_LEVEL - 1).optional(),
});

function towerLevels(gameConfig: Record<string, unknown>): number {
  return Math.min(12, Math.max(3, Math.floor(numberConfig(gameConfig, 'levels', 9))));
}

function towerMultiplier(level: number, edge: number): number {
  if (level === 0) return 1;
  return round2((1 - edge) * 1.5 ** level);
}

function towersView(row: GameSessionRow, state: TowersState, balance: number, levels: number): TowersView {
  const active = row.status === 'active';
  const trapTile = state.failedLevel !== null ? (state.traps[state.failedLevel] ?? null) : null;
  return {
    ...baseView(row, balance),
    level: state.level,
    revealed: state.choices,
    multiplier: state.multiplier,
    nextMultiplier: active && state.level < levels ? towerMultiplier(state.level + 1, state.edge) : state.multiplier,
    potential: active && state.level > 0 ? Math.floor(row.bet * state.multiplier) : 0,
    trapTile,
  };
}

export const towers: GameModule = {
  start(ctx) {
    const replay = findReplay(ctx.db, ctx.user.id, ctx.requestId);
    if (replay) return this.resume(replay, balanceOf(ctx.db, ctx.user.id));

    const levels = towerLevels(ctx.gameConfig);
    const edge = Math.min(0.1, Math.max(0, numberConfig(ctx.gameConfig, 'houseEdge', 0.03)));
    const state: TowersState = {
      traps: Array.from({ length: levels }, () => secureInt(TILES_PER_LEVEL)),
      choices: [],
      level: 0,
      multiplier: 1,
      edge,
      failedLevel: null,
      lastActionId: null,
    };
    const sessionId = newSessionId();
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
    const row = getSessionRow(ctx.db, sessionId);
    if (!row) throw new Error('Session missing');
    return towersView(row, state, balanceOf(ctx.db, ctx.user.id), levels);
  },

  action(ctx) {
    const body = parse(towersActionSchema, ctx.body);
    const session = getSessionRow(ctx.db, ctx.sessionId);
    if (!session || session.user_id !== ctx.user.id) throw notFound('Game session not found.');
    const state = parseJson<TowersState | null>(session.state, null);
    if (!state) throw new Error('Corrupt game state');
    if (state.lastActionId && state.lastActionId === ctx.requestId) {
      return towersView(session, state, balanceOf(ctx.db, ctx.user.id), state.traps.length);
    }
    if (session.status !== 'active') throw conflict('This round is already complete.', 'ROUND_COMPLETE');

    const levels = state.traps.length;
    const edge = state.edge;
    state.lastActionId = ctx.requestId;

    if (body.action === 'cashout') {
      if (state.level === 0) {
        throw badRequest('Reveal at least one safe floor before cashing out.', 'NOTHING_TO_CASH_OUT');
      }
      const payout = Math.min(Math.floor(session.bet * state.multiplier), maxPayout(ctx.db));
      const ledgerId = creditPayout(
        ctx.db,
        { id: session.id, user_id: session.user_id, game_id: session.game_id },
        payout,
        `Towers cash-out at ${state.multiplier.toFixed(2)}x`,
      );
      finishSession(ctx.db, session.id, {
        status: 'won',
        payout,
        state,
        outcome: { cashout: true, level: state.level, multiplier: state.multiplier },
        payoutLedgerId: ledgerId,
      });
    } else {
      if (body.tile === undefined) throw badRequest('Choose a tile.', 'TILE_REQUIRED');
      const trap = state.traps[state.level];
      if (trap === body.tile) {
        state.failedLevel = state.level;
        finishSession(ctx.db, session.id, {
          status: 'lost',
          payout: 0,
          state,
          outcome: { trap: true, level: state.level },
        });
      } else {
        state.choices.push(body.tile);
        state.level += 1;
        state.multiplier = Math.min(towerMultiplier(state.level, edge), 1_000_000);
        if (state.level === levels) {
          const payout = Math.min(Math.floor(session.bet * state.multiplier), maxPayout(ctx.db));
          const ledgerId = creditPayout(
            ctx.db,
            { id: session.id, user_id: session.user_id, game_id: session.game_id },
            payout,
            'Towers — reached the top',
          );
          finishSession(ctx.db, session.id, {
            status: 'won',
            payout,
            state,
            outcome: { cleared: true, multiplier: state.multiplier },
            payoutLedgerId: ledgerId,
          });
        } else {
          updateSessionState(ctx.db, session.id, state);
        }
      }
    }

    const updated = getSessionRow(ctx.db, session.id);
    if (!updated) throw new Error('Session missing');
    const finalState = parseJson<TowersState>(updated.state, state);
    return towersView(updated, finalState, balanceOf(ctx.db, ctx.user.id), levels);
  },

  resume(row, balance) {
    const state = parseJson<TowersState | null>(row.state, null);
    if (!state) throw new Error('Corrupt game state');
    return towersView(row, state, balance, state.traps.length);
  },
};
