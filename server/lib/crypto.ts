import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from '../config.ts';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * SMTP credentials are encrypted at rest with a key derived from the server
 * secret. They are never written to logs or returned to the browser.
 */
function mailEncryptionKey(): Buffer {
  const material = process.env.EMAIL_ENCRYPTION_KEY || config.sessionSecret || 'donutcash-local-email-key';
  return createHash('sha256').update(material).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', mailEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSecret(payload: string): string | null {
  try {
    const [version, iv, tag, encrypted] = payload.split('.');
    if (version !== 'v1' || !iv || !tag || !encrypted) return null;
    const decipher = createDecipheriv('aes-256-gcm', mailEncryptionKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function tokenHash(token: string): string {
  return createHmac('sha256', config.sessionSecret || 'aurum-development-pepper').update(token).digest('hex');
}

/** Token handed to a user for password reset. Only its hash is persisted. */
export function resetToken(): { token: string; hash: string } {
  const token = randomToken(32);
  return { token, hash: tokenHash(token) };
}

export function passwordIssues(password: string): string[] {
  const issues: string[] = [];
  if (password.length < 10) issues.push('Use at least 10 characters.');
  if (password.length > 200) issues.push('Use at most 200 characters.');
  if (!/[a-zA-Z]/.test(password)) issues.push('Include at least one letter.');
  if (!/[0-9]/.test(password)) issues.push('Include at least one number.');
  return issues;
}

/**
 * Session cookies are httpOnly and same-site. Config requires a strong
 * SESSION_SECRET in production; we fail closed rather than inventing one.
 */
export function assertProductionSecrets(): void {
  if (!config.isProduction) return;
  if (!config.sessionSecret || config.sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be set to at least 32 characters in production.');
  }
  console.info('[security] SESSION_SECRET accepted; session tokens are peppered before storage.');
}
