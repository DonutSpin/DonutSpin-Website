import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import { getSetting, setSetting } from '../db/index.ts';
import { ApiError, badRequest, clientIp, conflict, inTransaction, newId, notFound, nowIso, parseJson } from '../lib/core.ts';
import { amountSchema } from '../lib/amount.ts';
import { parse, pageQuerySchema } from '../lib/validation.ts';
import { requirePermission } from '../lib/permissions.ts';
import { recordAudit, listAuditRows } from '../lib/audit.ts';
import { notify } from '../lib/notifications.ts';
import { loadSupportCategories } from '../lib/tickets.ts';
import { validateGameConfig } from '../games/config.ts';
import { publicGameConfig } from '../games/index.ts';
import { enqueueEmail } from '../lib/email.ts';

const settingSchemas: Record<string, z.ZodType> = {
  'platform.name': z.string().trim().min(2, 'Use at least 2 characters.').max(60),
  'platform.tagline': z.string().trim().max(120),
  'platform.registration_open': z.boolean(),
  'platform.maintenance': z.boolean(),
  'platform.maintenance_message': z.string().trim().max(300),
  'economy.starting_credits': amountSchema({ min: 0, max: 1_000_000_000_000, allowZero: true, label: 'starting money' }),
  'economy.max_payout': amountSchema({ min: 100, max: 1_000_000_000_000, label: 'maximum payout' }),
  'economy.cashier_request_limit': amountSchema({ min: 1, max: 1_000_000_000_000, label: 'cashier request limit' }),
  'notifications.email_enabled': z.boolean(),
  'security.accounts_per_ip': z.number().int().min(1).max(100),
};

const categorySchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9_]{2,30}$/, 'Use lowercase letters, numbers, and underscores.'),
  label: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200),
  defaultPriority: z.enum(['low', 'normal', 'high', 'urgent']),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});

const categoryPatchSchema = z.object({
  label: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(200).optional(),
  enabled: z.boolean().optional(),
  defaultPriority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});

const gamePatchSchema = z.object({
  enabled: z.boolean(),
  minBet: amountSchema({ max: 1_000_000_000_000, label: 'minimum wager' }),
  maxBet: amountSchema({ max: 1_000_000_000_000, label: 'maximum wager' }),
  config: z.record(z.string(), z.unknown()),
});

const announcementSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(5).max(2000),
  audience: z.enum(['all', 'players', 'staff']),
  sendEmail: z.boolean().optional().default(false),
});

function gameList(db: DB, publicShape: boolean) {
  const rows = db.prepare('SELECT * FROM games ORDER BY name').all() as {
    id: string;
    name: string;
    description: string;
    enabled: number;
    min_bet: number;
    max_bet: number;
    config: string;
    updated_at: string;
  }[];
  return rows.map((row) => {
    const parsed = parseJson<Record<string, unknown>>(row.config, {});
    return {
      slug: row.id,
      name: row.name,
      description: row.description,
      enabled: Boolean(row.enabled),
      minBet: row.min_bet,
      maxBet: row.max_bet,
      config: publicShape ? publicGameConfig(row.id, parsed) : parsed,
      updatedAt: row.updated_at,
    };
  });
}

