import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DB } from '../server/db/index.ts';
import { startSmtpSink, type SmtpSink } from './helpers/smtp-sink.ts';

/**
 * End-to-end email test: the real nodemailer transport connects to a local
 * STARTTLS SMTP server, authenticates, and delivers the verification and
 * password-reset messages that registration and the reset flow queue.
 *
 * APP_URL is set before the server modules load so the links in the delivered
 * message are exactly the ones production would send.
 */

const PRODUCTION_URL = 'https://donutspin.runasp.net';
const PASSWORD = 'MailDelivery!2026';
const CSRF = { 'X-Requested-With': 'donutspin' };
const unique = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

let db: DB;
let app: Express;
let sink: SmtpSink;
let email: string;
let processEmailQueue: (db: DB, limit?: number) => Promise<{ sent: number; failed: number; considered: number }>;

function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

beforeAll(async () => {
  process.env.APP_URL = PRODUCTION_URL;
  // The test SMTP server uses a throwaway self-signed certificate.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  const dbModule = await import('../server/db/index.ts');
  const appModule = await import('../server/app.ts');
  const cryptoModule = await import('../server/lib/crypto.ts');
  const emailModule = await import('../server/lib/email.ts');
  processEmailQueue = emailModule.processEmailQueue as unknown as typeof processEmailQueue;

  sink = await startSmtpSink();
  db = dbModule.createDatabase(':memory:');
  app = appModule.createApp(db);

  dbModule.setSetting(db, 'email.enabled', true, null);
  dbModule.setSetting(db, 'email.host', '127.0.0.1', null);
  dbModule.setSetting(db, 'email.port', sink.port, null);
  dbModule.setSetting(db, 'email.secure', false, null);
  dbModule.setSetting(db, 'email.user', 'sink-user', null);
  dbModule.setSetting(db, 'email.from_email', 'no-reply@donutspin.runasp.net', null);
  dbModule.setSetting(db, 'email.from_name', 'DonutSpin', null);
  dbModule.setSetting(db, 'email.smtp_pass_enc', cryptoModule.encryptSecret('sink-password'), null);

  email = `${unique('mailer')}@test.local`;
  const agent = request.agent(app);
  const register = await agent.post('/api/auth/register').set(CSRF).send({
    username: unique('mailer'),
    email,
    password: PASSWORD,
    ageConfirmed: true,
    acceptTerms: true,
    acknowledgeDonutRules: true,
  });
  expect(register.status, JSON.stringify(register.body)).toBe(201);

  const forgot = await agent.post('/api/auth/forgot-password').set(CSRF).send({ email });
  expect(forgot.status, JSON.stringify(forgot.body)).toBe(200);
});

afterAll(async () => {
  await sink?.close();
  db?.close();
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
});

describe('production email delivery', () => {
  it('delivers queued mail over SMTP and marks the jobs sent', async () => {
    const result = await processEmailQueue(db, 10);
    expect(result.sent, JSON.stringify(result)).toBe(2);
    expect(result.failed).toBe(0);

    const jobs = db.prepare('SELECT template, status FROM email_jobs ORDER BY created_at').all() as {
      template: string;
      status: string;
    }[];
    expect(jobs.map((job) => job.template).sort()).toEqual(['password-reset', 'welcome']);
    expect(jobs.every((job) => job.status === 'sent')).toBe(true);
    expect(sink.messages).toHaveLength(2);
  });

  it('sends verification and reset links on the production domain, never localhost', () => {
    const decoded = sink.messages.map((message) => decodeQuotedPrintable(message));
    const verification = decoded.find((message) => message.includes('/verify-email?token='));
    const reset = decoded.find((message) => message.includes('/reset-password?token='));

    expect(verification, 'verification email was not delivered').toBeTruthy();
    expect(reset, 'password reset email was not delivered').toBeTruthy();
    expect(verification).toContain(`${PRODUCTION_URL}/verify-email?token=`);
    expect(reset).toContain(`${PRODUCTION_URL}/reset-password?token=`);
    for (const message of decoded) {
      expect(message).not.toContain('localhost');
    }
  });

  it('adds the lobby and preference links from the configured origin', () => {
    const decoded = sink.messages.map((message) => decodeQuotedPrintable(message)).join('\n');
    expect(decoded).toContain(`${PRODUCTION_URL}/games`);
    expect(decoded).toContain(`${PRODUCTION_URL}/settings#email`);
  });
});
