import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import type { CashierRequestKind, SessionUser } from '../../shared/types.ts';
import { getSetting } from '../db/index.ts';
import {
  ApiError,
  badRequest,
  clientIp,
  conflict,
  inTransaction,
  newId,
  notFound,
  nowIso,
} from '../lib/core.ts';
import { parse, pageQuerySchema } from '../lib/validation.ts';
import { amountSchema } from '../lib/amount.ts';
import { compactAmount } from '../../shared/amount.ts';
import { requireActive, requirePermission } from '../lib/permissions.ts';
import { assertNotOnHold } from '../lib/account-status.ts';
import { applyLedger, balanceOf } from '../lib/wallet.ts';
import { recordAudit } from '../lib/audit.ts';
import { notify } from '../lib/notifications.ts';
import { enqueueEmail } from '../lib/email.ts';
import { assertNotInMaintenance } from '../lib/maintenance.ts';
import { cashierRequestLimiter } from '../lib/rate-limit.ts';
import {
  addCashierEvent,
  addCashierMessage,
  buildCashierList,
  canManageCashier,
  cashierCounts,
  generateCashierReference,
  getCashierDetail,
  loadCashierRow,
  notifyCashierAdmins,
} from '../lib/cashier.ts';
import { queueCashierNotification, queueCashierTranscript } from '../lib/discord/support.ts';

const createSchema = z.object({
  kind: z.enum(['deposit', 'withdrawal']),
  amount: amountSchema({ max: 1_000_000_000_000 }),
});

const messageSchema = z.object({
  body: z.string().trim().min(1, 'Write a message before sending.').max(2000, 'Messages are limited to 2,000 characters.'),
});

const listQuerySchema = pageQuerySchema.extend({
  status: z.enum(['all', 'pending', 'approved', 'rejected', 'cancelled']).optional(),
  kind: z.enum(['deposit', 'withdrawal']).optional(),
  q: z.string().trim().max(120).optional(),
});

const decisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.decision === 'reject' && (!value.reason || value.reason.length < 5)) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Record a reason of at least 5 characters.' });
    }
  });

const cancelSchema = z.object({ reason: z.string().trim().max(500).optional() });

const amountEditSchema = z.object({
  amount: amountSchema({ max: 1_000_000_000_000 }),
  reason: z.string().trim().max(500).optional(),
});

const holdSchema = z.object({ reason: z.string().trim().min(3, 'Record a short reason.').max(500) });

function requestLimit(db: DB): number {
  return getSetting(db, 'economy.cashier_request_limit', 5_000_000_000);
}

function kindLabel(kind: CashierRequestKind): string {
  return kind === 'deposit' ? 'Deposit' : 'Withdrawal';
}

function loadRequestOrThrow(db: DB, reference: string) {
  const row = loadCashierRow(db, reference);
  if (!row) throw notFound('Cashier request not found.');
  return row;
}

function assertOwnRequest(user: SessionUser, row: { user_id: string }): void {
  if (row.user_id !== user.id) throw notFound('Cashier request not found.');
}

