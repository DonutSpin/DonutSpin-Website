import nodemailer from 'nodemailer';
import type { DB } from '../db/index.ts';
import { getSetting, setSetting } from '../db/index.ts';
import { config, isLoopbackHost } from '../config.ts';
import { decryptSecret } from './crypto.ts';
import { newId, nowIso, parseJson } from './core.ts';
import type { EmailJobStatus, EmailJobSummary, EmailSettingsView } from '../../shared/types.ts';
import { compactAmount } from '../../shared/amount.ts';

export type EmailTemplate =
  | 'welcome'
  | 'verify-email'
  | 'password-reset'
  | 'password-changed'
  | 'new-login'
  | 'email-changed'
  | 'reward-claimed'
  | 'announcement'
  | 'cashier-decision'
  | 'test';

export interface EmailConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  securityNotifications: boolean;
  rewardNotifications: boolean;
  passSource: 'database' | 'environment' | 'none';
  appName: string;
  tagline: string;
  appUrl: string;
}

interface EmailJobRow {
  id: string;
  user_id: string | null;
  recipient: string;
  template: EmailTemplate;
  payload: string;
  status: EmailJobStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

export interface EnqueueInput {
  userId?: string | null;
  recipient: string;
  template: EmailTemplate;
  payload: Record<string, unknown>;
  dedupeKey?: string;
  respectPreference?: boolean;
}

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

function parseFrom(raw: string, fallbackName: string): { name: string; email: string } {
  const match = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match?.[2]) {
    return { name: (match[1] || fallbackName).trim(), email: match[2].trim() };
  }
  return { name: fallbackName, email: raw.trim() };
}

export function getEmailConfig(db: DB): EmailConfig {
  const appName = getSetting(db, 'platform.name', config.appName);
  const tagline = getSetting(db, 'platform.tagline', 'The casino for DonutSMP money.');
  const envFrom = parseFrom(config.mail.from, appName);
  const encrypted = getSetting(db, 'email.smtp_pass_enc', '');
  const databasePass = encrypted ? decryptSecret(encrypted) ?? '' : '';
  const pass = databasePass || config.mail.pass;
  return {
    enabled: getSetting(db, 'email.enabled', false),
    host: getSetting(db, 'email.host', config.mail.host) || config.mail.host,
    port: getSetting(db, 'email.port', config.mail.port) || config.mail.port,
    secure: getSetting(db, 'email.secure', config.mail.port === 465),
    user: getSetting(db, 'email.user', config.mail.user) || config.mail.user,
    pass,
    fromName: getSetting(db, 'email.from_name', envFrom.name) || envFrom.name || appName,
    fromEmail: getSetting(db, 'email.from_email', envFrom.email) || envFrom.email,
    replyTo: getSetting(db, 'email.reply_to', '') || '',
    securityNotifications: getSetting(db, 'email.security_notifications', true),
    rewardNotifications: getSetting(db, 'email.reward_notifications', true),
    passSource: databasePass ? 'database' : config.mail.pass ? 'environment' : 'none',
    appName,
    tagline,
    appUrl: config.appUrl.replace(/\/$/, ''),
  };
}

