import { randomUUID } from 'node:crypto';
import { ApiError } from './core.ts';

/**
 * Server-side Cloudflare Turnstile validation.
 *
 * The widget token is only a claim; it becomes meaningful after this module
 * validates it with Cloudflare's Siteverify endpoint. The secret never leaves
 * the server and is never included in the public config or the client bundle.
 */

export type TurnstileAction = 'register' | 'login' | 'forgot-password';

export interface TurnstileSettings {
  enabled: boolean;
  siteKey: string;
  secretKey: string;
  expectedHostname?: string;
}

export interface TurnstileVerifier {
  readonly enabled: boolean;
  readonly siteKey: string;
  verify(token: string | undefined, action: TurnstileAction, remoteIp: string | null): Promise<void>;
}

interface SiteverifyResponse {
  success?: boolean;
  'error-codes'?: string[];
  action?: string;
  hostname?: string;
  challenge_ts?: string;
}

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SITEVERIFY_TIMEOUT_MS = 8_000;

function unavailable(): never {
  throw new ApiError(
    503,
    'CAPTCHA_UNAVAILABLE',
    'The bot check is temporarily unavailable. Please try again in a moment.',
  );
}

function rejected(): never {
  throw new ApiError(403, 'CAPTCHA_FAILED', 'The bot check failed. Please complete it again and retry.');
}

export function createTurnstileVerifier(settings: TurnstileSettings): TurnstileVerifier {
  return {
    enabled: settings.enabled,
    siteKey: settings.siteKey,
    async verify(token, action, remoteIp) {
      if (!settings.enabled) return;

      if (!token || !token.trim()) {
        throw new ApiError(400, 'CAPTCHA_REQUIRED', 'Please complete the bot check before continuing.');
      }
      if (token.length > 2048) {
        throw new ApiError(400, 'CAPTCHA_INVALID', 'Please complete the bot check again.');
      }

      const body = new URLSearchParams({
        secret: settings.secretKey,
        response: token,
        idempotency_key: randomUUID(),
      });
      if (remoteIp) body.set('remoteip', remoteIp);

      let response: Response;
      try {
        response = await fetch(SITEVERIFY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
        });
      } catch (error) {
        console.warn(
          '[turnstile] Siteverify request failed:',
          error instanceof Error ? error.message : 'unknown network error',
        );
        unavailable();
      }

      if (!response.ok) {
        console.warn(`[turnstile] Siteverify returned HTTP ${response.status}`);
        unavailable();
      }

      let result: SiteverifyResponse;
      try {
        result = (await response.json()) as SiteverifyResponse;
      } catch {
        console.warn('[turnstile] Siteverify returned malformed JSON');
        unavailable();
      }

      if (result.success !== true) {
        const codes = result['error-codes'] ?? [];
        console.warn('[turnstile] validation rejected', {
          action,
          codes,
          hostname: result.hostname ?? null,
        });
        // Wrong secret or a Cloudflare-side fault is an outage, not a user
        // mistake. Do not tell the visitor that their challenge failed.
        if (codes.includes('missing-input-secret') || codes.includes('invalid-input-secret') || codes.includes('internal-error')) {
          unavailable();
        }
        rejected();
      }

      // A token issued for one form must not be replayed against another. The
      // widget sets `action`, and Cloudflare echoes it on successful validation.
      // Official test keys return no action, so only compare when one is present.
      if (result.action && result.action !== action) {
        console.warn('[turnstile] action mismatch', { expected: action, received: result.action });
        rejected();
      }

      if (settings.expectedHostname && result.hostname?.toLowerCase() !== settings.expectedHostname) {
        console.warn('[turnstile] hostname mismatch', {
          expected: settings.expectedHostname,
          received: result.hostname ?? null,
        });
        rejected();
      }
    },
  };
}
