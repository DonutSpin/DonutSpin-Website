import { Coins, Gamepad2, Info, Landmark, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { GameConfig } from '../../../shared/types';
import { PageHeader } from '../../components/layout';
import { GameCard } from '../../components/GameArt';
import { Alert, Button, Card, Skeleton, cn } from '../../components/ui';
import { useApiQuery } from '../../lib/useApi';
import { money } from '../../lib/format';

export function GamesPage() {
  const query = useApiQuery<{
    games: GameConfig[];
    maxPayout: number;
    startingCredits: number;
    maintenance: boolean;
  }>('/games');

  const order = ['coinflip', 'mines', 'blackjack', 'roulette', 'towers', 'plinko'];
  const games = (query.data?.games ?? []).slice().sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));

  return (
    <div>
      <PageHeader
        title="Games"
        description="Six complete games with server-settled outcomes, transparent limits, and animated results."
        actions={
          <Link to="/wallet">
            <Button variant="secondary" leftIcon={<Coins className="h-4 w-4" />}>
              Wallet
            </Button>
          </Link>
        }
      />

      {query.error && (
        <Alert tone="error" className="mb-5" title="Could not load the game catalogue">
          {query.error}
        </Alert>
      )}
      {query.data?.maintenance && (
        <Alert tone="warning" className="mb-5" title="Maintenance mode">
          Games are temporarily paused. You can still review your ledger and support tickets.
        </Alert>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: ShieldCheck,
            title: 'Server-authoritative',
            text: 'Every wager, RNG outcome, and payout is validated on the server.',
          },
          {
            icon: Info,
            title: 'DonutSMP money',
            text: 'Play with the money you already have in game. Deposits and withdrawals go through the cashier.',
          },
          {
            icon: Sparkles,
            title: 'Transparent limits',
            text: query.data
              ? `${money(query.data.startingCredits)} welcome grant · ${money(query.data.maxPayout)} max payout.`
              : 'Live per-game limits are shown on every table.',
          },
        ].map((item) => (
          <div key={item.title} className="flex gap-3 rounded-xl border border-line bg-surface-1 p-3.5">
            <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
            <div>
              <p className="text-[12px] font-medium text-ink">{item.title}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{item.text}</p>
            </div>
          </div>
        ))}
      </div>

      {query.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-[286px] rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {games.map((game) => (
            <div key={game.slug} className="animate-fade-up">
              <GameCard game={game} />
            </div>
          ))}
        </div>
      )}

      <Card className="mt-6 flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface-2">
            <Gamepad2 className="h-4 w-4 text-gold" />
          </span>
          <div>
            <p className="text-[12.5px] font-medium text-ink">New to the floor?</p>
            <p className="text-[11.5px] text-muted">Start small on Coinflip or Towers, then explore the tables.</p>
          </div>
        </div>
        <Link to="/cashier">
          <Button variant="ghost" size="sm" leftIcon={<Landmark className="h-3.5 w-3.5" />}>
            Open cashier
          </Button>
        </Link>
      </Card>
    </div>
  );
}