export function emailReady(email: EmailConfig): boolean {
  return Boolean(email.host && email.user && email.pass && email.fromEmail && isValidEmail(email.fromEmail));
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textValue(payload: Record<string, unknown>, key: string, fallback = ''): string {
  const value = payload[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return fallback;
}

function safeUrl(email: EmailConfig, path: string): string {
  if (/^https?:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      // Queued jobs can outlive a configuration change. Rewrite loopback links
      // to the public origin so an old payload can never send users to a
      // development address.
      if (isLoopbackHost(url.hostname)) return `${email.appUrl}${url.pathname}${url.search}${url.hash}`;
      return path;
    } catch {
      return `${email.appUrl}/`;
    }
  }
  return `${email.appUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function formatDateTime(value: unknown, timezone?: unknown): string {
  const iso = typeof value === 'string' ? value : new Date().toISOString();
  const tz = typeof timezone === 'string' ? timezone : undefined;
  try {
    return new Date(iso).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...(tz ? { timeZone: tz } : {}),
    });
  } catch {
    return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  }
}

function paragraph(text: string, tone: 'muted' | 'ink' = 'muted'): string {
  return `<p style="margin:0 0 16px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:${tone === 'ink' ? '#f6f4ef' : '#aeb5c2'};">${text}</p>`;
}

function button(email: EmailConfig, label: string, path: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0 8px;">
  <tr>
    <td align="center" bgcolor="#e6c27a" style="border-radius:10px;box-shadow:0 10px 24px -14px rgba(230,194,122,0.8);">
      <a href="${escapeHtml(safeUrl(email, path))}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;line-height:1;color:#211706;text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

function detailRows(rows: [string, string][]): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0 6px;border:1px solid #28303d;border-radius:12px;border-collapse:separate;overflow:hidden;">
  ${rows
    .map(
      ([label, value], index) => `<tr>
    <td style="padding:11px 14px;border-${index === 0 ? 'top' : 'bottom'}:${index === 0 ? 'none' : '1px solid #28303d'};background:#11151d;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#8f97a5;">${escapeHtml(label)}</td>
    <td align="right" style="padding:11px 14px;border-${index === 0 ? 'top' : 'bottom'}:${index === 0 ? 'none' : '1px solid #28303d'};background:#11151d;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;color:#f6f4ef;">${escapeHtml(value)}</td>
  </tr>`,
    )
    .join('')}
</table>`;
}

function callout(text: string, tone: 'gold' | 'success' | 'danger' = 'gold'): string {
  const colors = {
    gold: { border: '#5b4a28', bg: '#1c1810', text: '#f4d99f' },
    success: { border: '#245844', bg: '#101d18', text: '#8df0c4' },
    danger: { border: '#5c2d33', bg: '#1e1114', text: '#ffadb5' },
  }[tone];
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:22px 0 4px;">
  <tr><td style="padding:14px 16px;border:1px solid ${colors.border};border-radius:12px;background:${colors.bg};font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.65;color:${colors.text};">${text}</td></tr>
</table>`;
}

function preheader(text: string): string {
  return `<div style="display:none;font-size:1px;color:#f3efe4;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(text)}</div>`;
}

function layout(email: EmailConfig, input: {
  title: string;
  kicker?: string;
  preheader: string;
  content: string;
  footerNote?: string;
}): string {
  const preferences = safeUrl(email, '/settings#email');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(input.title)}</title>
<style>
  @media only screen and (max-width:620px){
    .email-shell{width:100%!important;}
    .email-pad{padding-left:22px!important;padding-right:22px!important;}
    .email-title{font-size:26px!important;line-height:1.15!important;}
  }
  a{text-decoration:none;}
</style>
</head>
<body style="margin:0;padding:0;background-color:#f2eee5;">
${preheader(input.preheader)}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f2eee5" style="background-color:#f2eee5;">
  <tr>
    <td align="center" style="padding:34px 12px;">
      <table role="presentation" class="email-shell" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;border-collapse:separate;">
        <tr>
          <td class="email-pad" style="padding:26px 34px;background:#0a0c11;border:1px solid #252c39;border-bottom:none;border-radius:20px 20px 0 0;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
              <td align="left">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
                  <td width="40" height="40" align="center" valign="middle" bgcolor="#e6c27a" style="width:40px;height:40px;border-radius:12px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:19px;font-weight:800;color:#211706;">D</td>
                  <td style="padding-left:12px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                    <div style="font-size:15px;font-weight:800;letter-spacing:3px;color:#f6f4ef;">DONUTCASH</div>
                    <div style="font-size:9px;font-weight:600;letter-spacing:2px;color:#9b7f4d;text-transform:uppercase;padding-top:3px;">DonutSMP casino</div>
                  </td>
                </tr></table>
              </td>
              <td align="right" style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#717987;">${escapeHtml(email.tagline)}</td>
            </tr></table>
          </td>
        </tr>
        <tr><td style="height:3px;background-color:#e6c27a;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr>
          <td class="email-pad" style="padding:38px 34px 34px;background:#0a0c11;border-left:1px solid #252c39;border-right:1px solid #252c39;">
            ${input.kicker ? `<p style="margin:0 0 12px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:2.4px;text-transform:uppercase;color:#9b7f4d;">${escapeHtml(input.kicker)}</p>` : ''}
            <h1 class="email-title" style="margin:0 0 18px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:31px;line-height:1.15;letter-spacing:-0.8px;color:#f6f4ef;font-weight:700;">${escapeHtml(input.title)}</h1>
            ${input.content}
          </td>
        </tr>
        <tr>
          <td class="email-pad" style="padding:22px 34px 28px;background:#080a0e;border:1px solid #252c39;border-top:1px solid #1c212c;border-radius:0 0 20px 20px;">
            <p style="margin:0 0 8px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:1.7;color:#717987;">
              ${escapeHtml(input.footerNote ?? `You are receiving this because you have a ${email.appName} account.`)}
            </p>
            <p style="margin:0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:1.7;color:#717987;">
              <a href="${escapeHtml(preferences)}" style="color:#e6c27a;text-decoration:underline;">Email preferences</a>
              &nbsp;·&nbsp;
              <a href="${escapeHtml(safeUrl(email, '/'))}" style="color:#e6c27a;text-decoration:underline;">Open the lobby</a>
            </p>
            <p style="margin:10px 0 0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:10px;color:#4f5664;">
              © ${new Date().getFullYear()} ${escapeHtml(email.appName)} · Play responsibly with DonutSMP money only.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function footerText(email: EmailConfig): string {
  return `\n\n—\n${email.appName} · ${email.tagline}\nEmail preferences: ${safeUrl(email, '/settings#email')}\nOpen the lobby: ${safeUrl(email, '/')}`;
}

export function renderEmail(template: EmailTemplate, payload: Record<string, unknown>, email: EmailConfig): RenderedEmail {
  const username = textValue(payload, 'username', 'there');
  const amount = Number(payload.amount ?? 0);
  const cta = (label: string, path: string) => button(email, label, path);
  const signoff = `<p style="margin:24px 0 0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.7;color:#8f97a5;">See you at the tables,<br><strong style="color:#f6f4ef;">The ${escapeHtml(email.appName)} team</strong></p>`;

  switch (template) {
    case 'welcome': {
      const verifyUrl = textValue(payload, 'verifyUrl');
      const credits = Number(payload.startingCredits ?? 0);
      return {
        subject: `Welcome to ${email.appName}, ${username}`,
        html: layout(email, {
          title: `Welcome aboard, ${username}.`,
          kicker: 'Your account is ready',
          preheader: `${compactAmount(credits)} DonutSMP money has been added to your wallet.`,
          content: [
            paragraph(`Your ${escapeHtml(email.appName)} account is live. We added <strong style="color:#f8e5b8;">${compactAmount(credits)} DonutSMP money</strong> to your wallet so you can try the tables right away.`),
            detailRows([
              ['Starting balance', `${compactAmount(credits)} money`],
              ['Account', username],
              ['Status', verifyUrl ? 'Email verification pending' : 'Active'],
            ]),
            verifyUrl
              ? paragraph('One quick step: confirm your email so we can help you recover your account and send important security alerts.') + cta('Verify my email', verifyUrl)
              : paragraph('Your email is already verified. You are all set.'),
            cta('Enter the lobby', '/games'),
            callout('Every wager and payout is settled server-side and written to your ledger. Play responsibly.', 'gold'),
            signoff,
          ].join(''),
        }),
        text: [
          `Welcome aboard, ${username}.`,
          '',
          `Your ${email.appName} account is live with ${compactAmount(credits)} DonutSMP money in your wallet.`,
          verifyUrl ? `\nVerify your email: ${safeUrl(email, verifyUrl)}` : '',
          `\nEnter the lobby: ${safeUrl(email, '/games')}`,
          '\nEvery wager and payout is settled server-side and written to your ledger. Play responsibly.',
          footerText(email),
        ].join('\n'),
      };
    }
    case 'verify-email':
      return {
        subject: `Verify your email for ${email.appName}`,
        html: layout(email, {
          title: 'Confirm your email address',
          kicker: 'Account security',
          preheader: 'One click confirms your email and unlocks account recovery.',
          content: [
            paragraph(`Hi ${username || 'there'}, please confirm the email address on your ${escapeHtml(email.appName)} account.`),
            cta('Verify my email', textValue(payload, 'verifyUrl', '/settings')),
            callout(`This link expires ${escapeHtml(formatDateTime(payload.expiresAt))}. If you did not request it, you can safely ignore this email.`, 'gold'),
            signoff,
          ].join(''),
        }),
        text: [
          `Confirm your email address for ${email.appName}.`,
          `${safeUrl(email, textValue(payload, 'verifyUrl', '/settings'))}`,
          `This link expires ${formatDateTime(payload.expiresAt)}.`,
          footerText(email),
        ].join('\n'),
      };
    case 'password-reset':
      return {
        subject: `Reset your ${email.appName} password`,
        html: layout(email, {
          title: 'Reset your password',
          kicker: 'Password reset requested',
          preheader: 'This secure link expires in one hour.',
          content: [
            paragraph(`We received a request to reset the password for <strong style="color:#f6f4ef;">${escapeHtml(username)}</strong>.`),
            cta('Choose a new password', textValue(payload, 'resetUrl', '/forgot-password')),
            callout('This link expires in one hour and can only be used once. If you did not request a reset, ignore this email — your password has not changed.', 'gold'),
            paragraph('For your safety, all active sessions are revoked after a password reset.', 'muted'),
          ].join(''),
        }),
        text: [
          `Reset your ${email.appName} password:`,
          safeUrl(email, textValue(payload, 'resetUrl', '/forgot-password')),
          'This link expires in one hour. If you did not request it, ignore this email.',
          footerText(email),
        ].join('\n'),
      };
    case 'password-changed':
      return {
        subject: `Your ${email.appName} password was changed`,
        html: layout(email, {
          title: 'Your password was changed',
          kicker: 'Security alert',
          preheader: 'If this was not you, secure your account immediately.',
          content: [
            paragraph(`The password for <strong style="color:#f6f4ef;">${escapeHtml(username)}</strong> was changed on ${escapeHtml(formatDateTime(payload.changedAt))}.`),
            detailRows([
              ['Account', username],
              ['When', formatDateTime(payload.changedAt)],
              ['Sessions', 'Other sessions were signed out'],
            ]),
            callout('If you did not make this change, reset your password immediately and contact support.', 'danger'),
            cta('Review account security', '/settings'),
          ].join(''),
        }),
        text: [
          `Your ${email.appName} password was changed on ${formatDateTime(payload.changedAt)}.`,
          'If this was not you, reset your password immediately and contact support.',
          safeUrl(email, '/settings'),
          footerText(email),
        ].join('\n'),
      };
    case 'new-login':
      return {
        subject: `New sign-in to your ${email.appName} account`,
        html: layout(email, {
          title: 'New sign-in detected',
          kicker: 'Security alert',
          preheader: 'Review the device and location below.',
          content: [
            paragraph(`Your account <strong style="color:#f6f4ef;">${escapeHtml(username)}</strong> was just signed in to.`),
            detailRows([
              ['When', formatDateTime(payload.at)],
              ['IP address', textValue(payload, 'ip', 'Unknown')],
              ['Device', textValue(payload, 'device', 'Unknown device').slice(0, 160)],
            ]),
            paragraph('If this was you, no action is needed. If not, change your password and review your active sessions now.'),
            cta('Review active sessions', '/settings'),
          ].join(''),
        }),
        text: [
          `New sign-in to ${email.appName} for ${username}.`,
          `When: ${formatDateTime(payload.at)}`,
          `IP: ${textValue(payload, 'ip', 'Unknown')}`,
          `Device: ${textValue(payload, 'device', 'Unknown device')}`,
          'If this was not you, change your password and review active sessions.',
          safeUrl(email, '/settings'),
          footerText(email),
        ].join('\n'),
      };
    case 'email-changed':
      return {
        subject: `Your ${email.appName} email address was changed`,
        html: layout(email, {
          title: 'Your email address was changed',
          kicker: 'Security alert',
          preheader: 'This notice was sent to the previous address on your account.',
          content: [
            paragraph(`The email address on your ${escapeHtml(email.appName)} account was changed to <strong style="color:#f8e5b8;">${escapeHtml(textValue(payload, 'newEmail', 'a new address'))}</strong>.`),
            paragraph('We sent this notice to the previous address so you are always aware of account changes.'),
            callout('If you did not make this change, contact support immediately so we can secure your account.', 'danger'),
            cta('Contact support', '/tickets/new'),
          ].join(''),
        }),
        text: [
          `The email on your ${email.appName} account was changed to ${textValue(payload, 'newEmail', 'a new address')}.`,
          'If this was not you, contact support immediately.',
          safeUrl(email, '/tickets/new'),
          footerText(email),
        ].join('\n'),
      };
    case 'reward-claimed': {
      const milestone = textValue(payload, 'milestoneLabel');
      return {
        subject: `Day ${Number(payload.streakDay ?? 1)} reward claimed`,
        html: layout(email, {
          title: 'Daily reward claimed',
          kicker: 'Rewards',
          preheader: `${compactAmount(amount)} money added to your wallet.`,
          content: [
            paragraph(`Nice one, ${escapeHtml(username)}. Your day ${Number(payload.streakDay ?? 1)} reward is in your wallet.`),
            detailRows([
              ['Reward', `${compactAmount(amount)} money`],
              ['Streak day', String(Number(payload.streakDay ?? 1))],
              ...(milestone ? ([['Milestone', milestone]] as [string, string][]) : []),
              ['Next reset', formatDateTime(payload.nextResetAt, payload.timezone)],
            ]),
            cta('Keep the streak alive', '/rewards'),
            callout('Claim again after the next reset to keep your streak growing. Missing a day may reset it depending on the current reward policy.', 'success'),
            signoff,
          ].join(''),
        }),
        text: [
          `Daily reward claimed: ${compactAmount(amount)} money for day ${Number(payload.streakDay ?? 1)}.`,
          milestone ? `Milestone: ${milestone}` : '',
          `Next reset: ${formatDateTime(payload.nextResetAt, payload.timezone)}`,
          safeUrl(email, '/rewards'),
          footerText(email),
        ].join('\n'),
      };
    }
    case 'announcement':
      return {
        subject: textValue(payload, 'title', `News from ${email.appName}`),
        html: layout(email, {
          title: textValue(payload, 'title', `News from ${email.appName}`),
          kicker: 'Announcement',
          preheader: textValue(payload, 'body').slice(0, 120),
          content: [
            paragraph(escapeHtml(textValue(payload, 'body')).replace(/\n/g, '<br>')),
            cta('Read in your notifications', '/notifications'),
          ].join(''),
        }),
        text: [
          textValue(payload, 'title', `News from ${email.appName}`),
          '',
          textValue(payload, 'body'),
          '',
          safeUrl(email, '/notifications'),
          footerText(email),
        ].join('\n'),
      };
    case 'cashier-decision': {
      const approved = textValue(payload, 'status') === 'approved';
      return {
        subject: `${textValue(payload, 'kind', 'Cashier')} request ${textValue(payload, 'status', 'updated')}`,
        html: layout(email, {
          title: approved ? 'Your request was approved' : 'Your request needs attention',
          kicker: 'Cashier update',
          preheader: `${textValue(payload, 'reference')} · ${compactAmount(amount)} money`,
          content: [
            paragraph(`Hi ${escapeHtml(username)}, your ${escapeHtml(textValue(payload, 'kind', 'cashier'))} request has been ${escapeHtml(textValue(payload, 'status', 'updated'))}.`),
            detailRows([
              ['Reference', textValue(payload, 'reference', '—')],
              ['Amount', `${compactAmount(amount)} money`],
              ['Status', textValue(payload, 'status', '—')],
              ...(textValue(payload, 'reason') ? ([['Note', textValue(payload, 'reason')]] as [string, string][]) : []),
            ]),
            cta('Open the cashier', `/cashier/${encodeURIComponent(textValue(payload, 'reference', ''))}`),
          ].join(''),
        }),
        text: [
          `Your ${textValue(payload, 'kind', 'cashier')} request ${textValue(payload, 'reference')} was ${textValue(payload, 'status')}.`,
          `Amount: ${compactAmount(amount)} money`,
          textValue(payload, 'reason') ? `Note: ${textValue(payload, 'reason')}` : '',
          safeUrl(email, `/cashier/${encodeURIComponent(textValue(payload, 'reference', ''))}`),
          footerText(email),
        ].join('\n'),
      };
    }
    case 'test':
    default:
      return {
        subject: `Test email from ${email.appName}`,
        html: layout(email, {
          title: 'SMTP is working',
          kicker: 'Email settings',
          preheader: 'This is a test message from your admin panel.',
          content: [
            paragraph('This test message confirms that your SMTP server, credentials, sender name and sender address are configured correctly.'),
            detailRows([
              ['SMTP host', `${email.host}:${email.port}`],
              ['Sender', `${email.fromName} <${email.fromEmail}>`],
              ['Sent', formatDateTime(new Date().toISOString())],
            ]),
            callout('If this message landed in spam, add the sender to your allowlist and verify the domain in Brevo.', 'gold'),
          ].join(''),
        }),
        text: [
          `SMTP is working for ${email.appName}.`,
          `Server: ${email.host}:${email.port}`,
          `Sender: ${email.fromName} <${email.fromEmail}>`,
          footerText(email),
        ].join('\n'),
      };
  }
}

export function enqueueEmail(db: DB, input: EnqueueInput): string | null {
  const email = getEmailConfig(db);
  if (!email.enabled || !emailReady(email)) return null;
  if (!isValidEmail(input.recipient)) return null;
  if (input.respectPreference && input.userId) {
    const row = db.prepare('SELECT email_notifications FROM users WHERE id = ?').get(input.userId) as
      | { email_notifications: number }
      | undefined;
    if (!row || !row.email_notifications) return null;
  }
  const now = nowIso();
  const id = newId('eml');
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO email_jobs
         (id, user_id, recipient, template, payload, status, attempts, max_attempts, next_attempt_at, created_at, updated_at, dedupe_key)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, 3, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.userId ?? null,
      input.recipient.toLowerCase(),
      input.template,
      JSON.stringify(input.payload),
      now,
      now,
      now,
      input.dedupeKey ?? null,
    );
  return result.changes === 1 ? id : null;
}