export function createCashierRouter(db: DB): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const user = requireActive(req);
    const query = parse(listQuerySchema, req.query);
    const { items, total } = buildCashierList(db, {
      requesterId: user.id,
      status: query.status,
      kind: query.kind,
      search: query.q,
      page: query.page,
      pageSize: query.pageSize,
    });
    res.json({
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      counts: cashierCounts(db, user.id),
      balance: balanceOf(db, user.id),
      requestLimit: requestLimit(db),
    });
  });

  router.post('/', (req, res) => {
    const user = requireActive(req);
    requirePermission(req, 'cashier.request');
    assertNotOnHold(user);
    const limiter = cashierRequestLimiter.consume(user.id);
    if (!limiter.allowed) {
      throw new ApiError(429, 'RATE_LIMITED', 'You have opened several cashier requests recently. Please wait before submitting another.');
    }
    const body = parse(createSchema, req.body);
    assertNotInMaintenance(db);

    const limit = requestLimit(db);
    if (body.amount > limit) {
      throw badRequest(`Cashier requests are limited to ${compactAmount(limit)} DonutSMP money.`, 'REQUEST_TOO_LARGE', {
        fields: { amount: `Maximum is ${compactAmount(limit)}.` },
      });
    }
    if (body.kind === 'withdrawal' && body.amount > balanceOf(db, user.id)) {
      throw badRequest('You do not have enough DonutSMP money for that withdrawal.', 'INSUFFICIENT_CREDITS', {
        fields: { amount: 'Enter an amount within your available balance.' },
      });
    }

    const requestId = newId('csr');
    const reference = inTransaction(db, () => {
      const ref = generateCashierReference(db, body.kind);
      const now = nowIso();
      db.prepare(
        `INSERT INTO cashier_requests
           (id, reference, user_id, kind, amount, status, created_at, updated_at, last_activity_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      ).run(requestId, ref, user.id, body.kind, body.amount, now, now, now);
      addCashierMessage(db, {
        requestId,
        authorId: null,
        authorRole: 'system',
        visibility: 'system',
        body: `${kindLabel(body.kind)} request created for ${compactAmount(body.amount)} DonutSMP money.`,
      });
      addCashierEvent(db, {
        requestId,
        actorId: user.id,
        type: 'created',
        toValue: 'pending',
        note: `${kindLabel(body.kind)} request created for ${body.amount} money.`,
      });
      notifyCashierAdmins(db, {
        title: `New ${body.kind} request ${ref}`,
        body: `${user.username} requested ${compactAmount(body.amount)} DonutSMP money.`,
        link: `/admin/cashier/${ref}`,
        actorId: user.id,
      });
      recordAudit(db, {
        actorId: user.id,
        action: 'cashier.request',
        targetType: 'cashier_request',
        targetId: requestId,
        targetLabel: ref,
        metadata: { kind: body.kind, amount: body.amount },
        ip: clientIp(req),
      });
      return ref;
    });

    const created = loadRequestOrThrow(db, reference);
    queueCashierNotification(db, {
      event: 'created',
      eventKey: 'created',
      requestId: created.id,
      reference: created.reference,
      username: created.requester_name ?? user.username,
      userId: created.user_id,
      kind: created.kind,
      amount: created.amount,
      status: created.status,
      onHold: false,
      createdAt: created.created_at,
    });
    res.status(201).json({ request: getCashierDetail(db, user, reference) });
  });

  router.get('/:reference', (req, res) => {
    const user = requireActive(req);
    const row = loadRequestOrThrow(db, req.params.reference ?? '');
    assertOwnRequest(user, row);
    res.json({ request: getCashierDetail(db, user, row.reference) });
  });

  router.post('/:reference/messages', (req, res) => {
    const user = requireActive(req);
    const body = parse(messageSchema, req.body);
    const row = loadRequestOrThrow(db, req.params.reference ?? '');
    assertOwnRequest(user, row);
    if (row.status !== 'pending') {
      throw conflict('This cashier request is closed and can no longer receive messages.', 'REQUEST_CLOSED');
    }

    let messageId = '';
    inTransaction(db, () => {
      messageId = addCashierMessage(db, {
        requestId: row.id,
        authorId: user.id,
        authorRole: user.role,
        visibility: 'public',
        body: body.body,
      });
      addCashierEvent(db, {
        requestId: row.id,
        actorId: user.id,
        type: 'message',
        note: `Requester message: ${body.body.slice(0, 300)}`,
      });
      notifyCashierAdmins(db, {
        title: `New message on ${row.reference}`,
        body: `${user.username} replied in the ${row.kind} request.`,
        link: `/admin/cashier/${row.reference}`,
        actorId: user.id,
        excludeUserId: user.id,
      });
      recordAudit(db, {
        actorId: user.id,
        action: 'cashier.message',
        targetType: 'cashier_request',
        targetId: row.id,
        targetLabel: row.reference,
        ip: clientIp(req),
      });
    });
    // Staff replies stay on the website. The Discord channel only receives the
    // requester's messages, matching how the ticket channel is handled.
    queueCashierNotification(db, {
      event: 'message',
      eventKey: messageId,
      requestId: row.id,
      messageId,
      reference: row.reference,
      username: row.requester_name ?? user.username,
      userId: row.user_id,
      kind: row.kind,
      amount: row.amount,
      status: row.status,
      onHold: Boolean(row.held_at),
      preview: body.body.slice(0, 300),
      createdAt: row.created_at,
    });
    res.json({ request: getCashierDetail(db, user, row.reference) });
  });

  router.post('/:reference/cancel', (req, res) => {
    const user = requireActive(req);
    const body = parse(cancelSchema, req.body ?? {});
    const row = loadRequestOrThrow(db, req.params.reference ?? '');
    assertOwnRequest(user, row);
    if (row.status !== 'pending') {
      throw conflict('Only pending requests can be cancelled.', 'REQUEST_FINAL');
    }

    let eventId = '';
    inTransaction(db, () => {
      const now = nowIso();
      const updated = db
        .prepare(
          `UPDATE cashier_requests SET status = 'cancelled', updated_at = ?, last_activity_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(now, now, row.id);
      if (updated.changes !== 1) {
        throw conflict('This cashier request has already been reviewed.', 'ALREADY_DECIDED');
      }
      addCashierMessage(db, {
        requestId: row.id,
        authorId: user.id,
        authorRole: user.role,
        visibility: 'system',
        body: `Request cancelled by the requester.${body.reason ? ` Reason: ${body.reason}` : ''}`,
      });
      eventId = addCashierEvent(db, {
        requestId: row.id,
        actorId: user.id,
        type: 'cancelled',
        fromValue: 'pending',
        toValue: 'cancelled',
        note: body.reason ?? 'Cancelled by the requester',
      });
      recordAudit(db, {
        actorId: user.id,
        action: 'cashier.cancel',
        targetType: 'cashier_request',
        targetId: row.id,
        targetLabel: row.reference,
        ip: clientIp(req),
      });
    });
    queueCashierNotification(db, {
      event: 'cancelled',
      eventKey: eventId,
      requestId: row.id,
      reference: row.reference,
      username: row.requester_name ?? user.username,
      userId: row.user_id,
      kind: row.kind,
      amount: row.amount,
      status: 'cancelled',
      onHold: false,
      reason: body.reason ?? null,
      createdAt: row.created_at,
      decidedAt: nowIso(),
    });
    queueCashierTranscript(db, { requestId: row.id, eventKey: eventId, actorId: user.id });
    res.json({ request: getCashierDetail(db, user, row.reference) });
  });

  return router;
}

