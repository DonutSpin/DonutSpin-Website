import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import {
  LEGAL_EFFECTIVE_DATE,
  LEGAL_PRIVACY_VERSION,
  LEGAL_TERMS_VERSION,
  type LegalStatus,
} from '../../shared/legal.ts';
import { loadUser } from '../auth.ts';
import { recordAudit } from '../lib/audit.ts';
import { clientIp } from '../lib/core.ts';
import {
  isCurrentLegalAcceptance,
  latestLegalAcceptance,
  recordLegalAcceptance,
} from '../lib/legal.ts';
import { requireAuth } from '../lib/permissions.ts';
import { parse } from '../lib/validation.ts';

const requiredConsent = (message: string) =>
  z.boolean().refine((value) => value === true, { message });

const acceptSchema = z.object({
  ageConfirmed: requiredConsent('You must confirm that you are 18 years or older.'),
  acceptTerms: requiredConsent('You must agree to the Terms of Service and Privacy Policy.'),
  acknowledgeDonutRules: requiredConsent('You must acknowledge the DonutSMP risk.'),
});

function statusFor(db: DB, userId: string): LegalStatus {
  const accepted = latestLegalAcceptance(db, userId);
  return {
    current: {
      termsVersion: LEGAL_TERMS_VERSION,
      privacyVersion: LEGAL_PRIVACY_VERSION,
      effectiveDate: LEGAL_EFFECTIVE_DATE,
    },
    accepted: accepted
      ? {
          id: accepted.id,
          termsVersion: accepted.terms_version,
          privacyVersion: accepted.privacy_version,
          acceptedAt: accepted.accepted_at,
          ip: accepted.ip,
        }
      : null,
    required: !isCurrentLegalAcceptance(accepted),
  };
}

export function createLegalRouter(db: DB): Router {
  const router = Router();

  router.get('/status', (req, res) => {
    const user = requireAuth(req);
    res.set('Cache-Control', 'no-store');
    res.json(statusFor(db, user.id));
  });

  router.post('/accept', (req, res) => {
    const user = requireAuth(req);
    parse(acceptSchema, req.body);
    recordLegalAcceptance(db, {
      userId: user.id,
      ip: clientIp(req),
      userAgent: req.get('user-agent') ?? null,
    });
    recordAudit(db, {
      actorId: user.id,
      action: 'legal.accept',
      targetType: 'legal_acceptance',
      targetId: user.id,
      targetLabel: `Terms ${LEGAL_TERMS_VERSION}`,
      metadata: {
        termsVersion: LEGAL_TERMS_VERSION,
        privacyVersion: LEGAL_PRIVACY_VERSION,
      },
      ip: clientIp(req),
    });
    res.json({ user: loadUser(db, user.id), status: statusFor(db, user.id) });
  });

  return router;
}
