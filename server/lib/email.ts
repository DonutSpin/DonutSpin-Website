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
  | 'ticket-created'
  | 'ticket-reply'
  | 'account-deletion'
  | 'giveaway-winner'
  | 'giveaway-sponsor'
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

// The palette is copied from the website theme (src/index.css) so an email
// looks like the same product: near-black surfaces, warm cream type and muted
// gold accents. The neon logo is the only saturated element in the message.
const COLORS = {
  page: '#06070a',
  card: '#0a0c11',
  panel: '#0f1219',
  panelSoft: '#121620',
  footer: '#07090d',
  border: '#222836',
  borderSoft: '#1a1f29',
  ink: '#f6f4ef',
  muted: '#9ba2b0',
  faint: '#717987',
  gold: '#e6c27a',
  goldBright: '#f8e5b8',
  goldDim: '#9b7f4d',
  success: '#4dd6a0',
  danger: '#f87b86',
} as const;

const EMAIL_FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Helvetica,Arial,sans-serif";

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

function paragraph(text: string, tone: 'muted' | 'ink' | 'faint' = 'muted'): string {
  const color = tone === 'ink' ? COLORS.ink : tone === 'faint' ? COLORS.faint : COLORS.muted;
  return `<p style="margin:0 0 18px;font-family:${EMAIL_FONT};font-size:15px;line-height:1.72;color:${color};mso-line-height-rule:exactly;">${text}</p>`;
}

function button(
  email: EmailConfig,
  label: string,
  path: string,
  variant: 'primary' | 'secondary' = 'primary',
): string {
  const href = escapeHtml(safeUrl(email, path));
  const primary = variant === 'primary';
  const background = primary ? COLORS.gold : COLORS.card;
  const foreground = primary ? '#1b1307' : COLORS.goldBright;
  const border = primary ? COLORS.gold : COLORS.border;
  const width = Math.max(184, Math.min(300, Math.round(label.length * 8.6 + 64)));
  return `<table role="presentation" class="email-button" cellspacing="0" cellpadding="0" border="0" style="margin:${primary ? '24px' : '0'} 0 10px;">
  <tr>
    <td align="center" bgcolor="${background}" style="border:1px solid ${border};border-radius:8px;mso-padding-alt:15px 30px;">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:46px;v-text-anchor:middle;width:${width}px;" arcsize="17%" stroke="t" strokecolor="${border}" strokeweight="1px" fillcolor="${background}">
        <w:anchorlock/>
        <center style="color:${foreground};font-family:${EMAIL_FONT};font-size:14px;font-weight:700;">${escapeHtml(label)}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="${href}" target="_blank" style="display:inline-block;padding:15px 30px;font-family:${EMAIL_FONT};font-size:14px;font-weight:700;line-height:1;color:${foreground};text-decoration:none;border-radius:8px;mso-line-height-rule:exactly;">${escapeHtml(label)}</a>
      <!--<![endif]-->
    </td>
  </tr>
</table>`;
}

function detailRows(rows: [string, string][]): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0 8px;border:1px solid ${COLORS.border};border-radius:12px;border-collapse:separate;background-color:${COLORS.panel};">
  ${rows
    .map(
      ([label, value], index) => `<tr>
    <td class="email-detail-label" width="38%" style="padding:12px 16px;${index === rows.length - 1 ? '' : `border-bottom:1px solid ${COLORS.borderSoft};`}background-color:${COLORS.panel};font-family:${EMAIL_FONT};font-size:9.5px;font-weight:700;letter-spacing:1.3px;line-height:1.45;text-transform:uppercase;color:${COLORS.faint};vertical-align:top;">${escapeHtml(label)}</td>
    <td class="email-detail-value" align="right" style="padding:12px 16px;${index === rows.length - 1 ? '' : `border-bottom:1px solid ${COLORS.borderSoft};`}background-color:${COLORS.panel};font-family:${EMAIL_FONT};font-size:12.5px;font-weight:600;line-height:1.5;color:${COLORS.ink};word-break:break-word;vertical-align:top;">${escapeHtml(value)}</td>
  </tr>`,
    )
    .join('')}
