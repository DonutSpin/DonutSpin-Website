import { Router } from 'express';
import type { DB } from '../db/index.ts';
import { config } from '../config.ts';
import { getSetting } from '../db/index.ts';
import { loadSupportCategories } from '../lib/tickets.ts';
import { isMaintenanceMode, maintenanceMessage } from '../lib/maintenance.ts';
import { emailReady, getEmailConfig } from '../lib/email.ts';
import type { PublicConfig } from '../../shared/types.ts';

export function createPublicRouter(db: DB): Router {
  const router = Router();

  router.get('/config', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const payload: PublicConfig = {
      name: getSetting(db, 'platform.name', config.appName),
      tagline: getSetting(db, 'platform.tagline', 'The casino for DonutSMP money.'),
      registrationOpen: getSetting(db, 'platform.registration_open', true),
      maintenance: isMaintenanceMode(db),
      maintenanceMessage: maintenanceMessage(db),
      startingCredits: getSetting(db, 'economy.starting_credits', config.startingCredits),
      rewardsEnabled: getSetting(db, 'rewards.enabled', true),
      emailEnabled: (() => {
        const email = getEmailConfig(db);
        return email.enabled && emailReady(email);
      })(),
      supportCategories: loadSupportCategories(db, true),
    };
    res.json(payload);
  });

  router.get('/health', (_req, res) => {
    const row = db.prepare('SELECT 1 AS ok').get() as { ok: number };
    res.json({ ok: row.ok === 1, time: new Date().toISOString() });
  });

  return router;
}
