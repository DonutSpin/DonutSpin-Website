import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import type { GameConfig, GameSessionSummary } from '../../shared/types.ts';
import { getSetting } from '../db/index.ts';
import { config as appConfig } from '../config.ts';
import { ApiError, badRequest, inTransaction, notFound, pagination } from '../lib/core.ts';
import { amountSchema } from '../lib/amount.ts';
import {
  adoptLegacyActiveRound,
  assertNoActiveRound,
  clearActiveRoundForSession,
  loadActiveRound,
  recordActiveRound,
  settleActiveRound,
} from '../lib/active-round.ts';
import { requireActive, requireAuth, requirePermission } from '../lib/permissions.ts';
import { assertCanWager } from '../lib/account-status.ts';
import { assertNotInMaintenance, isMaintenanceMode } from '../lib/maintenance.ts';
import { parse, pageQuerySchema } from '../lib/validation.ts';
import { balanceOf } from '../lib/wallet.ts';
import {
  assertWager,
  findReplay,
  getSessionRow,
  loadGame,
  parseGameConfig,
  type GameSessionRow,
} from '../games/common.ts';
import { getGameModule, publicGameConfig } from '../games/index.ts';
import { capBelowWager } from '../../shared/payout.ts';

const requestIdSchema = z
  .string()
  .min(8, 'Request id is too short.')
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid request id.');

const playSchema = z.object({
  requestId: requestIdSchema,
  bet: amountSchema({ max: 1_000_000_000_000 }),
});

const actionSchema = z.object({
  requestId: requestIdSchema,
});

function sessionSummary(row: GameSessionRow): GameSessionSummary {
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

export function createGamesRouter(db: DB): Router {
  const router = Router();

  router.get('/', (req, res) => {
    requireAuth(req);
    const rows = db.prepare('SELECT * FROM games ORDER BY name').all() as Parameters<typeof parseGameConfig>[0][];
    const games: GameConfig[] = rows.map((row) => {
      const parsed = parseGameConfig(row);
      return {
        slug: row.id,
        name: row.name,
        description: row.description,
        enabled: Boolean(row.enabled),
        minBet: row.min_bet,
        maxBet: row.max_bet,
        config: publicGameConfig(row.id, parsed),
        updatedAt: row.updated_at,
      };
    });
    res.json({
      games,
      maxPayout: getSetting(db, 'economy.max_payout', 1_000_000_000_000),
      maintenance: isMaintenanceMode(db),
      startingCredits: getSetting(db, 'economy.starting_credits', appConfig.startingCredits),
    });
  });

  router.get('/active', (req, res) => {
    const user = requireAuth(req);
    res.json({ round: loadActiveRound(db, user.id) });
  });

  router.get('/history', (req, res) => {
    const user = requireAuth(req);
    const { page, pageSize } = parse(pageQuerySchema, req.query);
    const total = (
      db.prepare('SELECT COUNT(*) AS count FROM game_sessions WHERE user_id = ?').get(user.id) as { count: number }
    ).count;
    const rows = db
      .prepare('SELECT * FROM game_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(user.id, pageSize, (page - 1) * pageSize) as GameSessionRow[];
    res.json({
      items: rows.map(sessionSummary),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      balance: balanceOf(db, user.id),
    });
  });

  router.get('/sessions/:id', (req, res) => {
    const user = requireAuth(req);
    const row = getSessionRow(db, req.params.id ?? '');
    if (!row || row.user_id !== user.id) throw notFound('Game session not found.');
    const module = getGameModule(row.game_id);
    if (!module) throw notFound('Game not available.');
    res.json(module.resume(row, balanceOf(db, user.id), getSetting(db, 'economy.max_payout', 1_000_000_000_000)));
  });

  router.post('/:slug/play', async (req, res) => {
    const user = requireActive(req);
    requirePermission(req, 'games.play');
    assertCanWager(user);
    assertNotInMaintenance(db);
    const slug = req.params.slug ?? '';
    const module = getGameModule(slug);
    if (!module) throw notFound('Game not found.');
    const game = loadGame(db, slug);
    if (!game.enabled) throw badRequest(`${game.name} is currently unavailable.`, 'GAME_DISABLED');
    const parsed = parse(playSchema, req.body);
    assertWager(game, parsed.bet);
    // A wager above the per-round payout ceiling could not even be returned by
    // a 1x round, so it is refused instead of silently capped.
    if (capBelowWager(parsed.bet, getSetting(db, 'economy.max_payout', 1_000_000_000_000))) {
      throw badRequest('That wager is above the platform payout limit.', 'WAGER_ABOVE_PAYOUT_CAP');
    }

    const replay = findReplay(db, user.id, parsed.requestId);
    if (replay && replay.game_id !== slug) {
      throw badRequest('This request id was already used for another game.', 'REQUEST_ID_REUSED');
    }

    const gameConfig = parseGameConfig(game);
    const view = (() => {
      try {
        return inTransaction(db, () => {
          // Re-check inside the write transaction so two concurrent retries with the
          // same request id resolve to a replay instead of fighting over the slot.
          const existing = findReplay(db, user.id, parsed.requestId);
          if (!existing) assertNoActiveRound(db, user.id);
          const started = module.start({
            db,
            user,
            game,
            gameConfig,
            bet: parsed.bet,
            requestId: parsed.requestId,
            body: req.body as Record<string, unknown>,
          });
          if (!existing) recordActiveRound(db, user.id, slug, started);
          return started;
        });
      } catch (error) {
        // A session from before the lock existed is adopted after the failed
        // start rolls back, so the next page load can restore it.
        if (error instanceof ApiError && error.code === 'ACTIVE_ROUND') adoptLegacyActiveRound(db, user.id);
        throw error;
      }
    })();
    res.status(201).json(view);
  });

  router.post('/sessions/:id/action', async (req, res) => {
    const user = requireActive(req);
    requirePermission(req, 'games.play');
    // Double-down adds real money to the existing wager, so it is a new bet and
    // must satisfy the same verification and hold gates as a fresh round.
    if ((req.body as { action?: unknown } | null)?.action === 'double') assertCanWager(user);
    assertNotInMaintenance(db);
    const sessionId = req.params.id ?? '';
    const session = getSessionRow(db, sessionId);
    if (!session || session.user_id !== user.id) throw notFound('Game session not found.');
    const module = getGameModule(session.game_id);
    if (!module?.action) throw badRequest('This game does not accept actions.', 'NO_ACTIONS');
    const game = loadGame(db, session.game_id);
    const parsed = parse(actionSchema, req.body);
    const view = inTransaction(db, () => {
      const result = module.action!({
        db,
        user,
        sessionId,
        game,
        gameConfig: parseGameConfig(game),
        body: req.body as Record<string, unknown>,
        requestId: parsed.requestId,
      });
      if (result.session.status !== 'active') settleActiveRound(db, user.id, sessionId);
      return result;
    });
    res.json(view);
  });

  router.post('/sessions/:id/acknowledge', (req, res) => {
    const user = requireAuth(req);
    const session = getSessionRow(db, req.params.id ?? '');
    if (!session || session.user_id !== user.id) throw notFound('Game session not found.');
    if (session.status === 'active') {
      throw badRequest('Finish this round before clearing it.', 'ROUND_ACTIVE');
    }
    clearActiveRoundForSession(db, user.id, session.id);
    res.json({ ok: true });
  });

  return router;
}

