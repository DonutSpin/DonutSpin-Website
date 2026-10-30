import { useEffect, useRef } from 'react';
import type { ActiveRound } from '../../shared/types';
import { fetchActiveRound } from './games';

/**
 * On mount (or when the game slug becomes available), ask the server for the
 * player's single active round. Only the matching game page restores it; other
 * pages are covered by the global ACTIVE_ROUND conflict notice.
 */
export function useRestoreActiveRound(slug: string | undefined, restore: (round: ActiveRound) => void): void {
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  useEffect(() => {
    if (!slug) return;
    let live = true;
    void fetchActiveRound()
      .then(({ round }) => {
        if (live && round && round.game === slug) restoreRef.current(round);
      })
      .catch(() => {
        /* A failed restore must never block the page. */
      });
    return () => {
      live = false;
    };
  }, [slug]);
}
