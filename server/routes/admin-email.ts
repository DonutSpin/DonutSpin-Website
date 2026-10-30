import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import { setSetting } from '../db/index.ts';
import { ApiError, clientIp, inTransaction } from '../lib/core.ts';
import { encryptSecret } from '../lib/crypto.ts';
import { requirePermission } from '../lib/permissions.ts';
import { recordAudit } from '../lib/audit.ts';
import { parse } from '../lib/validation.ts';
import {
  emailReady,
  emailSettingsView,
  getEmailConfig,
  isValidEmail,
  processEmailQueue,
  retryEmailJob,
  sendTestEmail,
} from '../lib/email.ts';

const settingsSchema = z
  .object({
    enabled: z.boolean(),
    host: z.string().trim().min(1, 'Enter the SMTP server.').max(255),
    port: z.number().int().min(1, 'Enter a valid port.').max(65535),
    secure: z.boolean(),
    user: z.string().trim().min(1, 'Enter the SMTP login.').max(255),
    fromName: z.string().trim().min(1, 'Enter a sender name.').max(80),
    fromEmail: z.string().trim().email('Enter a valid sender address.').max(254),
    replyTo: z
      .string()
      .trim()
      .max(254)
      .refine((value) => value === '' || isValidEmail(value), 'Enter a valid reply-to address or leave it blank.'),
    securityNotifications: z.boolean(),
    rewardNotifications: z.boolean(),
    smtpPass: z.string().trim().min(1, 'Enter the SMTP key.').max(300).optional(),
    clearSmtpPass: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.smtpPass && value.clearSmtpPass) {
      ctx.addIssue({ code: 'custom', path: ['smtpPass'], message: 'Enter a new key or clear the saved key, not both.' });
    }
  });

const testSchema = z.object({ to: z.string().trim().email('Enter a valid destination address.').max(254).optional() });

function safeMailError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/pass(word)?[=:]\s*\S+/gi, 'password=[redacted]')
    .slice(0, 500);
}

export function createAdminEmailRouter(db: DB): Router {
  const router = Router();

  router.get('/email', (req, res) => {
    requirePermission(req, 'settings.manage');
    res.set('Cache-Control', 'no-store');
    res.json(emailSettingsView(db));
  });

  router.patch('/email', (req, res) => {
    const admin = requirePermission(req, 'settings.manage');
    const body = parse(settingsSchema, req.body);
    const current = getEmailConfig(db);
    const hasPassAfter = body.smtpPass
      ? true
      : body.clearSmtpPass
        ? current.passSource === 'environment'
        : Boolean(current.pass);
    if (body.enabled && !hasPassAfter) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Add an SMTP key before enabling email delivery.', {
        fields: { smtpPass: 'An SMTP key is required.' },
      });
    }
    if (body.enabled && (!body.host || !body.user || !body.fromEmail)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Complete the required email settings before enabling delivery.');
    }
    const before = {
      enabled: current.enabled,
      host: current.host,
      port: current.port,
      secure: current.secure,
      user: current.user,
      fromName: current.fromName,
      fromEmail: current.fromEmail,
      replyTo: current.replyTo,
      securityNotifications: current.securityNotifications,
      rewardNotifications: current.rewardNotifications,
      smtpPassSource: current.passSource,
    };
    inTransaction(db, () => {
      setSetting(db, 'email.enabled', body.enabled, admin.id);
      setSetting(db, 'email.host', body.host, admin.id);
      setSetting(db, 'email.port', body.port, admin.id);
      setSetting(db, 'email.secure', body.secure, admin.id);
      setSetting(db, 'email.user', body.user, admin.id);
      setSetting(db, 'email.from_name', body.fromName, admin.id);
      setSetting(db, 'email.from_email', body.fromEmail, admin.id);
      setSetting(db, 'email.reply_to', body.replyTo, admin.id);
      setSetting(db, 'email.security_notifications', body.securityNotifications, admin.id);
      setSetting(db, 'email.reward_notifications', body.rewardNotifications, admin.id);
      if (body.smtpPass) setSetting(db, 'email.smtp_pass_enc', encryptSecret(body.smtpPass), admin.id);
      if (body.clearSmtpPass) setSetting(db, 'email.smtp_pass_enc', '', admin.id);
      recordAudit(db, {
        actorId: admin.id,
        action: 'email.settings_update',
        targetType: 'email',
        targetId: 'smtp',
        targetLabel: 'Email settings',
        metadata: {
          before,
          after: {
            enabled: body.enabled,
            host: body.host,
            port: body.port,
            secure: body.secure,
            fromName: body.fromName,
            fromEmail: body.fromEmail,
            replyTo: body.replyTo,
            securityNotifications: body.securityNotifications,
            rewardNotifications: body.rewardNotifications,
            smtpPassChanged: Boolean(body.smtpPass),
            smtpPassCleared: Boolean(body.clearSmtpPass),
          },
        },
        ip: clientIp(req),
      });
    });
    res.json(emailSettingsView(db));
  });

  router.post('/email/test', async (req, res) => {
    const admin = requirePermission(req, 'settings.manage');
    const body = parse(testSchema, req.body ?? {});
    const recipient = body.to ?? admin.email;
    try {
      const result = await sendTestEmail(db, recipient);
      recordAudit(db, {
        actorId: admin.id,
        action: 'email.test_sent',
        targetType: 'email',
        targetId: 'smtp',
        targetLabel: 'Email settings',
        metadata: { recipient },
        ip: clientIp(req),
      });
      res.json({ ok: true, messageId: result.messageId, recipient });
    } catch (error) {
      const message = safeMailError(error);
      setSetting(db, 'email.last_error', message, admin.id);
      recordAudit(db, {
        actorId: admin.id,
        action: 'email.test_failed',
        targetType: 'email',
        targetId: 'smtp',
        targetLabel: 'Email settings',
        reason: message,
        ip: clientIp(req),
      });
      throw new ApiError(502, 'EMAIL_TEST_FAILED', `Test email failed: ${message}`);
    }
  });

  router.post('/email/queue/:id/retry', (req, res) => {
    const admin = requirePermission(req, 'settings.manage');
    const ok = retryEmailJob(db, req.params.id ?? '');
    if (!ok) throw new ApiError(404, 'EMAIL_JOB_NOT_FOUND', 'That email job is not failed or no longer exists.');
    recordAudit(db, {
      actorId: admin.id,
      action: 'email.queue_retry',
      targetType: 'email_job',
      targetId: req.params.id ?? '',
      targetLabel: 'Email queue',
      ip: clientIp(req),
    });
    res.json(emailSettingsView(db));
  });

  router.post('/email/queue/process', async (req, res) => {
    const admin = requirePermission(req, 'settings.manage');
    const result = await processEmailQueue(db, 20);
    recordAudit(db, {
      actorId: admin.id,
      action: 'email.queue_process',
      targetType: 'email_job',
      targetId: 'queue',
      targetLabel: 'Email queue',
      metadata: { ...result },
      ip: clientIp(req),
    });
    res.json({ ...emailSettingsView(db), result });
  });

  router.get('/email/ready', (req, res) => {
    requirePermission(req, 'settings.manage');
    const email = getEmailConfig(db);
    res.json({
      ready: emailReady(email),
      enabled: email.enabled,
      appName: email.appName,
      fromEmail: email.fromEmail,
    });
  });

  return router;
}