</table>`;
}

function callout(
  text: string,
  tone: 'gold' | 'success' | 'danger' = 'gold',
  label?: string,
): string {
  const colors = {
    gold: { accent: COLORS.gold, bg: '#17140e', text: '#ddcfb2', label: 'Good to know' },
    success: { accent: COLORS.success, bg: '#0e1a16', text: '#b9e8d2', label: 'All set' },
    danger: { accent: COLORS.danger, bg: '#1c1114', text: '#f0c4c9', label: 'Security notice' },
  }[tone];
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:22px 0 4px;">
  <tr><td style="padding:14px 17px;border-left:3px solid ${colors.accent};border-radius:0 10px 10px 0;background-color:${colors.bg};font-family:${EMAIL_FONT};">
    <p style="margin:0 0 5px;font-size:9px;font-weight:700;letter-spacing:1.8px;line-height:1.4;text-transform:uppercase;color:${colors.accent};">${escapeHtml(label ?? colors.label)}</p>
    <p style="margin:0;font-size:13px;line-height:1.65;color:${colors.text};">${text}</p>
  </td></tr>
</table>`;
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/** One clear focal number for balance, reward, cashier and giveaway emails. */
function amountHighlight(input: {
  label: string;
  amount: string;
  note?: string;
  tone?: 'gold' | 'success' | 'danger';
}): string {
  const accent = input.tone === 'success' ? COLORS.success : input.tone === 'danger' ? COLORS.danger : COLORS.gold;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${COLORS.panel}" style="margin:0 0 22px;border:1px solid ${COLORS.border};border-radius:12px;border-collapse:separate;background-color:${COLORS.panel};">
  <tr><td align="center" style="padding:22px 18px 20px;background-color:${COLORS.panel};">
    <p style="margin:0 0 8px;font-family:${EMAIL_FONT};font-size:9.5px;font-weight:700;letter-spacing:2px;text-transform:uppercase;line-height:1.4;color:${accent};">${escapeHtml(input.label)}</p>
    <p class="email-amount" style="margin:0;font-family:${EMAIL_FONT};font-size:31px;font-weight:800;line-height:1.1;letter-spacing:-0.6px;color:${COLORS.goldBright};">${escapeHtml(input.amount)} <span style="font-size:10.5px;font-weight:700;letter-spacing:1.8px;color:${COLORS.goldDim};">MONEY</span></p>
    ${input.note ? `<p style="margin:8px 0 0;font-family:${EMAIL_FONT};font-size:11px;line-height:1.55;color:${COLORS.faint};">${escapeHtml(input.note)}</p>` : ''}
  </td></tr>
</table>`;
}

function messageCard(input: { author: string; role: string; meta: string; body: string }): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 10px;border:1px solid ${COLORS.border};border-left:2px solid ${COLORS.goldDim};border-radius:10px;border-collapse:separate;background-color:${COLORS.panelSoft};">
  <tr><td style="padding:14px 16px;background-color:${COLORS.panelSoft};">
    <p style="margin:0 0 3px;font-family:${EMAIL_FONT};font-size:11.5px;font-weight:700;line-height:1.5;color:${COLORS.ink};">${escapeHtml(input.author)} <span style="font-size:8.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${COLORS.goldDim};">${escapeHtml(input.role)}</span></p>
    <p style="margin:0 0 9px;font-family:${EMAIL_FONT};font-size:9.5px;line-height:1.5;color:${COLORS.faint};">${escapeHtml(input.meta)}</p>
    <p style="margin:0;font-family:${EMAIL_FONT};font-size:13px;line-height:1.65;color:#d8dbe2;white-space:pre-wrap;">${escapeHtml(input.body).replace(/\n/g, '<br>')}</p>
  </td></tr>
</table>`;
}

function preheader(text: string): string {
  return `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${COLORS.card};">${escapeHtml(text)}&#8199;&#65279;&#8199;&#65279;&#8199;&#65279;&#8199;&#65279;</div>`;
}

function signature(): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:30px 0 0;border-top:1px solid ${COLORS.border};">
  <tr><td style="padding-top:20px;font-family:${EMAIL_FONT};">
    <p style="margin:0 0 3px;font-size:12px;line-height:1.5;color:${COLORS.faint};">Kind regards,</p>
    <p style="margin:0;font-size:13.5px;font-weight:700;line-height:1.5;color:${COLORS.goldBright};">The DonutSpin team</p>
  </td></tr>