export function createAdminCashierRouter(db: DB): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const user = requirePermission(req, 'credits.adjust');
    const query = parse(listQuerySchema, req.query);
    const { items, total } = buildCashierList(db, {
      status: query.status,
      kind: query.kind,
      search: query.q,
      pendingFirst: true,
      page: query.page,
      pageSize: query.pageSize,
    });
    res.json({
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      counts: cashierCounts(db),
      reviewer: user.username,
    });
  });

  router.get('/:reference', (req, res) => {
    const user = requirePermission(req, 'credits.adjust');
    const row = loadRequestOrThrow(db, req.params.reference ?? '');
    res.json({ request: getCashierDetail(db, user, row.reference) });
  });

  router.post('/:reference/messages', (req, res) => {
    const user = requireActive(req);
    requirePermission(req, 'credits.adjust');
    const body = parse(messageSchema, req.body);
    const row = loadRequestOrThrow(db, req.params.reference ?? '');
    if (row.status !== 'pending') {
      throw conflict('This cashier request is closed and can no longer receive messages.', 'REQUEST_CLOSED');
    }

    inTransaction(db, () => {
      addCashierMessage(db, {
        requestId: row.id,
        authorId: user.id,
        authorRole: user.role,
        visibility: 'public',
        body: body.body,
      });
      addCashierEvent(db, {
        requestId: row.id,
        actorId: user.id,
        type: 'message',
        note: `Staff message: ${body.body.slice(0, 300)}`,
      });
      notify(db, {
        userId: row.user_id,
        type: 'cashier',
        title: `New message on ${row.reference}`,
        body: `${user.username} replied to your ${row.kind} request.`,
        link: `/cashier/${row.reference}`,
        actorId: user.id,
      });
      recordAudit(db, {
        actorId: user.id,
        action: 'cashier.message',
        targetType: 'cashier_request',
        targetId: row.id,
        targetLabel: row.reference,
        ip: clientIp(req),
      });
    });
    res.json({ request: getCashierDetail(db, user, row.reference) });
  });

  router.post('/:reference/decision', (req, res) => {
    const user = requireActive(req);
    requirePermission(req, 'credits.adjust');
    if (!canManageCashier(user)) throw new ApiError(403, 'FORBIDDEN', 'Only administrators can decide cashier requests.');
    const body = parse(decisionSchema, req.body);
    const row = loadRequestOrThrow(db, req.params.reference ?? '');
    if (row.status !== 'pending') {
      throw conflict('This cashier request has already been reviewed.', 'ALREADY_DECIDED');
    }
    if (row.held_at) {
      throw conflict('This cashier request is on hold. Resume it before making a decision.', 'REQUEST_ON_HOLD');
    }

    if (body.decision === 'approve' && row.kind === 'withdrawal' && balanceOf(db, row.user_id) < row.amount) {
      throw new ApiError(
        409,
        'INSUFFICIENT_CREDITS',
        'The requester no longer has enough DonutSMP money for this withdrawal. Reject the request or ask them to open a new one.',
        { balance: balanceOf(db, row.user_id), required: row.amount },
      );
    }

    let eventId = '';
    inTransaction(db, () => {
      const now = nowIso();
      const nextStatus = body.decision === 'approve' ? 'approved' : 'rejected';
      const claimed = db
        .prepare(
          `UPDATE cashier_requests
           SET status = ?, reviewer_id = ?, decision_reason = ?, decided_at = ?, updated_at = ?, last_activity_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(nextStatus, user.id, body.reason ?? null, now, now, now, row.id);
      if (claimed.changes !== 1) {
        throw conflict('This cashier request has already been reviewed.', 'ALREADY_DECIDED');
      }

      let ledgerId: string | null = null;
      if (body.decision === 'approve') {
        const amount = row.kind === 'deposit' ? row.amount : -row.amount;
        const entry = applyLedger(db, {
          userId: row.user_id,
          amount,
          type: row.kind === 'deposit' ? 'credit_request' : 'admin_adjustment',
          actorId: user.id,
          reason: `Cashier ${row.kind} ${row.reference}${body.reason ? `: ${body.reason}` : ''}`,
          refType: 'cashier_request',
          refId: row.id,
          idempotencyKey: `cashier:${row.id}`,
          metadata: { requestId: row.id, kind: row.kind, reference: row.reference },
        });
        ledgerId = entry.id;
        db.prepare('UPDATE cashier_requests SET ledger_id = ? WHERE id = ?').run(ledgerId, row.id);
        addCashierMessage(db, {
          requestId: row.id,
          authorId: user.id,
          authorRole: user.role,
          visibility: 'system',
          body: `${kindLabel(row.kind)} approved by ${user.username}. ${compactAmount(row.amount)} DonutSMP money ${
            row.kind === 'deposit' ? 'added to' : 'removed from'
          } the wallet.`,
        });
      } else {
        addCashierMessage(db, {
          requestId: row.id,
          authorId: user.id,
          authorRole: user.role,
          visibility: 'system',
          body: `Request rejected by ${user.username}.${body.reason ? ` Reason: ${body.reason}` : ''}`,
        });
      }

      eventId = addCashierEvent(db, {
        requestId: row.id,
        actorId: user.id,
        type: body.decision === 'approve' ? 'approved' : 'rejected',
        fromValue: 'pending',
        toValue: nextStatus,
        note: body.reason ?? null,
      });

      notify(db, {
        userId: row.user_id,
        type: 'cashier',
        title:
          body.decision === 'approve'
            ? `${kindLabel(row.kind)} ${row.reference} approved`
            : `${kindLabel(row.kind)} ${row.reference} rejected`,
        body:
          body.decision === 'approve'
            ? `${compactAmount(row.amount)} DonutSMP money ${row.kind === 'deposit' ? 'was added to' : 'was removed from'} your wallet.`
            : `Your request was not approved.${body.reason ? ` Reason: ${body.reason}` : ''}`,
        link: `/cashier/${row.reference}`,
        actorId: user.id,
      });
      if (row.requester_email) {
        enqueueEmail(db, {
          userId: row.user_id,
          recipient: row.requester_email,
          template: 'cashier-decision',
          payload: {
            username: row.requester_name ?? 'there',
            kind: row.kind,
            status: body.decision === 'approve' ? 'approved' : 'rejected',
            reference: row.reference,
            amount: row.amount,
            reason: body.reason ?? '',
          },
          dedupeKey: `cashier-decision:${row.id}`,
        });
      }
      recordAudit(db, {
        actorId: user.id,
        action: body.decision === 'approve' ? 'cashier.approve' : 'cashier.reject',
        targetType: 'cashier_request',
        targetId: row.id,
        targetLabel: row.reference,
        reason: body.reason ?? null,
        metadata: { kind: row.kind, amount: row.amount, targetUserId: row.user_id, ledgerId },
        ip: clientIp(req),
      });
    });

    const decided = loadRequestOrThrow(db, row.reference);
    queueCashierNotification(db, {
      event: body.decision === 'approve' ? 'approved' : 'rejected',
      eventKey: eventId,
      requestId: row.id,
      reference: row.reference,
      username: row.requester_name ?? 'Unknown',
      userId: row.user_id,
      kind: row.kind,
      amount: row.amount,
      status: body.decision === 'approve' ? 'approved' : 'rejected',
      onHold: Boolean(decided.held_at),
      staffName: user.username,
      reason: body.reason ?? null,
      createdAt: row.created_at,
      decidedAt: decided.decided_at,
    });
    queueCashierTranscript(db, { requestId: row.id, eventKey: eventId, actorId: user.id });
    res.json({ request: getCashierDetail(db, user, row.reference) });
  });

  router.post('/:reference/amount', (req, res) => {
    const user = requireActive(req);
    requirePermission(req, 'credits.adjust');
    if (!canManageCashier(user)) throw new ApiError(403, 'FORBIDDEN', 'Only administrators can edit cashier amounts.');
    const body = parse(amountEditSchema, req.body);
    const row = loadRequestOrThrow(db, req.params.reference ?? '');
    if (row.status !== 'pending' || row.held_at) {
      throw conflict('Only pending requests that are not on hold can be edited.', 'REQUEST_NOT_EDITABLE');
    }
    if (row.kind === 'withdrawal' && body.amount > balanceOf(db, row.user_id)) {
      throw badRequest('The requester does not have enough money for that withdrawal amount.', 'INSUFFICIENT_CREDITS');
    }

    let eventId = '';
    inTransaction(db, () => {
      const now = nowIso();
      const updated = db
        .prepare(
          `UPDATE cashier_requests SET amount = ?, updated_at = ?, last_activity_at = ?
            WHERE id = ? AND status = 'pending' AND held_at IS NULL AND amount = ?`,
        )
        .run(body.amount, now, now, row.id, row.amount);
      if (updated.changes !== 1) {
        throw conflict('Another administrator changed this request first. Refresh and try again.', 'REQUEST_CHANGED');
      }
      addCashierMessage(db, {
        requestId: row.id,
        authorId: user.id,
        authorRole: user.role,
        visibility: 'system',
        body: `Amount changed by ${user.username} from ${compactAmount(row.amount)} to ${compactAmount(body.amount)} money.${
          body.reason ? ` Reason: ${body.reason}` : ''
        }`,
      });
      eventId = addCashierEvent(db, {
        requestId: row.id,
        actorId: user.id,
        type: 'amount_changed',
        fromValue: row.amount,
        toValue: body.amount,
        note: body.reason ?? null,
      });
      notify(db, {
        userId: row.user_id,
        type: 'cashier',
        title: `Amount updated on ${row.reference}`,
        body: `${user.username} changed your request from ${compactAmount(row.amount)} to ${compactAmount(body.amount)} money.`,
        link: `/cashier/${row.reference}`,
        actorId: user.id,
      });
      recordAudit(db, {
        actorId: user.id,
        action: 'cashier.amount',
        targetType: 'cashier_request',
        targetId: row.id,
        targetLabel: row.reference,
        reason: body.reason ?? null,
        metadata: { from: row.amount, to: body.amount },
        ip: clientIp(req),
      });
    });
    queueCashierNotification(db, {
      event: 'amount_changed',
      eventKey: eventId,
      requestId: row.id,
      reference: row.reference,
      username: row.requester_name ?? 'Unknown',
      userId: row.user_id,
      kind: row.kind,
      amount: body.amount,
      previousAmount: row.amount,
      status: 'pending',
      onHold: false,
      staffName: user.username,
      reason: body.reason ?? null,
      createdAt: row.created_at,
    });
    res.json({ request: getCashierDetail(db, user, row.reference) });
  });

  router.post('/:reference/hold', (req, res) => {
    const user = requireActive(req);
    requirePermission(req, 'credits.adjust');
    if (!canManageCashier(user)) throw new ApiError(403, 'FORBIDDEN', 'Only administrators can put requests on hold.');
    const body = parse(holdSchema, req.body);
    const row = loadRequestOrThrow(db, req.params.reference ?? '');
    if (row.status !== 'pending' || row.held_at) {
      throw conflict('Only pending requests can be put on hold.', 'REQUEST_NOT_HOLDABLE');
    }
    let eventId = '';
    inTransaction(db, () => {
      const now = nowIso();
      const updated = db
        .prepare(
          `UPDATE cashier_requests SET held_at = ?, held_by = ?, hold_reason = ?, updated_at = ?, last_activity_at = ?
            WHERE id = ? AND status = 'pending' AND held_at IS NULL`,
        )
        .run(now, user.id, body.reason, now, now, row.id);
      if (updated.changes !== 1) {
        throw conflict('Another administrator changed this request first. Refresh and try again.', 'REQUEST_CHANGED');
      }
      addCashierMessage(db, {
        requestId: row.id,
        authorId: user.id,
        authorRole: user.role,
        visibility: 'system',
        body: `Request placed on hold by ${user.username}. Reason: ${body.reason}`,
      });
      eventId = addCashierEvent(db, {
        requestId: row.id,
        actorId: user.id,
        type: 'on_hold',
        toValue: 'on_hold',
        note: body.reason,
      });
      notify(db, {
        userId: row.user_id,
        type: 'cashier',
        title: `${row.reference} is on hold`,
        body: `An administrator put your request on hold. Reason: ${body.reason}`,
        link: `/cashier/${row.reference}`,
        actorId: user.id,
      });
      recordAudit(db, {
        actorId: user.id,
        action: 'cashier.hold',
        targetType: 'cashier_request',
        targetId: row.id,
        targetLabel: row.reference,
        reason: body.reason,
        ip: clientIp(req),
      });
    });
    queueCashierNotification(db, {
      event: 'on_hold',
      eventKey: eventId,
      requestId: row.id,
      reference: row.reference,
      username: row.requester_name ?? 'Unknown',
      userId: row.user_id,
      kind: row.kind,
      amount: row.amount,
      status: 'pending',
      onHold: true,
      staffName: user.username,
      reason: body.reason,
      createdAt: row.created_at,
    });
    res.json({ request: getCashierDetail(db, user, row.reference) });
  });

  router.delete('/:reference/hold', (req, res) => {
    const user = requireActive(req);
    requirePermission(req, 'credits.adjust');
    if (!canManageCashier(user)) throw new ApiError(403, 'FORBIDDEN', 'Only administrators can resume cashier requests.');
    const row = loadRequestOrThrow(db, req.params.reference ?? '');
    if (!row.held_at) throw conflict('This request is not on hold.', 'REQUEST_NOT_HELD');
    let eventId = '';
    inTransaction(db, () => {
      const now = nowIso();
      const updated = db
        .prepare(
          `UPDATE cashier_requests SET held_at = NULL, held_by = NULL, hold_reason = NULL,
                  updated_at = ?, last_activity_at = ?
            WHERE id = ? AND held_at IS NOT NULL`,
        )
        .run(now, now, row.id);
      if (updated.changes !== 1) {
        throw conflict('Another administrator already resumed this request.', 'REQUEST_CHANGED');
      }
      addCashierMessage(db, {
        requestId: row.id,
        authorId: user.id,
        authorRole: user.role,
        visibility: 'system',
        body: `Request resumed by ${user.username}.`,
      });
      eventId = addCashierEvent(db, {
        requestId: row.id,
        actorId: user.id,
        type: 'resumed',
        fromValue: 'on_hold',
        toValue: 'pending',
      });
      notify(db, {
        userId: row.user_id,
        type: 'cashier',
        title: `${row.reference} resumed`,
        body: 'Your cashier request is back in the review queue.',
        link: `/cashier/${row.reference}`,
        actorId: user.id,
      });
      recordAudit(db, {
        actorId: user.id,
        action: 'cashier.resume',
        targetType: 'cashier_request',
        targetId: row.id,
        targetLabel: row.reference,
        ip: clientIp(req),
      });
    });
    queueCashierNotification(db, {
      event: 'resumed',
      eventKey: eventId,
      requestId: row.id,
      reference: row.reference,
      username: row.requester_name ?? 'Unknown',
      userId: row.user_id,
      kind: row.kind,
      amount: row.amount,
      status: 'pending',
      onHold: false,
      staffName: user.username,
      reason: row.hold_reason,
      createdAt: row.created_at,
    });
    res.json({ request: getCashierDetail(db, user, row.reference) });
  });

  return router;
}
