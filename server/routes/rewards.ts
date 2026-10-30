import { Router } from 'express';
import type { DB } from '../db/index.ts';
import { requireAuth } from '../lib/permissions.ts';
import { assertNotOnHold } from '../lib/account-status.ts';
import { claimReward, getRewardsConfig, rewardsSummary } from '../lib/rewards.ts';
import { notify } from '../lib/notifications.ts';
import { enqueueEmail, getEmailConfig } from '../lib/email.ts';
import { compactAmount } from '../../shared/amount.ts';
import type { RewardClaimResult } from '../../shared/types.ts';

export function createRewardsRouter(db: DB): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const user = requireAuth(req);
    res.set('Cache-Control', 'no-store');
    res.json(rewardsSummary(db, user.id));
  });

  router.post('/claim', (req, res) => {
    const user = requireAuth(req);
    assertNotOnHold(user);
    const result = claimReward(db, user.id);
    const config = getRewardsConfig(db);

    notify(db, {
      userId: user.id,
      type: 'reward',
      title: `Day ${result.claim.streakDay} reward claimed`,
      body: `${compactAmount(result.claim.amount)} DonutSMP money was added to your wallet.${result.claim.milestoneLabel ? ` ${result.claim.milestoneLabel} included.` : ''}`,
      link: '/rewards',
    });

    if (result.summary.emailNotifications && config.emailEnabled && getEmailConfig(db).rewardNotifications) {
      enqueueEmail(db, {
        userId: user.id,
        recipient: user.email,
        template: 'reward-claimed',
        payload: {
          username: user.username,
          amount: result.claim.amount,
          streakDay: result.claim.streakDay,
          milestoneLabel: result.claim.milestoneLabel,
          nextResetAt: result.summary.nextResetAt,
          timezone: result.summary.timezone,
        },
        dedupeKey: `reward-email:${result.claim.id}`,
      });
    }

    const payload: RewardClaimResult = {
      ...result.summary,
      claim: result.claim,
      balance: result.balance,
    };
    res.json(payload);
  });

  return router;
}
