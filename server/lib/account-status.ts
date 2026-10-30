import type { SessionUser } from '../../shared/types.ts';
import { ApiError } from './core.ts';

/**
 * Email verification is mandatory before a wager. The check runs on every
 * server entry point that can create a wager, including blackjack double-down,
 * so a direct API call cannot bypass the UI.
 */
export function assertEmailVerified(user: SessionUser): void {
  if (!user.emailVerified) {
    throw new ApiError(
      403,
      'EMAIL_VERIFICATION_REQUIRED',
      'Verify your email address before placing a bet. Open Settings to resend the verification email.',
      { settingsPath: '/settings#email' },
    );
  }
}

/**
 * Multiple-account reviews put a temporary hold on player benefits. The reason
 * stays internal; players only see this generic message.
 */
export function assertNotOnHold(user: SessionUser): void {
  if (user.accountHold) {
    throw new ApiError(
      403,
      'ACCOUNT_UNDER_REVIEW',
      'This account is under review. Contact support to resolve the hold.',
      { supportPath: '/tickets/new' },
    );
  }
}

/** Both gates apply to a new wager. */
export function assertCanWager(user: SessionUser): void {
  assertEmailVerified(user);
  assertNotOnHold(user);
}
