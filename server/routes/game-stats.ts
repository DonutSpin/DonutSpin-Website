import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import { parse } from '../lib/validation.ts';
import { requirePermission } from '../lib/permissions.ts';
import { getGameStats, getGameStatsDetail } from '../lib/game-stats.ts';

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

  router.get('/:slug', (req, res) => {
    requirePermission(req, 'staff.access');
    const query = parse(detailQuerySchema, req.query);
    res.json(getGameStatsDetail(db, req.params.slug ?? '', query.range));
  });

  return router;
}
