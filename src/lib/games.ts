import type {
  ActiveRound,
  BlackjackView,
  CoinflipView,
  MinesView,
  PlinkoView,
  RouletteView,
  TowersView,
} from '../../shared/types';
import { api, ApiRequestError } from './api';

export const playGame = async <T,>(slug: string, body: Record<string, unknown>): Promise<T> => {
  try {
    return await api.post<T>(`/games/${slug}/play`, body);
  } catch (error) {
    if (error instanceof ApiRequestError && error.code === 'ACTIVE_ROUND') {
      window.dispatchEvent(
        new CustomEvent('donutcash:active-round', { detail: error.details?.activeRound ?? null }),
      );
    }
    throw error;
  }
};

export const gameAction = <T,>(sessionId: string, body: Record<string, unknown>) =>
  api.post<T>(`/games/sessions/${sessionId}/action`, body);

export const fetchActiveRound = () => api.get<{ round: ActiveRound | null }>('/games/active');

export const acknowledgeRound = (sessionId: string) =>
  api.post<{ ok: boolean }>(`/games/sessions/${sessionId}/acknowledge`, {});

export type { ActiveRound, BlackjackView, CoinflipView, MinesView, PlinkoView, RouletteView, TowersView };

export const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export function payoutLabel(multiplier: number): string {
  return `${Math.round(multiplier * 100)}% of wager`;
}

export function gameAccent(slug: string): { icon: string; gradient: string } {
  switch (slug) {
    case 'coinflip':
      return { icon: 'coin', gradient: 'from-amber-500/15 via-transparent to-transparent' };
    case 'mines':
      return { icon: 'mines', gradient: 'from-emerald-500/12 via-transparent to-transparent' };
    case 'blackjack':
      return { icon: 'blackjack', gradient: 'from-sky-500/12 via-transparent to-transparent' };
    case 'roulette':
      return { icon: 'roulette', gradient: 'from-rose-500/12 via-transparent to-transparent' };
    case 'towers':
      return { icon: 'towers', gradient: 'from-violet-500/12 via-transparent to-transparent' };
    case 'plinko':
      return { icon: 'plinko', gradient: 'from-teal-500/12 via-transparent to-transparent' };
    default:
      return { icon: 'coin', gradient: 'from-gold/10 via-transparent to-transparent' };
  }
}