</table>`;
}

function layout(email: EmailConfig, input: {
  title: string;
  kicker?: string;
  preheader: string;
  content: string;
  footerNote?: string;
}): string {
  const preferences = safeUrl(email, '/settings#email');
  const support = safeUrl(email, '/tickets');
  const lobby = safeUrl(email, '/');
  return `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(input.title)}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<style>
  @media only screen and (max-width:620px){
    .email-shell{width:100%!important;max-width:100%!important;border-radius:14px!important;}
    .email-header{padding-left:22px!important;padding-right:22px!important;}
    .email-pad{padding-left:22px!important;padding-right:22px!important;}
    .email-footer{padding-left:22px!important;padding-right:22px!important;}
    .email-title{font-size:23px!important;line-height:1.25!important;}
    .email-logo-cell{width:78px!important;}
    .email-logo{width:64px!important;height:64px!important;}
    .email-brand{font-size:16px!important;letter-spacing:2px!important;}
    .email-amount{font-size:26px!important;}
    .email-button{width:100%!important;}
    .email-button a{display:block!important;}
    .email-detail-label{width:42%!important;padding-left:12px!important;padding-right:12px!important;font-size:9px!important;}
    .email-detail-value{padding-left:12px!important;padding-right:12px!important;font-size:12px!important;}
  }
  a{text-decoration:none;}