export function createAdminConfigRouter(db: DB): Router {
  const router = Router();

  router.get('/settings', (req, res) => {
    requirePermission(req, 'settings.manage');
    const rows = db.prepare('SELECT key, value, updated_at, updated_by FROM settings ORDER BY key').all() as {
      key: string;
      value: string;
      updated_at: string;
      updated_by: string | null;
    }[];
    const settings: Record<string, unknown> = {};
    const updated: Record<string, string> = {};
    for (const row of rows) {
      // SMTP credentials are write-only. The admin email page only learns
      // whether a key is set, never the encrypted value itself.
      if (row.key === 'email.smtp_pass_enc') continue;
      settings[row.key] = parseJson(row.value, null);
      updated[row.key] = row.updated_at;
    }
    res.json({ settings, updated, categories: loadSupportCategories(db), games: gameList(db, false) });
  });

  router.patch('/settings/:key', (req, res) => {
    const admin = requirePermission(req, 'settings.manage');
    const key = req.params.key ?? '';
    const schema = settingSchemas[key];
    if (!schema) throw notFound('Unknown setting.');
    const body = z.object({ value: z.unknown() }).parse(req.body ?? {});
    let value: unknown;
    try {
      value = schema.parse(body.value);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const message = error.issues[0]?.message ?? 'Enter a valid value.';
        throw new ApiError(400, 'VALIDATION_ERROR', message, { fields: { [key]: message } });
      }
      throw error;
    }
    const previous = getSetting(db, key, null);
    setSetting(db, key, value, admin.id);
    recordAudit(db, {
      actorId: admin.id,
      action: 'settings.update',
      targetType: 'setting',
      targetId: key,
      targetLabel: key,
      metadata: { previous, next: value },
      ip: clientIp(req),
    });
    res.json({ key, value });
  });

  router.get('/games', (req, res) => {
    requirePermission(req, 'games.manage');
    res.json({ games: gameList(db, false) });
  });

  router.patch('/games/:slug', (req, res) => {
    const admin = requirePermission(req, 'games.manage');
    const slug = req.params.slug ?? '';
    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(slug) as
      | { id: string; name: string; min_bet: number; max_bet: number; enabled: number; config: string }
      | undefined;
    if (!game) throw notFound('Game not found.');
    const body = parse(gamePatchSchema, req.body);
    if (body.maxBet < body.minBet) {
      throw badRequest('Maximum wager must be at least the minimum wager.', 'INVALID_LIMITS', {
        fields: { maxBet: 'Must be at least the minimum wager.' },
      });
    }
    const config = validateGameConfig(slug, body.config);
    db.prepare('UPDATE games SET enabled = ?, min_bet = ?, max_bet = ?, config = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(
      body.enabled ? 1 : 0,
      body.minBet,
      body.maxBet,
      JSON.stringify(config),
      nowIso(),
      admin.id,
      slug,
    );
    recordAudit(db, {
      actorId: admin.id,
      action: 'game.update',
      targetType: 'game',
      targetId: slug,
      targetLabel: game.name,
      metadata: {
        before: { enabled: Boolean(game.enabled), minBet: game.min_bet, maxBet: game.max_bet, config: parseJson(game.config, {}) },
        after: { enabled: body.enabled, minBet: body.minBet, maxBet: body.maxBet, config },
      },
      ip: clientIp(req),
    });
    res.json({ game: gameList(db, false).find((entry) => entry.slug === slug) });
  });

  router.post('/categories', (req, res) => {
    const admin = requirePermission(req, 'settings.manage');
    const body = parse(categorySchema, req.body);
    if (body.key === 'credit_request') {
      throw conflict('Money requests are handled in the Cashier and cannot be a ticket category.', 'RESERVED_CATEGORY');
    }
    const existing = db.prepare('SELECT key FROM support_categories WHERE key = ?').get(body.key);
    if (existing) throw conflict('That category key already exists.', 'CATEGORY_EXISTS');
    db.prepare(
      `INSERT INTO support_categories (key, label, description, enabled, default_priority, sort_order)
       VALUES (?, ?, ?, 1, ?, ?)`,
    ).run(body.key, body.label, body.description, body.defaultPriority, body.sortOrder ?? 100);
    recordAudit(db, {
      actorId: admin.id,
      action: 'support_category.create',
      targetType: 'category',
      targetId: body.key,
      targetLabel: body.label,
      ip: clientIp(req),
    });
    res.status(201).json({ categories: loadSupportCategories(db) });
  });

  router.patch('/categories/:key', (req, res) => {
    const admin = requirePermission(req, 'settings.manage');
    const key = req.params.key ?? '';
    if (key === 'credit_request') {
      throw badRequest('This category is archived. Money requests are handled in the Cashier.', 'LEGACY_CATEGORY');
    }
    const current = loadSupportCategories(db).find((category) => category.key === key);
    if (!current) throw notFound('Category not found.');
    const body = parse(categoryPatchSchema, req.body);
    db.prepare(
      `UPDATE support_categories SET label = ?, description = ?, enabled = ?, default_priority = ?, sort_order = ?
       WHERE key = ?`,
    ).run(
      body.label ?? current.label,
      body.description ?? current.description,
      (body.enabled ?? current.enabled) ? 1 : 0,
      body.defaultPriority ?? current.defaultPriority,
      body.sortOrder ?? current.sortOrder,
      key,
    );
    recordAudit(db, {
      actorId: admin.id,
      action: 'support_category.update',
      targetType: 'category',
      targetId: key,
      targetLabel: body.label ?? current.label,
      metadata: { before: current, after: body },
      ip: clientIp(req),
    });
    res.json({ categories: loadSupportCategories(db) });
  });

  router.get('/audit', (req, res) => {
    requirePermission(req, 'audit.read');
    const query = parse(
      pageQuerySchema.extend({
        action: z.string().trim().max(80).optional(),
        actor: z.string().trim().max(80).optional(),
        q: z.string().trim().max(120).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      }),
      req.query,
    );
    let actorId: string | undefined;
    if (query.actor) {
      const actor = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(query.actor) as
        | { id: string }
        | undefined;
      actorId = actor?.id ?? '__none__';
    }
    const { rows, total } = listAuditRows(db, {
      actorId,
      action: query.action,
      search: query.q,
      from: query.from,
      to: query.to,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    const actions = (db.prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action').all() as { action: string }[]).map(
      (row) => row.action,
    );
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        actorId: row.actor_id,
        actorName: row.actor_name ?? 'System',
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        targetLabel: row.target_label,
        reason: row.reason,
        metadata: parseJson<Record<string, unknown> | null>(row.metadata, null),
        ip: row.ip,
        createdAt: row.created_at,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      actions,
    });
  });

  router.get('/announcements', (req, res) => {
    requirePermission(req, 'notifications.broadcast');
    const rows = db
      .prepare(
        `SELECT a.id, a.title, a.body, a.recipient_count, a.email_recipient_count, a.created_at, u.username AS creator
         FROM announcements a LEFT JOIN users u ON u.id = a.created_by
         ORDER BY a.created_at DESC LIMIT 50`,
      )
      .all() as {
      id: string;
      title: string;
      body: string;
      recipient_count: number;
      email_recipient_count: number;
      created_at: string;
      creator: string | null;
    }[];
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        recipientCount: row.recipient_count,
        emailRecipientCount: row.email_recipient_count,
        createdAt: row.created_at,
        creator: row.creator ?? 'System',
      })),
    });
  });

  router.post('/announcements', (req, res) => {
    const admin = requirePermission(req, 'notifications.broadcast');
    const body = parse(announcementSchema, req.body);
    const audienceClause =
      body.audience === 'players'
        ? "WHERE role = 'user' AND status <> 'suspended'"
        : body.audience === 'staff'
          ? "WHERE role <> 'user' AND status <> 'suspended'"
          : "WHERE status <> 'suspended'";
    const recipients = db
      .prepare(`SELECT id, username, email, email_notifications FROM users ${audienceClause}`)
      .all() as { id: string; username: string; email: string; email_notifications: number }[];
    const id = newId('ann');
    const emailRecipients = body.sendEmail ? recipients.filter((recipient) => recipient.email_notifications) : [];
    inTransaction(db, () => {
      db.prepare(
        `INSERT INTO announcements (id, title, body, created_by, recipient_count, email_recipient_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, body.title, body.body, admin.id, recipients.length, emailRecipients.length, nowIso());
      for (const recipient of recipients) {
        notify(db, {
          userId: recipient.id,
          type: 'announcement',
          title: body.title,
          body: body.body,
          link: '/notifications',
          actorId: admin.id,
        });
      }
      for (const recipient of emailRecipients) {
        enqueueEmail(db, {
          userId: recipient.id,
          recipient: recipient.email,
          template: 'announcement',
          payload: { username: recipient.username, title: body.title, body: body.body },
          dedupeKey: `announcement:${id}:${recipient.id}`,
        });
      }
      recordAudit(db, {
        actorId: admin.id,
        action: 'announcement.send',
        targetType: 'announcement',
        targetId: id,
        targetLabel: body.title,
        metadata: {
          audience: body.audience,
          recipients: recipients.length,
          emailRecipients: emailRecipients.length,
          sendEmail: body.sendEmail,
        },
        ip: clientIp(req),
      });
    });
    res.status(201).json({ id, recipientCount: recipients.length, emailRecipientCount: emailRecipients.length });
  });

  router.get('/ticket-summary', (req, res) => {
    requirePermission(req, 'tickets.read_all');
    const row = db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_count,
           SUM(CASE WHEN assignee_id IS NULL AND status NOT IN ('closed','rejected') THEN 1 ELSE 0 END) AS unassigned,
           SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
           SUM(CASE WHEN status = 'on_hold' THEN 1 ELSE 0 END) AS on_hold,
           SUM(CASE WHEN status = 'waiting_user' THEN 1 ELSE 0 END) AS waiting_user,
           SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed,
           SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
           SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved
         FROM tickets`,
      )
      .get() as Record<string, number | null>;
    const priority = db
      .prepare(
        `SELECT priority, COUNT(*) AS count FROM tickets
         WHERE status NOT IN ('closed','rejected') GROUP BY priority`,
      )
      .all() as { priority: string; count: number }[];
    res.json({ counts: row, priority });
  });

  return router;
}
