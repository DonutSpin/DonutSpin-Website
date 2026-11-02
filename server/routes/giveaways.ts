import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import {
  GIVEAWAY_MAX_DURATION_SECONDS,
  GIVEAWAY_MAX_WINNERS,
  GIVEAWAY_MIN_AMOUNT,
  GIVEAWAY_MIN_DURATION_SECONDS,
  GIVEAWAY_MIN_WINNERS,
} from '../../shared/types.ts';
import { amountSchema } from '../lib/amount.ts';
import { assertNotOnHold } from '../lib/account-status.ts';
import { ApiError } from '../lib/core.ts';
import { assertNotInMaintenance } from '../lib/maintenance.ts';
import { requireActive, requireAuth, requirePermission } from '../lib/permissions.ts';
import { ticketCreateLimiter } from '../lib/rate-limit.ts';
import {
  approveClaim,
  approveSponsorship,
  cancelGiveaway,
  cancelSponsorship,
  createGiveaway,
  featuredGiveaways,
  giveawayOverview,
  joinGiveaway,
  manageGiveaways,
  openClaimTicket,
  publishSponsorship,
  rejectClaim,
  rejectSponsorship,
  requestSponsorship,
  updateGiveaway,
} from '../lib/giveaways.ts';
import { parse } from '../lib/validation.ts';

const isoDate = z.string().trim().min(1, 'Choose a valid date and time.');

const createSchema = z.object({
  title: z.string().trim().min(4, 'Use at least 4 characters.').max(100, 'Keep the title under 100 characters.'),
  description: z.string().trim().max(2000).optional().default(''),
  prizeAmount: amountSchema({
    min: GIVEAWAY_MIN_AMOUNT,
    max: 1_000_000_000_000,
    label: 'giveaway prize',
  }),
  winnerCount: z
    .number()
    .int()
    .min(GIVEAWAY_MIN_WINNERS, `Choose at least ${GIVEAWAY_MIN_WINNERS} winner.`)
    .max(GIVEAWAY_MAX_WINNERS, `Choose at most ${GIVEAWAY_MAX_WINNERS} winners.`),
  startsAt: isoDate,
  endsAt: isoDate,
  bannerUrl: z.string().trim().max(500).nullable().optional(),
});

const updateSchema = z.object({
  title: z.string().trim().min(4).max(100).optional(),
  description: z.string().trim().max(2000).optional(),
  prizeAmount: amountSchema({ min: GIVEAWAY_MIN_AMOUNT, max: 1_000_000_000_000, label: 'giveaway prize' }).optional(),
  winnerCount: z.number().int().min(GIVEAWAY_MIN_WINNERS).max(GIVEAWAY_MAX_WINNERS).optional(),
  startsAt: isoDate.optional(),
  endsAt: isoDate.optional(),
  bannerUrl: z.string().trim().max(500).nullable().optional(),
});

const reasonSchema = z.object({
  reason: z.string().trim().min(3, 'Provide at least 3 characters.').max(500),
});

const cancelSchema = z.object({
  reason: z.string().trim().min(3, 'Provide a short cancellation reason.').max(500),
});

const claimSchema = z.object({
  message: z.string().trim().max(1000).optional().default(''),
});

const sponsorshipSchema = z.object({
  prizeAmount: amountSchema({
    min: GIVEAWAY_MIN_AMOUNT,
    max: 1_000_000_000_000,
    label: 'sponsorship prize',
  }),
  winnerCount: z.number().int().min(GIVEAWAY_MIN_WINNERS).max(GIVEAWAY_MAX_WINNERS),
  durationSeconds: z
    .number()
    .int()
    .min(GIVEAWAY_MIN_DURATION_SECONDS)
    .max(GIVEAWAY_MAX_DURATION_SECONDS),
  title: z.string().trim().max(100).optional(),
  description: z.string().trim().max(2000).optional(),
  message: z.string().trim().max(1000).optional(),
});

const publishSchema = z.object({
  title: z.string().trim().min(4).max(100).optional(),
  description: z.string().trim().max(2000).optional(),
  startsAt: isoDate.optional(),
  endsAt: isoDate.optional(),
});

