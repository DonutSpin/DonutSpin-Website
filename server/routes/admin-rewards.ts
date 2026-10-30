import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import { setSetting } from '../db/index.ts';
import { clientIp, inTransaction } from '../lib/core.ts';
import { requirePermission } from '../lib/permissions.ts';
import { recordAudit } from '../lib/audit.ts';
import { getRewardsConfig, isValidTimezone, rewardsAdminView } from '../lib/rewards.ts';
import { parse } from '../lib/validation.ts';
import { amountSchema } from '../lib/amount.ts';

const milestoneSchema = z.object({
  day: z.number().int().min(1).max(3650),
  amount: amountSchema({ min: 0, max: 1_000_000_000_000, allowZero: true, label: 'milestone bonus' }),
  label: z.string().trim().min(1).max(60),
});

const rewardsConfigSchema = z
  .object({
    enabled: z.boolean(),
    timezone: z.string().trim().min(1).max(80).refine(isValidTimezone, 'Use a valid IANA timezone, for example Europe/London.'),
    resetHour: z.number().int().min(0).max(23),
    baseAmount: amountSchema({ min: 0, max: 1_000_000_000_000, allowZero: true, label: 'base reward' }),
    incrementAmount: amountSchema({ min: 0, max: 1_000_000_000_000, allowZero: true, label: 'streak increment' }),
    maxAmount: amountSchema({ min: 1, max: 1_000_000_000_000, label: 'reward cap' }),
    maxStreakDays: z.number().int().min(1).max(3650),
    missedPolicy: z.enum(['reset', 'grace']),
    graceDays: z.number().int().min(0).max(14),
    emailEnabled: z.boolean(),
    milestones: z.array(milestoneSchema).max(12),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<number>();
    value.milestones.forEach((milestone, index) => {
      if (seen.has(milestone.day)) {
        ctx.addIssue({ code: 'custom', path: ['milestones', index, 'day'], message: 'Milestone days must be unique.' });
      }
      seen.add(milestone.day);
      if (milestone.day > value.maxStreakDays) {
        ctx.addIssue({
          code: 'custom',
          path: ['milestones', index, 'day'],
          message: 'Milestone day cannot exceed the maximum streak length.',
        });
      }
    });
    if (value.missedPolicy === 'grace' && value.graceDays < 1) {
      ctx.addIssue({ code: 'custom', path: ['graceDays'], message: 'Grace mode needs at least one grace day.' });
    }
  });

function adminView(db: DB) {
  const view = rewardsAdminView(db);
  const claims = db
    .prepare(
      `SELECT rc.*, u.username
       FROM reward_claims rc JOIN users u ON u.id = rc.user_id
       ORDER BY rc.created_at DESC LIMIT 15`,
    )
    .all() as {
    id: string;
    username: string;
    claim_day: string;
    streak_day: number;
    base_amount: number;
    increment_amount: number;
    milestone_amount: number;
    amount: number;
    created_at: string;
  }[];
  return {
    ...view,
    recentClaims: claims.map((row) => ({
      id: row.id,
      username: row.username,
      day: row.claim_day,
      streakDay: row.streak_day,
      baseAmount: row.base_amount,
      incrementAmount: row.increment_amount,
      milestoneAmount: row.milestone_amount,
      amount: row.amount,
      createdAt: row.created_at,
    })),
  };
}

export function createAdminRewardsRouter(db: DB): Router {
  const router = Router();

  router.get('/rewards', (req, res) => {
    requirePermission(req, 'settings.manage');
    res.json(adminView(db));
  });

  router.patch('/rewards', (req, res) => {
    const admin = requirePermission(req, 'settings.manage');
    const body = parse(rewardsConfigSchema, req.body);
    const before = getRewardsConfig(db);
    const after = {
      enabled: body.enabled,
      timezone: body.timezone,
      resetHour: body.resetHour,
      baseAmount: body.baseAmount,
      incrementAmount: body.incrementAmount,
      maxAmount: body.maxAmount,
      maxStreakDays: body.maxStreakDays,
      missedPolicy: body.missedPolicy,
      graceDays: body.graceDays,
      milestones: [...body.milestones].sort((a, b) => a.day - b.day),
      emailEnabled: body.emailEnabled,
    };
    inTransaction(db, () => {
      setSetting(db, 'rewards.enabled', after.enabled, admin.id);
      setSetting(db, 'rewards.timezone', after.timezone, admin.id);
      setSetting(db, 'rewards.reset_hour', after.resetHour, admin.id);
      setSetting(db, 'rewards.base_amount', after.baseAmount, admin.id);
      setSetting(db, 'rewards.increment_amount', after.incrementAmount, admin.id);
      setSetting(db, 'rewards.max_amount', after.maxAmount, admin.id);
      setSetting(db, 'rewards.max_streak_days', after.maxStreakDays, admin.id);
      setSetting(db, 'rewards.missed_policy', after.missedPolicy, admin.id);
      setSetting(db, 'rewards.grace_days', after.graceDays, admin.id);
      setSetting(db, 'rewards.milestones', after.milestones, admin.id);
      setSetting(db, 'rewards.email_enabled', after.emailEnabled, admin.id);
      recordAudit(db, {
        actorId: admin.id,
        action: 'rewards.settings_update',
        targetType: 'rewards',
        targetId: 'daily',
        targetLabel: 'Daily rewards',
        metadata: { before, after },
        ip: clientIp(req),
      });
    });
    res.json(adminView(db));
  });

  return router;
}

