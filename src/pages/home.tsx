import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Coins,
  Gamepad2,
  Landmark,
  LifeBuoy,
  ShieldCheck,
  Sparkles,
  Ticket,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { GameConfig, LedgerEntry, TicketCounts } from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { useApiQuery } from '../lib/useApi';
import { money, signedCredits, timeAgo } from '../lib/format';
import { PageHeader } from '../components/layout';
import { GameCard } from '../components/GameArt';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Money,
  Skeleton,
  StatCard,
  StatusBadge,
  cn,
} from '../components/ui';

interface Overview {
  balance: number;
  gamesPlayed: number;
  lifetimeWagered: number;
  lifetimeWon: number;
  tickets: TicketCounts;
  activeTickets: { reference: string; subject: string; status: TicketCounts extends never ? never : import('../../shared/types').TicketStatus; priority: import('../../shared/types').TicketPriority; lastActivityAt: string }[];
  unreadNotifications: number;
  recentTransactions: LedgerEntry[];
  recentGames: {
    id: string;
    game: string;
    gameLabel: string;
    bet: number;
    status: string;
    payout: number;
    createdAt: string;
  }[];
  startingCredits: number;
  maxPayout: number;
  platformName: string;
}

const gameOrder = ['coinflip', 'mines', 'blackjack', 'roulette', 'towers', 'plinko'];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return 'Late-night session';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function HomePage() {
  const { user } = useAuth();
  const overviewQuery = useApiQuery<Overview>('/me/overview');
  const gamesQuery = useApiQuery<{ games: GameConfig[] }>('/games');

  const overview = overviewQuery.data;
  const games = (gamesQuery.data?.games ?? [])
    .slice()
    .sort((a, b) => gameOrder.indexOf(a.slug) - gameOrder.indexOf(b.slug));

  if (overviewQuery.error) {
    return (
      <>
        <PageHeader title="Home" description="Your DonutSMP casino dashboard." />
        <Alert tone="error" title="Could not load your dashboard">
          {overviewQuery.error}
        </Alert>
        <Button className="mt-4" onClick={overviewQuery.refetch}>
          Retry
        </Button>
      </>
    );
  }

  return (
    <div className="space-y-7">
      <div className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-surface-2 via-surface-1 to-surface-1">
        <div className="absolute inset-0 surface-grid opacity-30" />
        <div className="absolute -right-24 -top-32 h-80 w-80 rounded-full bg-gold/10 blur-[100px]" />
        <div className="absolute inset-y-0 right-0 hidden w-[42%] lg:block">
          <div className="relative h-full">
            <div className="absolute right-16 top-1/2 h-40 w-28 -translate-y-1/2 rotate-[-16deg] rounded-xl border border-gold/25 bg-gradient-to-br from-[#232a3a] to-[#121722] shadow-2xl">
              <div className="absolute inset-3 rounded-lg border border-gold/15" />
              <span className="absolute inset-0 grid place-items-center font-display text-3xl text-gold/40">A</span>
            </div>
            <div className="absolute right-28 top-1/2 h-44 w-32 -translate-y-1/2 rotate-[4deg] rounded-xl border border-line-strong bg-gradient-to-br from-[#f5f1e5] to-[#d9d0bc] shadow-2xl">
              <span className="absolute left-3 top-3 font-display text-lg font-bold text-[#b3262d]">A</span>
              <span className="absolute left-3 top-9 text-lg text-[#b3262d]">♥</span>
              <span className="absolute inset-0 grid place-items-center text-4xl text-[#1a1d24]/20">♠</span>
            </div>
            <div className="absolute right-4 top-1/2 h-36 w-36 -translate-y-1/2 rotate-[24deg] rounded-full border-[6px] border-gold/60 bg-gradient-to-br from-[#f4dda6] to-[#a8813f] shadow-2xl">
              <div className="absolute inset-3 rounded-full border-2 border-dashed border-[#6b4f20]/50" />
              <span className="absolute inset-0 grid place-items-center font-display text-xl font-bold tracking-wider text-[#5b431b]">
                DONUTCASH
              </span>
            </div>
          </div>
        </div>
        <div className="relative max-w-xl p-6 sm:p-8">
          <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-gold-dim">
            <Sparkles className="h-3.5 w-3.5" /> {greeting()}, {user?.username}
          </p>
          <h1 className="mt-2 font-display text-[30px] font-semibold leading-tight tracking-tight text-ink sm:text-[36px]">
            Your DonutSMP bankroll
          </h1>
          <div className="mt-3 flex items-end gap-2">
            <span className="font-display text-[44px] font-semibold leading-none tracking-tight text-gold-bright tnum">
              {overview ? money(overview.balance) : '—'}
            </span>
            <span className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-gold-dim">money</span>
          </div>
          <p className="mt-2 max-w-md text-[12px] leading-relaxed text-muted">
            Your DonutSMP money, ready for the tables. Every deposit, withdrawal, wager, and payout is recorded in
            your transaction ledger.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <Link to="/games">
              <Button variant="primary" leftIcon={<Gamepad2 className="h-4 w-4" />}>
                Enter the games
              </Button>
            </Link>
            <Link to="/wallet">
              <Button variant="secondary" leftIcon={<Wallet className="h-4 w-4" />}>
                Wallet & ledger
              </Button>
            </Link>
            <Link to="/cashier">
              <Button variant="ghost" leftIcon={<Landmark className="h-4 w-4" />}>
                Cashier
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Balance"
          value={overview ? `${money(overview.balance)}` : '—'}
          hint="Available DonutSMP money"
          icon={<Coins className="h-4 w-4" />}
          tone="gold"
        />
        <StatCard
          label="Rounds played"
          value={overview?.gamesPlayed ?? '—'}
          hint={overview ? `${money(overview.lifetimeWagered)} money wagered` : ' '}
          icon={<Gamepad2 className="h-4 w-4" />}
          tone="info"
        />
        <StatCard
          label="Game payouts"
          value={overview ? money(overview.lifetimeWon) : '—'}
          hint="Lifetime DonutSMP money returns"
          icon={<TrendingUp className="h-4 w-4" />}
          tone="success"
        />
        <StatCard
          label="Open tickets"
          value={overview?.tickets.open ?? '—'}
          hint={overview ? `${overview.tickets.waitingUser} waiting on you` : ' '}
          icon={<Ticket className="h-4 w-4" />}
          tone="violet"
        />
      </div>

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold text-ink">Tables & wheels</h2>
            <p className="mt-0.5 text-[12.5px] text-muted">Six server-settled games, one consistent experience.</p>
          </div>
          <Link to="/games" className="flex items-center gap-1 text-[12px] font-medium text-gold hover:text-gold-bright">
            Browse all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {gamesQuery.loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-[280px] rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {games.map((game) => (
              <GameCard key={game.slug} game={game} />
            ))}
          </div>
        )}
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Recent wallet activity"
            description="Every money movement, in order."
            action={
              <Link to="/transactions" className="flex items-center gap-1 text-[11.5px] font-medium text-gold hover:text-gold-bright">
                Full ledger <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          {overviewQuery.loading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : overview && overview.recentTransactions.length > 0 ? (
            <div className="divide-y divide-line/70">
              {overview.recentTransactions.map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 px-5 py-3">
                  <span
                    className={cn(
                      'grid h-8 w-8 shrink-0 place-items-center rounded-lg border',
                      entry.amount > 0 ? 'border-success/20 bg-success/8 text-success' : 'border-line bg-surface-2 text-muted',
                    )}
                  >
                    <Coins className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium capitalize text-ink">
                      {entry.type.replaceAll('_', ' ')}
                    </p>
                    <p className="truncate text-[11px] text-faint">
                      {entry.reason || entry.refType || 'Ledger entry'} · {timeAgo(entry.createdAt)}
                    </p>
                  </div>
                  <Money amount={entry.amount} signed size="sm" />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Coins className="h-5 w-5" />}
              title="No transactions yet"
              description="Your welcome grant will appear here once your account is active, followed by every wager and payout."
              action={
                <Link to="/games">
                  <Button variant="primary" size="sm">
                    Play your first round
                  </Button>
                </Link>
              }
            />
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Your support tickets"
              description="Reference-tracked, with a full history."
              action={
                <Link to="/tickets" className="text-[11.5px] font-medium text-gold hover:text-gold-bright">
                  View all
                </Link>
              }
            />
            {overview && overview.activeTickets.length > 0 ? (
              <div className="divide-y divide-line/70">
                {overview.activeTickets.map((ticket) => (
                  <Link
                    key={ticket.reference}
                    to={`/tickets/${ticket.reference}`}
                    className="block px-5 py-3 transition-colors hover:bg-surface-2/60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-[11px] font-medium tracking-wide text-gold">{ticket.reference}</span>
                      <StatusBadge status={ticket.status} />
                    </div>
                    <p className="mt-1 truncate text-[12.5px] text-ink">{ticket.subject}</p>
                    <p className="mt-0.5 text-[10.5px] text-faint">Updated {timeAgo(ticket.lastActivityAt)}</p>
                  </Link>
                ))}
                <div className="p-3">
                  <Link to="/tickets/new">
                    <Button variant="secondary" size="sm" className="w-full">
                      Open a new ticket
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<LifeBuoy className="h-5 w-5" />}
                title="No open tickets"
                description="Need help with access, a game, or a wallet-ledger entry? Open a ticket and we will follow up. Money requests belong in the Cashier."
                action={
                  <Link to="/tickets/new">
                    <Button variant="secondary" size="sm">
                      Contact support
                    </Button>
                  </Link>
                }
              />
            )}
          </Card>

          <Card className="p-4">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-gold/20 bg-gold/8">
                <ShieldCheck className="h-4 w-4 text-gold" />
              </span>
              <div>
                <p className="text-[12.5px] font-medium text-ink">DonutSMP money, in and out</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                  Deposit through the cashier, play the tables, and withdraw whenever you like. Every game outcome is
                  settled server-side and every balance change is written to your ledger.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
