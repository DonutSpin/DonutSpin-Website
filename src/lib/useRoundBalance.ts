import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

/**
 * Card, tile and banner reveals settle in roughly this window. The balance is
 * allowed to change only after it, so a fast background sync cannot expose the
 * financial result before the table does.
 */
export const TABLE_REVEAL_MS = 320;

interface RevealOptions {
  delay?: number;
  onRevealed?: () => void;
}

/**
 * Keeps the displayed balance frozen while a round is being revealed.
 *
 * The server always settles the round before it responds; this hook only
 * controls when the browser is allowed to *show* the settled balance. It also
 * pauses the background cashier sync for that window, so a refresh cannot leak
 * an outcome that is still animating.
 */
export function useRoundBalance() {
  const { updateBalance, setBalanceSyncPaused } = useAuth();
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  /** Freezes the balance and cancels any reveal that has not fired yet. */
  const hold = useCallback(() => {
    clear();
    setBalanceSyncPaused(true);
  }, [clear, setBalanceSyncPaused]);

  /** Publishes a settled balance once the round's visual reveal has finished. */
  const reveal = useCallback(
    (balance: number, options: RevealOptions = {}) => {
      clear();
      const finish = () => {
        timer.current = null;
        updateBalance(balance);
        setBalanceSyncPaused(false);
        options.onRevealed?.();
      };
      const delay = Math.max(0, options.delay ?? 0);
      if (delay === 0) {
        finish();
        return;
      }
      timer.current = window.setTimeout(finish, delay);
    },
    [clear, setBalanceSyncPaused, updateBalance],
  );

  /** Re-enables sync without changing the balance (errors, cancellations). */
  const release = useCallback(() => {
    clear();
    setBalanceSyncPaused(false);
  }, [clear, setBalanceSyncPaused]);

  useEffect(
    () => () => {
      clear();
      setBalanceSyncPaused(false);
    },
    [clear, setBalanceSyncPaused],
  );

  return { hold, reveal, release };
}
