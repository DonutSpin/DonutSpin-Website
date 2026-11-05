import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Coins,
  Gamepad2,
  Landmark,
  LifeBuoy,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Ticket,
  TrendingUp,
  Trophy,
  Wallet,
} from 'lucide-react';
import type { GameConfig, LedgerEntry, TicketCounts } from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { useApiQuery } from '../lib/useApi';
import { money, timeAgo } from '../lib/format';
import { PageHeader } from '../components/layout';
import { GameCard } from '../components/GameArt';
import { ChatPanel } from '../components/chat';
import { GiveawayWidget } from '../components/giveaway-widget';
import {
  Alert,
  Button,
  Card,
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

const DISCORD_INVITE_URL = 'https://discord.gg/39mY8xdRrD';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return 'Late-night session';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Shared section heading so every homepage block uses the same rhythm. */
function SectionHead({
  id,
  icon,
  eyebrow,
  title,
  description,
  action,
}: {
  id?: string;
  icon: ReactNode;
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.18em] text-gold-dim">
          {icon}
          {eyebrow}
        </p>
        <h2 id={id} className="mt-1 font-display text-[19px] font-semibold tracking-[-0.02em] text-ink sm:text-[21px]">{title}</h2>
        {description && <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function HomePage() {
  const { user } = useAuth();
  const overviewQuery = useApiQuery<Overview>('/me/overview');
  const gamesQuery = useApiQuery<{ games: GameConfig[] }>('/games');

  const overview = overviewQuery.data;
  // The shared auth balance is refreshed in the background, so cashier
  // decisions and rain payouts appear without a second dashboard request.
  const liveBalance = user?.balance ?? overview?.balance;
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
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-8 sm:space-y-10">
        {/* ------------------------------------------------------- hero + bankroll */}
        <section className="relative overflow-hidden rounded-2xl border border-line/90 premium-card">
          <div className="pointer-events-none absolute inset-0 surface-grid opacity-25" />
          <div className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-gold/10 blur-[90px]" />
          <div className="relative grid gap-5 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_284px] lg:items-center">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-gold-dim">
                <Sparkles className="h-3.5 w-3.5" /> {greeting()}, {user?.username}
              </p>
              <h1 className="mt-2.5 font-display text-[27px] font-semibold leading-[1.06] tracking-[-0.035em] text-ink sm:text-[35px]">
                The tables are open.
              </h1>
              <p className="mt-2 max-w-md text-[12.5px] leading-relaxed text-muted sm:text-[13px]">
                Six server-settled games, one DonutSMP balance. Pick a table, place your bet, and every payout lands in
                your wallet instantly.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-2.5">
                <Link to="/games">
                  <Button variant="primary" leftIcon={<Gamepad2 className="h-4 w-4" />}>
                    Play now
                  </Button>
                </Link>
                <Link to="/cashier">
                  <Button variant="secondary" leftIcon={<Landmark className="h-4 w-4" />}>
                    Cashier
                  </Button>
                </Link>
                <Link to="/wallet" className="hidden sm:block">
                  <Button variant="ghost" leftIcon={<Wallet className="h-4 w-4" />}>
                    Wallet
                  </Button>
                </Link>
              </div>
            </div>

            {/* Compact balance card: always visible, never a giant block. */}
            <Link
              to="/wallet"
              className="group relative block overflow-hidden rounded-2xl border border-gold/25 bg-gradient-to-br from-gold/[0.13] via-surface-1 to-surface-1 p-4 transition-colors hover:border-gold/40"
              title={liveBalance === undefined ? 'Your balance' : `${money(liveBalance)} money — open wallet`}
            >
              <span className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-gold/15 blur-2xl" />
              <span className="relative flex items-center justify-between gap-2">
                <span className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-gold-dim">Your balance</span>
                <Wallet className="h-3.5 w-3.5 text-gold/70" />
              </span>
              <span className="relative mt-2 flex items-baseline gap-1.5">
                <span className="font-display text-[30px] font-semibold leading-none tracking-[-0.03em] text-gold-bright tnum">
                  {liveBalance === undefined ? '—' : money(liveBalance)}
                </span>
                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-gold-dim">money</span>
              </span>
              <span className="relative mt-3 flex items-center justify-between border-t border-gold/15 pt-2.5 text-[10.5px] text-muted transition-colors group-hover:text-ink">
                Wallet &amp; ledger
                <ArrowUpRight className="h-3.5 w-3.5 text-gold transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </span>
            </Link>
          </div>
        </section>

        {/* ------------------------------------------------------------- 1. casino */}
        <section aria-labelledby="casino-heading">
          <SectionHead
            icon={<Gamepad2 className="h-3 w-3" />}
            id="casino-heading"
            eyebrow="Casino"
            title="Pick your table"
            description="Six server-settled games, one consistent experience."
            action={
              <Link to="/games" className="flex items-center gap-1 text-[12px] font-medium text-gold hover:text-gold-bright">
                Browse all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
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

        {/* -------------------------------------------------------------- 2. stats */}
        <section aria-labelledby="stats-heading">
          <SectionHead
            icon={<TrendingUp className="h-3 w-3" />}
            id="stats-heading"
            eyebrow="Stats"
            title="Your numbers"
            description="Rounds, wagers and payouts from your whole history."
          />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard
              label="Rounds"
              value={overview?.gamesPlayed ?? '—'}
              hint={overview ? `${money(overview.lifetimeWagered)} wagered` : ' '}
              icon={<Gamepad2 className="h-4 w-4" />}
              tone="info"
              className="p-4 sm:p-5"
            />
            <StatCard
              label="Payouts"
              value={overview ? money(overview.lifetimeWon) : '—'}
              hint="Lifetime returns"
              icon={<TrendingUp className="h-4 w-4" />}
              tone="success"
              className="p-4 sm:p-5"
            />
            <StatCard
              label="Wagered"
              value={overview ? money(overview.lifetimeWagered) : '—'}
              hint="All-time money"
              icon={<Coins className="h-4 w-4" />}
              tone="gold"
              className="p-4 sm:p-5"
            />
            <StatCard
              label="Tickets"
              value={overview?.tickets.open ?? '—'}
              hint={overview ? `${overview.tickets.waitingUser} waiting on you` : ' '}
              icon={<Ticket className="h-4 w-4" />}
              tone="violet"
              className="p-4 sm:p-5"
            />
          </div>
        </section>

        {/* ----------------------------------------------- 3. giveaways + community */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <section aria-labelledby="giveaways-heading">
            <SectionHead
              icon={<Trophy className="h-3 w-3" />}
              id="giveaways-heading"
              eyebrow="Giveaways"
              title="Prize board"
              action={
                <Link to="/giveaways" className="flex items-center gap-1 text-[12px] font-medium text-gold hover:text-gold-bright">
                  All giveaways <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
            <GiveawayWidget />
          </section>

          <section aria-labelledby="community-heading">
            <SectionHead icon={<MessageCircle className="h-3 w-3" />} id="community-heading" eyebrow="Community" title="Join the Discord" />
            <Card className="relative overflow-hidden border-[#5865F2]/25 p-4 sm:p-5">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#5865F2]/[0.12] via-transparent to-transparent" />
              <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-[#5865F2]/15 blur-3xl" />
              <div className="relative">
                <span className="grid h-11 w-11 place-items-center rounded-2xl border border-[#5865F2]/30 bg-[#5865F2]/15 text-[#a9b4ff]">
                  <MessageCircle className="h-5 w-5" />
                </span>
                <p className="mt-3 text-[12.5px] font-semibold text-ink">DonutSpin community hub</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                  Announcements, code drops, giveaways, invite rewards and direct support — all in one server.
                </p>
                <a
                  href={DISCORD_INVITE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-[#5865F2] px-3 text-[12px] font-semibold text-white shadow-[0_10px_30px_-14px_rgba(88,101,242,0.9)] transition-all hover:brightness-110 active:scale-[0.99]"
                >
                  Join the Discord <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
                <p className="mt-3 flex items-center gap-1.5 border-t border-line/60 pt-2.5 text-[10.5px] text-faint">
                  <Sparkles className="h-3 w-3 text-gold/60" /> New here? Say hi and grab a role.
                </p>
              </div>
            </Card>
          </section>
        </div>

        {/* ------------------------------------------------- 4. wallet + support */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <section aria-labelledby="activity-heading">
            <SectionHead
              icon={<Coins className="h-3 w-3" />}
              id="activity-heading"
              eyebrow="Wallet"
              title="Recent activity"
              action={
                <Link to="/transactions" className="flex items-center gap-1 text-[12px] font-medium text-gold hover:text-gold-bright">
                  Full ledger <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
            <Card>
              {overviewQuery.loading ? (
                <div className="space-y-3 p-4">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Skeleton key={index} className="h-10 w-full" />
                  ))}
                </div>
              ) : overview && overview.recentTransactions.length > 0 ? (
                <div className="divide-y divide-line/70">
                  {overview.recentTransactions.map((entry) => (
                    <div key={entry.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
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
          </section>

          <div className="space-y-6">
            <section aria-labelledby="support-heading">
              <SectionHead
                icon={<LifeBuoy className="h-3 w-3" />}
                id="support-heading"
                eyebrow="Support"
                title="Your tickets"
                action={
                  <Link to="/tickets" className="text-[11.5px] font-medium text-gold hover:text-gold-bright">
                    View all
                  </Link>
                }
              />
              <Card>
                {overview && overview.activeTickets.length > 0 ? (
                  <div>
                    <div className="divide-y divide-line/70">
                      {overview.activeTickets.map((ticket) => (
                        <Link
                          key={ticket.reference}
                          to={`/tickets/${ticket.reference}`}
                          className="block px-4 py-3 transition-colors hover:bg-surface-2/60"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-display text-[11px] font-medium tracking-wide text-gold">{ticket.reference}</span>
                            <StatusBadge status={ticket.status} />
                          </div>
                          <p className="mt-1 truncate text-[12.5px] text-ink">{ticket.subject}</p>
                          <p className="mt-0.5 text-[10.5px] text-faint">Updated {timeAgo(ticket.lastActivityAt)}</p>
                        </Link>
                      ))}
                    </div>
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
                    description="Need help with access, a game, or a ledger entry? Open a ticket and we will follow up."
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
            </section>

            <Card className="p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-gold/20 bg-gold/8">
                  <ShieldCheck className="h-4 w-4 text-gold" />
                </span>
                <div>
                  <p className="text-[12.5px] font-medium text-ink">DonutSMP money, in and out</p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                    Deposit through the cashier, play the tables, and withdraw whenever you like. Every outcome is
                    settled server-side and written to your ledger.
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>

      <aside className="hidden xl:block">
        <ChatPanel />
      </aside>
    </div>
  );
}
