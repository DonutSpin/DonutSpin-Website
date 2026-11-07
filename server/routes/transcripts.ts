import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import { parse, pageQuerySchema } from '../lib/validation.ts';
import { requireAuth } from '../lib/permissions.ts';
import { badRequest } from '../lib/core.ts';
import { buildTranscriptList, getTranscriptDetail } from '../lib/transcripts.ts';

const listSchema = pageQuerySchema.extend({
  scope: z.enum(['own', 'all']).optional(),
  kind: z.enum(['ticket', 'cashier']).optional(),
  q: z.string().trim().max(140).optional(),
});

const kindSchema = z.enum(['ticket', 'cashier']);

export function createTranscriptsRouter(db: DB): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const user = requireAuth(req);
    const query = parse(listSchema, req.query);
    res.json(
      buildTranscriptList(db, user, {
        scope: query.scope ?? 'own',
        kind: query.kind,
        search: query.q,
        page: query.page,
        pageSize: query.pageSize,
      }),
    );
  });

  router.get('/:kind/:reference', (req, res) => {
    const user = requireAuth(req);
    const kind = kindSchema.safeParse(req.params.kind);
    if (!kind.success) throw badRequest('Choose a ticket or cashier transcript.', 'INVALID_TRANSCRIPT_KIND');
    const reference = req.params.reference ?? '';
    if (!reference) throw badRequest('A transcript reference is required.', 'INVALID_TRANSCRIPT_REFERENCE');
    res.json({ transcript: getTranscriptDetail(db, user, kind.data, reference) });
  });

  return router;
}
