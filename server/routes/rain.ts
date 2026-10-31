import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import { setSetting } from '../db/index.ts';
import { RAIN_COUNTDOWN_MAX_SECONDS, RAIN_COUNTDOWN_MIN_SECONDS } from '../../shared/types.ts';
import { amountSchema } from '../lib/amount.ts';
import { recordAudit } from '../lib/audit.ts';
import { assertNotOnHold } from '../lib/account-status.ts';
import { clientIp, inTransaction } from '../lib/core.ts';
import { requireActive, requireAuth, requirePermission } from '../lib/permissions.ts';
import {
  createRain,
  joinRain,
  leaveRain,
  rainHistory,
  rainLimits,
  rainState,
  RAIN_MAX_SETTING,
  RAIN_MIN_SETTING,
} from '../lib/rain.ts';
import { parse } from '../lib/validation.ts';
import { balanceOf } from '../lib/wallet.ts';

const createSchema = z.object({
  amount: amountSchema({ max: 1_000_000_000_000, label: 'rain' }),
  countdownSeconds: z
    .number()
    .int()
    .min(RAIN_COUNTDOWN_MIN_SECONDS, `Countdown must be at least ${RAIN_COUNTDOWN_MIN_SECONDS} seconds.`)
    .max(RAIN_COUNTDOWN_MAX_SECONDS, `Countdown must be at most ${RAIN_COUNTDOWN_MAX_SECONDS} seconds.`),
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).optional().default(10),
});

const limitsSchema = z
  .object({
    minAmount: amountSchema({ max: 1_000_000_000_000, label: 'minimum rain' }),
    maxAmount: amountSchema({ max: 1_000_000_000_000, label: 'maximum rain' }),
  })
  .refine((value) => value.maxAmount >= value.minAmount, {
    message: 'Maximum rain amount must be at least the minimum.',
    path: ['maxAmount'],
  });

export function createRainRouter(db: DB): Router {
  const router = Router();

  // The homepage polls this endpoint. It also settles an expired rain lazily,
  // so correctness never depends on the browser staying open.
  router.get('/', (req, res) => {
    const user = requireAuth(req);
    res.set('Cache-Control', 'no-store');
    res.json({ rain: rainState(db, user.id) });
  });

  router.post('/', (req, res) => {
    const user = requireActive(req);
    // Moving money out of a wallet follows the same hold rules as the cashier.
    assertNotOnHold(user);
    const body = parse(createSchema, req.body);
    res.status(201).json({ rain: createRain(db, user, body), balance: balanceOf(db, user.id) });
  });

  router.post('/join', (req, res) => {
    const user = requireActive(req);
    res.json({ rain: joinRain(db, user) });
  });

  router.post('/leave', (req, res) => {
    const user = requireActive(req);
    res.json({ rain: leaveRain(db, user) });
  });

  router.get('/history', (req, res) => {
    const user = requirePermission(req, 'rain.manage');
    const query = parse(historyQuerySchema, req.query);
    res.json({ items: rainHistory(db, user.id, query.limit) });
  });

  router.get('/settings', (req, res) => {
    requirePermission(req, 'rain.manage');
    res.json(rainLimits(db));
  });

  /**
   * Moderators own the platform-wide rain bounds. Both values are saved in one
   * transaction and audited; no deployment or code change is required.
   */
  router.patch('/settings', (req, res) => {
    const moderator = requirePermission(req, 'rain.manage');
    const body = parse(limitsSchema, req.body);
    const previous = rainLimits(db);
    inTransaction(db, () => {
      setSetting(db, RAIN_MIN_SETTING, body.minAmount, moderator.id);
      setSetting(db, RAIN_MAX_SETTING, body.maxAmount, moderator.id);
      recordAudit(db, {
        actorId: moderator.id,
        action: 'rain.limits.update',
        targetType: 'setting',
        targetId: 'rain.limits',
        targetLabel: 'Rain amount limits',
        metadata: { previous, next: body },
        ip: clientIp(req),
      });
    });
    res.json(rainLimits(db));
  });

  return router;
}