function createTransport(email: EmailConfig) {
  return nodemailer.createTransport({
    host: email.host,
    port: email.port,
    secure: email.secure,
    requireTLS: !email.secure,
    auth: { user: email.user, pass: email.pass },
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 20_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

async function sendRendered(email: EmailConfig, recipient: string, rendered: RenderedEmail): Promise<string> {
  if (!emailReady(email)) {
    throw new Error('Email delivery is not fully configured.');
  }
  const transporter = createTransport(email);
  const info = await transporter.sendMail({
    from: { name: email.fromName, address: email.fromEmail },
    to: recipient,
    replyTo: email.replyTo || undefined,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: {
      'X-Entity-Ref-ID': `donutcash-${Date.now()}`,
      'List-Unsubscribe': `<${safeUrl(email, '/settings#email')}>`,
    },
  });
  return info.messageId;
}

function safeError(error: unknown, email: EmailConfig): string {
  let message = error instanceof Error ? error.message : String(error);
  if (email.pass) message = message.replaceAll(email.pass, '[redacted]');
  message = message.replace(/pass(word)?[=:]\s*\S+/gi, 'password=[redacted]');
  return message.slice(0, 500);
}

export interface EmailQueueResult {
  considered: number;
  sent: number;
  failed: number;
  skipped: number;
}

let processing = false;

export async function processEmailQueue(db: DB, limit = 10): Promise<EmailQueueResult> {
  const result: EmailQueueResult = { considered: 0, sent: 0, failed: 0, skipped: 0 };
  if (processing) return result;
  const email = getEmailConfig(db);
  if (!email.enabled || !emailReady(email)) return result;
  processing = true;
  try {
    const due = db
      .prepare(
        `SELECT * FROM email_jobs
         WHERE status = 'pending' AND next_attempt_at <= ?
         ORDER BY created_at ASC LIMIT ?`,
      )
      .all(nowIso(), limit) as EmailJobRow[];
    result.considered = due.length;
    for (const job of due) {
      const claimed = db
        .prepare(
          `UPDATE email_jobs SET status = 'sending', attempts = attempts + 1, updated_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(nowIso(), job.id);
      if (claimed.changes !== 1) {
        result.skipped += 1;
        continue;
      }
      const fresh = db.prepare('SELECT * FROM email_jobs WHERE id = ?').get(job.id) as EmailJobRow;
      try {
        const payload = parseJson<Record<string, unknown>>(fresh.payload, {});
        const rendered = renderEmail(fresh.template, payload, email);
        await sendRendered(email, fresh.recipient, rendered);
        db.prepare(
          `UPDATE email_jobs SET status = 'sent', sent_at = ?, updated_at = ?, last_error = NULL WHERE id = ?`,
        ).run(nowIso(), nowIso(), fresh.id);
        result.sent += 1;
      } catch (error) {
        const message = safeError(error, email);
        const failed = fresh.attempts >= fresh.max_attempts;
        const delayMinutes = Math.min(60, 2 ** Math.max(0, fresh.attempts - 1));
        const next = new Date(Date.now() + delayMinutes * 60_000).toISOString();
        db.prepare(
          `UPDATE email_jobs SET status = ?, next_attempt_at = ?, updated_at = ?, last_error = ? WHERE id = ?`,
        ).run(failed ? 'failed' : 'pending', next, nowIso(), message, fresh.id);
        result.failed += 1;
        console.warn(
          `[email] ${failed ? 'failed permanently' : 'delivery retry scheduled'} for job ${fresh.id} (${fresh.template})`,
        );
      }
    }
  } finally {
    processing = false;
  }
  return result;
}

export async function sendTestEmail(db: DB, recipient: string): Promise<{ messageId: string }> {
  const email = getEmailConfig(db);
  if (!emailReady(email)) throw new Error('Complete the SMTP server, login, key and sender address first.');
  const rendered = renderEmail('test', {}, email);
  const messageId = await sendRendered(email, recipient, rendered);
  setSetting(db, 'email.last_test_at', nowIso(), null);
  setSetting(db, 'email.last_error', null, null);
  return { messageId };
}

export function emailSettingsView(db: DB): EmailSettingsView {
  const email = getEmailConfig(db);
  const counts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status IN ('pending','sending') THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM email_jobs`,
    )
    .get() as { pending: number | null; sent: number | null; failed: number | null };
  const queue = db
    .prepare('SELECT * FROM email_jobs ORDER BY created_at DESC LIMIT 15')
    .all() as EmailJobRow[];
  return {
    enabled: email.enabled,
    host: email.host,
    port: email.port,
    secure: email.secure,
    user: email.user,
    fromName: email.fromName,
    fromEmail: email.fromEmail,
    replyTo: email.replyTo,
    securityNotifications: email.securityNotifications,
    rewardNotifications: email.rewardNotifications,
    smtpPassSet: Boolean(email.pass),
    smtpPassSource: email.passSource,
    lastTestAt: getSetting<string | null>(db, 'email.last_test_at', null),
    lastError: getSetting<string | null>(db, 'email.last_error', null),
    queue: queue.map(
      (job): EmailJobSummary => ({
        id: job.id,
        recipient: job.recipient,
        template: job.template,
        status: job.status,
        attempts: job.attempts,
        maxAttempts: job.max_attempts,
        lastError: job.last_error,
        createdAt: job.created_at,
        sentAt: job.sent_at,
      }),
    ),
    counts: {
      pending: counts.pending ?? 0,
      sent: counts.sent ?? 0,
      failed: counts.failed ?? 0,
    },
  };
}

export function retryEmailJob(db: DB, id: string): boolean {
  const result = db
    .prepare(
      `UPDATE email_jobs SET status = 'pending', attempts = 0, next_attempt_at = ?, last_error = NULL, updated_at = ?
       WHERE id = ? AND status = 'failed'`,
    )
    .run(nowIso(), nowIso(), id);
  return result.changes === 1;
}