</style>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.page};">
${preheader(input.preheader)}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${COLORS.page}" style="background-color:${COLORS.page};">
  <tr>
    <td align="center" style="padding:28px 12px 36px;">
      <table role="presentation" class="email-shell" width="600" cellspacing="0" cellpadding="0" border="0" bgcolor="${COLORS.card}" style="width:100%;max-width:600px;border-collapse:separate;border-spacing:0;background-color:${COLORS.card};border:1px solid ${COLORS.border};border-radius:16px;overflow:hidden;">
        <tr><td height="2" bgcolor="${COLORS.gold}" style="height:2px;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr>
          <td class="email-header" style="padding:26px 34px 24px;background-color:${COLORS.card};border-bottom:1px solid ${COLORS.border};">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
              <td class="email-logo-cell" width="88" valign="middle" style="width:88px;padding-right:16px;">
                <img class="email-logo" src="${escapeHtml(safeUrl(email, '/logo.png'))}" alt="DonutSpin" width="72" height="72" border="0" style="display:block;width:72px;height:72px;border-radius:18px;border:1px solid ${COLORS.border};background-color:${COLORS.page};" />
              </td>
              <td valign="middle" style="font-family:${EMAIL_FONT};">
                <div class="email-brand" style="font-size:18px;font-weight:800;letter-spacing:2.4px;line-height:1.3;color:${COLORS.goldBright};">DONUTSPIN</div>
                <div style="margin-top:6px;font-size:10.5px;line-height:1.5;color:${COLORS.faint};">${escapeHtml(email.tagline)}</div>
              </td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td class="email-pad" style="padding:34px 34px 30px;background-color:${COLORS.card};">
            ${input.kicker ? `<p style="margin:0 0 12px;font-family:${EMAIL_FONT};font-size:9px;font-weight:700;letter-spacing:2.2px;line-height:1.5;text-transform:uppercase;color:${COLORS.goldDim};">${escapeHtml(input.kicker)}</p>` : ''}
            <h1 class="email-title" style="margin:0 0 20px;font-family:${EMAIL_FONT};font-size:27px;line-height:1.24;letter-spacing:-0.4px;color:${COLORS.ink};font-weight:700;mso-line-height-rule:exactly;">${escapeHtml(input.title)}</h1>
            ${input.content}
            ${signature()}
          </td>
        </tr>
        <tr>
          <td class="email-footer" style="padding:22px 34px 26px;background-color:${COLORS.footer};border-top:1px solid ${COLORS.border};">
            <p style="margin:0 0 12px;font-family:${EMAIL_FONT};font-size:11px;line-height:1.65;color:${COLORS.faint};">
              ${escapeHtml(input.footerNote ?? `You are receiving this because you have a ${email.appName} account.`)}
            </p>
            <p style="margin:0 0 14px;font-family:${EMAIL_FONT};font-size:11px;line-height:1.7;color:${COLORS.faint};">
              <a href="${escapeHtml(preferences)}" style="color:${COLORS.gold};text-decoration:none;">Email preferences</a>
              <span style="color:${COLORS.borderSoft};">&nbsp;·&nbsp;</span>
              <a href="${escapeHtml(support)}" style="color:${COLORS.gold};text-decoration:none;">Support</a>
              <span style="color:${COLORS.borderSoft};">&nbsp;·&nbsp;</span>
              <a href="${escapeHtml(lobby)}" style="color:${COLORS.gold};text-decoration:none;">Open the lobby</a>
            </p>
            <p style="margin:0;font-family:${EMAIL_FONT};font-size:9.5px;line-height:1.6;color:${COLORS.faint};">
              © ${new Date().getFullYear()} ${escapeHtml(email.appName)} · In-game currency only · 18+ · Play responsibly.
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
  const cta = (label: string, path: string, variant: 'primary' | 'secondary' = 'primary') =>
    button(email, label, path, variant);

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
            paragraph(`Your ${escapeHtml(email.appName)} account is live. We added <strong style="color:${COLORS.goldBright};">${compactAmount(credits)} DonutSMP money</strong> to your wallet so you can try the tables right away.`),
            amountHighlight({
              label: 'Starting balance',
              amount: compactAmount(credits),
              note: 'DonutSMP money · ready to play',
            }),
            detailRows([
              ['Account', username],
              ['Status', verifyUrl ? 'Email verification pending' : 'Active'],
            ]),
            verifyUrl
              ? paragraph('One quick step: confirm your email so we can help you recover your account and send important security alerts.') +
                cta('Verify my email', verifyUrl) +
                cta('Explore the games', '/games', 'secondary')
              : paragraph('Your email is already verified. You are all set.') + cta('Enter the lobby', '/games'),
            callout('Every wager and payout is settled server-side and written to your ledger. Play responsibly.', 'gold'),
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
            paragraph(`We received a request to reset the password for <strong style="color:${COLORS.ink};">${escapeHtml(username)}</strong>.`),
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
            paragraph(`The password for <strong style="color:${COLORS.ink};">${escapeHtml(username)}</strong> was changed on ${escapeHtml(formatDateTime(payload.changedAt))}.`),
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
            paragraph(`Your account <strong style="color:${COLORS.ink};">${escapeHtml(username)}</strong> was just signed in to.`),
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
            paragraph(`The email address on your ${escapeHtml(email.appName)} account was changed to <strong style="color:${COLORS.goldBright};">${escapeHtml(textValue(payload, 'newEmail', 'a new address'))}</strong>.`),
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
            amountHighlight({
              label: `Day ${Number(payload.streakDay ?? 1)} reward`,
              amount: compactAmount(amount),
              note: milestone ? `${milestone} · added to your wallet` : 'Added to your wallet',
              tone: 'success',
            }),
            detailRows([
              ['Streak day', String(Number(payload.streakDay ?? 1))],
              ['Next reset', formatDateTime(payload.nextResetAt, payload.timezone)],
            ]),
            cta('Keep the streak alive', '/rewards'),
            callout('Claim again after the next reset to keep your streak growing. Missing a day may reset it depending on the current reward policy.', 'success'),
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
    case 'ticket-created': {
      const reference = textValue(payload, 'reference', '—');
      return {
        subject: `Ticket ${reference} received`,
        html: layout(email, {
          title: 'Your support ticket is open',
          kicker: 'Support ticket created',
          preheader: `${reference} · ${textValue(payload, 'subject', 'Support request')}`,
          content: [
            paragraph(`Hi ${escapeHtml(username)}, we received your support ticket and it is now in the queue.`),
            detailRows([
              ['Ticket ID', reference],
              ['Subject', textValue(payload, 'subject', '—')],
              ['Category', textValue(payload, 'category', '—')],
              ['Created', formatDateTime(payload.createdAt)],
            ]),
            paragraph('You can follow every reply and status change on the ticket page. Keep the ticket ID handy when talking to support.'),
            cta('View my ticket', textValue(payload, 'ticketUrl', '/tickets')),
            callout('Please do not open duplicate tickets for the same issue. Add any new details as a reply on the existing ticket.', 'gold'),
          ].join(''),
        }),
        text: [
          `Your support ticket ${reference} was created.`,
          `Subject: ${textValue(payload, 'subject', '—')}`,
          `Category: ${textValue(payload, 'category', '—')}`,
          `Created: ${formatDateTime(payload.createdAt)}`,
          safeUrl(email, textValue(payload, 'ticketUrl', '/tickets')),
          footerText(email),
        ].join('\n'),
      };
    }
    case 'ticket-reply': {
      const reference = textValue(payload, 'reference', '—');
      const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];
      const messages = rawMessages
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const message = entry as Record<string, unknown>;
          return {
            author: textValue(message, 'author', 'Support'),
            role: textValue(message, 'role', 'support'),
            body: textValue(message, 'body'),
            createdAt: formatDateTime(message.createdAt),
          };
        })
        .filter((entry): entry is { author: string; role: string; body: string; createdAt: string } => Boolean(entry));
      const count = messages.length || Number(payload.count ?? 1);
      const previews = messages.slice(0, 8);
      return {
        subject: `${count} new support ${count === 1 ? 'reply' : 'replies'} on ${reference}`,
        html: layout(email, {
          title: count === 1 ? 'Support replied to your ticket' : 'New replies on your ticket',
          kicker: 'Support ticket update',
          preheader: `${reference} · ${textValue(payload, 'subject', 'Support request')}`,
          content: [
            paragraph(
              `Hi ${escapeHtml(username)}, your ticket <strong style="color:${COLORS.ink};">${escapeHtml(
                reference,
              )}</strong> has ${count === 1 ? 'a new reply' : `${count} new replies`}.`,
            ),
            detailRows([
              ['Ticket ID', reference],
              ['Subject', textValue(payload, 'subject', '—')],
              ['New replies', String(count)],
            ]),
            ...previews.map((message) =>
              messageCard({
                author: message.author,
                role: titleCase(message.role),
                meta: message.createdAt,
                body: message.body,
              }),
            ),
            messages.length > previews.length
              ? paragraph(`…and ${messages.length - previews.length} more ${messages.length - previews.length === 1 ? 'reply' : 'replies'} on the ticket.`)
              : '',
            cta('Open the conversation', textValue(payload, 'ticketUrl', '/tickets')),
          ].join(''),
        }),
        text: [
          `Your support ticket ${reference} has ${count === 1 ? 'a new reply' : `${count} new replies`}.`,
          `Subject: ${textValue(payload, 'subject', '—')}`,
          ...previews.map((message) => `\n${message.author} (${message.role}) · ${message.createdAt}\n${message.body}`),
          `\nOpen the conversation: ${safeUrl(email, textValue(payload, 'ticketUrl', '/tickets'))}`,
          footerText(email),
        ].join('\n'),
      };
    }
    case 'cashier-decision': {
      const rawStatus = textValue(payload, 'status', 'updated');
      const approved = rawStatus === 'approved';
      const kind = titleCase(textValue(payload, 'kind', 'Cashier'));
      const status = titleCase(rawStatus);
      return {
        subject: `${kind} request ${rawStatus}`,
        html: layout(email, {
          title: approved ? 'Your request was approved' : 'Your request needs attention',
          kicker: 'Cashier update',
          preheader: `${textValue(payload, 'reference')} · ${compactAmount(amount)} money`,
          content: [
            paragraph(`Hi ${escapeHtml(username)}, your ${escapeHtml(kind.toLowerCase())} request has been ${escapeHtml(rawStatus)}.`),
            amountHighlight({
              label: `${status} ${kind.toLowerCase()}`,
              amount: compactAmount(amount),
              note: textValue(payload, 'reference', ''),
              tone: approved ? 'success' : 'danger',
            }),
            detailRows([
              ['Reference', textValue(payload, 'reference', '—')],
              ['Status', status],
            ]),
            textValue(payload, 'reason')
              ? callout(
                  escapeHtml(textValue(payload, 'reason')),
                  approved ? 'gold' : 'danger',
                  approved ? 'Staff note' : 'Why it was declined',
                )
              : '',
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
    case 'account-deletion':
      return {
        subject: `Confirm deletion of your ${email.appName} account`,
        html: layout(email, {
          title: 'Delete your account?',
          kicker: 'Account deletion requested',
          preheader: 'This confirmation link expires in 30 minutes and can only be used once.',
          content: [
            paragraph(`We received a request to permanently delete the ${escapeHtml(email.appName)} account belonging to <strong style="color:${COLORS.ink};">${escapeHtml(username)}</strong>.`),
            paragraph('If you asked for this, confirm below. Your profile, email address, wallet access, sessions, rewards, support history, and other personal records will be erased. You will not be able to sign in again.'),
            cta('Confirm account deletion', textValue(payload, 'deleteUrl', '/settings')),
            callout('This link expires in 30 minutes and can only be used once. If you did not request this deletion, ignore this email and consider changing your password.', 'danger'),
            paragraph('Financial ledger entries may be retained in pseudonymous form where accounting, anti-fraud, or legal obligations require it. They will no longer be linked to your name or email address.', 'muted'),
          ].join(''),
        }),
        text: [
          `A request was made to permanently delete the ${email.appName} account for ${username}.`,
          `Confirm the deletion: ${safeUrl(email, textValue(payload, 'deleteUrl', '/settings'))}`,
          'This link expires in 30 minutes and can only be used once.',
          'If you did not request this, ignore this email and consider changing your password.',
          'Financial ledger entries may be retained in pseudonymous form where accounting, anti-fraud, or legal obligations require it.',
          footerText(email),
        ].join('\n'),
      };
    case 'giveaway-winner': {
      const payout = Number(payload.payoutAmount ?? amount);
      return {
        subject: `You won ${compactAmount(payout)} money in ${email.appName}`,
        html: layout(email, {
          title: 'You won a giveaway',
          kicker: 'Giveaway result',
          preheader: `${textValue(payload, 'title', 'A giveaway')} · claim your prize`,
          content: [
            paragraph(
              `Congratulations, ${escapeHtml(username)}. Your entry was drawn in <strong style="color:${COLORS.ink};">${escapeHtml(
                textValue(payload, 'title', 'a giveaway'),
              )}</strong>.`,
            ),
            amountHighlight({
              label: 'Giveaway payout',
              amount: compactAmount(payout),
              note: `${Number(payload.winners ?? 1)} ${Number(payload.winners ?? 1) === 1 ? 'winner' : 'winners'} · prize held in escrow`,
              tone: 'success',
            }),
            detailRows([
              ['Giveaway', textValue(payload, 'reference', '—')],
              ['Winners', String(Number(payload.winners ?? 1))],
              ['Prize pool', `${compactAmount(Number(payload.prizeAmount ?? payout))} money`],
            ]),
            paragraph('To receive the prize, open a Giveaway Claim ticket from the Giveaways page. Staff verify the win before releasing the escrow.'),
            cta('Claim my prize', textValue(payload, 'claimUrl', '/giveaways')),
            callout('The prize stays in escrow until staff approve your claim. Keep your claim ticket reference for updates.', 'success'),
          ].join(''),
        }),
        text: [
          `Congratulations, ${username}. You won ${compactAmount(payout)} money in ${textValue(payload, 'title', 'a giveaway')}.`,
          `Giveaway: ${textValue(payload, 'reference', '—')}`,
          `Winners: ${Number(payload.winners ?? 1)}`,
          `Claim your prize: ${safeUrl(email, textValue(payload, 'claimUrl', '/giveaways'))}`,
          'Open a Giveaway Claim ticket so staff can verify the win and release the prize.',
          footerText(email),
        ].join('\n'),
      };
    }
    case 'giveaway-sponsor': {
      const startsAt = textValue(payload, 'startsAt');
      const endsAt = textValue(payload, 'endsAt');
      const prizePool = Number(payload.prizeAmount ?? amount);
      return {
        subject: `Your sponsored giveaway is live: ${compactAmount(prizePool)} money`,
        html: layout(email, {
          title: 'Your giveaway is live',
          kicker: 'Sponsorship published',
          preheader: `${textValue(payload, 'title', 'Community giveaway')} · ${compactAmount(prizePool)} money`,
          content: [
            paragraph(`Thanks for sponsoring a community giveaway, ${escapeHtml(username)}. Staff published it and the prize is held in escrow.`),
            amountHighlight({
              label: 'Prize pool',
              amount: compactAmount(prizePool),
              note: `${Number(payload.winners ?? 1)} ${Number(payload.winners ?? 1) === 1 ? 'winner' : 'winners'} · funded by you`,
            }),
            detailRows([
              ['Giveaway', textValue(payload, 'title', 'Community giveaway')],
              ['Reference', textValue(payload, 'reference', '—')],
              ['Starts', formatDateTime(startsAt)],
              ['Ends', formatDateTime(endsAt)],
            ]),
            cta('View the giveaway', textValue(payload, 'giveawayUrl', '/giveaways')),
            callout('Winners are drawn with a committed random seed when the timer ends. Payouts are released after a staff-verified claim.', 'gold'),
          ].join(''),
        }),
        text: [
          `Your sponsored giveaway is live: ${textValue(payload, 'title', 'Community giveaway')}.`,
          `Reference: ${textValue(payload, 'reference', '—')}`,
          `Prize pool: ${compactAmount(prizePool)} money`,
          `Winners: ${Number(payload.winners ?? 1)}`,
          `Starts: ${formatDateTime(startsAt)}`,
          `Ends: ${formatDateTime(endsAt)}`,
          safeUrl(email, textValue(payload, 'giveawayUrl', '/giveaways')),
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
            callout('If this message landed in spam, add the sender to your allowlist and ask your email provider to authenticate the sending domain.', 'gold'),
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
      'X-Entity-Ref-ID': `donutspin-${Date.now()}`,
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