export function createGiveawaysRouter(db: DB): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const user = requireAuth(req);
    res.set('Cache-Control', 'no-store');
    res.json(giveawayOverview(db, user));
  });

  router.get('/featured', (req, res) => {
    const user = requireAuth(req);
    res.set('Cache-Control', 'no-store');
    res.json(featuredGiveaways(db, user.id));
  });

  router.get('/manage', (req, res) => {
    const user = requirePermission(req, 'giveaways.manage');
    res.set('Cache-Control', 'no-store');
    res.json(manageGiveaways(db, user));
  });

  router.post('/', (req, res) => {
    const staff = requirePermission(req, 'giveaways.manage');
    const body = parse(createSchema, req.body);
    res.status(201).json({ giveaway: createGiveaway(db, staff, body) });
  });

  router.patch('/:id', (req, res) => {
    const staff = requirePermission(req, 'giveaways.manage');
    const body = parse(updateSchema, req.body);
    res.json({ giveaway: updateGiveaway(db, staff, req.params.id ?? '', body) });
  });

  router.post('/:id/cancel', (req, res) => {
    const staff = requirePermission(req, 'giveaways.manage');
    const body = parse(cancelSchema, req.body);
    res.json({ giveaway: cancelGiveaway(db, staff, req.params.id ?? '', body.reason) });
  });

  router.post('/:id/join', (req, res) => {
    const user = requireActive(req);
    requirePermission(req, 'giveaways.join');
    assertNotOnHold(user);
    assertNotInMaintenance(db);
    res.json({ giveaway: joinGiveaway(db, user, req.params.id ?? '') });
  });

  router.post('/:id/claim', (req, res) => {
    const user = requireActive(req);
    requirePermission(req, 'giveaways.join');
    requirePermission(req, 'tickets.create');
    assertNotOnHold(user);
    assertNotInMaintenance(db);
    const body = parse(claimSchema, req.body);
    res.status(201).json(openClaimTicket(db, user, req.params.id ?? '', body.message));
  });

  router.post('/claims/:winnerId/approve', (req, res) => {
    const staff = requirePermission(req, 'giveaways.manage');
    res.json({ claim: approveClaim(db, staff, req.params.winnerId ?? '') });
  });

  router.post('/claims/:winnerId/reject', (req, res) => {
    const staff = requirePermission(req, 'giveaways.manage');
    const body = parse(reasonSchema, req.body);
    res.json({ claim: rejectClaim(db, staff, req.params.winnerId ?? '', body.reason) });
  });

  router.post('/sponsorships', (req, res) => {
    const user = requireActive(req);
    requirePermission(req, 'giveaways.sponsor');
    requirePermission(req, 'tickets.create');
    assertNotOnHold(user);
    assertNotInMaintenance(db);
    const limit = ticketCreateLimiter.consume(user.id);
    if (!limit.allowed) {
      throw new ApiError(429, 'RATE_LIMITED', 'You have opened several tickets recently. Please wait before trying again.');
    }
    const body = parse(sponsorshipSchema, req.body);
    res.status(201).json({ sponsorship: requestSponsorship(db, user, body) });
  });

  router.post('/sponsorships/:id/approve', (req, res) => {
    const staff = requirePermission(req, 'giveaways.manage');
    res.json({ sponsorship: approveSponsorship(db, staff, req.params.id ?? '') });
  });

  router.post('/sponsorships/:id/reject', (req, res) => {
    const staff = requirePermission(req, 'giveaways.manage');
    const body = parse(reasonSchema, req.body);
    res.json({ sponsorship: rejectSponsorship(db, staff, req.params.id ?? '', body.reason) });
  });

  router.post('/sponsorships/:id/publish', (req, res) => {
    const staff = requirePermission(req, 'giveaways.manage');
    const body = parse(publishSchema, req.body);
    res.status(201).json({ giveaway: publishSponsorship(db, staff, req.params.id ?? '', body) });
  });

  router.post('/sponsorships/:id/refund', (req, res) => {
    const staff = requirePermission(req, 'giveaways.manage');
    res.json({ sponsorship: cancelSponsorship(db, staff, req.params.id ?? '') });
  });

  return router;
}
