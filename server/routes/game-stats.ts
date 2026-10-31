import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import { setSetting } from '../db/index.ts';
import { clientIp, inTransaction, nowIso } from '../lib/core.ts';
import { parse } from '../lib/validation.ts';
import { requirePermission } from '../lib/permissions.ts';
import { recordAudit } from '../lib/audit.ts';
import { STATS_RESET_SETTING, getGameStats, getGameStatsDetail, statsResetAt } from '../lib/game-stats.ts';

const listQuerySchema = z.object({
  range: z.enum(['24h', '7d', '30d', '90d', 'all']).optional().default('30d'),
  q: z.string().trim().max(80).optional().default(''),
  sort: z
    .enum(['name', 'bets', 'winRate', 'wagered', 'houseProfit', 'configuredWinChance'])
    .optional()
    .default('wagered'),
  direction: z.enum(['asc', 'desc']).optional().default('desc'),
});

const detailQuerySchema = z.object({
  range: z.enum(['24h', '7d', '30d', '90d', 'all']).optional().default('30d'),
});

export function createGameStatsRouter(db: DB): Router {
  const router = Router();

  router.get('/', (req, res) => {
    requirePermission(req, 'staff.access');
    const query = parse(listQuerySchema, req.query);
    res.json(
      getGameStats(db, {
        range: query.range,
        search: query.q,
        sort: query.sort,
        direction: query.direction,
      }),
    );
  });

  /**
   * Starts a fresh statistics window. This only moves the reporting cutoff; it
   * never deletes game sessions, ledger entries, wallets or balances.
   */
  router.post('/reset', (req, res) => {
    const admin = requirePermission(req, 'games.manage');
    const resetAt = nowIso();
    const previousResetAt = statsResetAt(db);
    inTransaction(db, () => {
      setSetting(db, STATS_RESET_SETTING, resetAt, admin.id);
      recordAudit(db, {
        actorId: admin.id,
        action: 'game_stats.reset',
        targetType: 'statistics',
        targetId: STATS_RESET_SETTING,
        targetLabel: 'Game statistics',
        metadata: { previousResetAt, resetAt },
        ip: clientIp(req),
      });
    });
    res.json({ resetAt, statsSince: resetAt });
  });

  router.get('/:slug', (req, res) => {
    requirePermission(req, 'staff.access');
    const query = parse(detailQuerySchema, req.query);
    res.json(getGameStatsDetail(db, req.params.slug ?? '', query.range));
  });

  return router;
}
