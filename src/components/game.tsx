import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, Info, LifeBuoy, Mail, Minus, Plus, ShieldCheck, Sparkles, Wallet } from 'lucide-react';
import type { Card as CardData, GameConfig } from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { money } from '../lib/format';
import { compactAmount, parseAmount } from '../lib/amount';
import { api, errorMessage } from '../lib/api';
import { useApiQuery } from '../lib/useApi';
import { PageHeader, Breadcrumbs } from './layout';
import { Alert, Badge, Button, Card, Input, Modal, Skeleton, cn } from './ui';
import { GameArtwork } from './GameArt';

export function useGameConfig(slug: string) {
  const query = useApiQuery<{ games: GameConfig[]; maintenance: boolean; maxPayout: number }>('/games');
  const game = query.data?.games.find((entry) => entry.slug === slug) ?? null;
  return { ...query, game, maintenance: query.data?.maintenance ?? false, maxPayout: query.data?.maxPayout ?? 0 };
}

export function GameLayout({
  game,
  rules,
  board,
  aside,
  maintenance = false,
  maxPayout,
}: {
  game: GameConfig;
  rules: ReactNode;
  board: ReactNode;
  aside: ReactNode;
  maintenance?: boolean;
  maxPayout?: number;
}) {
  const [rulesOpen, setRulesOpen] = useState(false);
  const { user } = useAuth();
  const bettingBlocked = Boolean(user && (!user.emailVerified || user.accountHold));
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Games', to: '/games' }, { label: game.name }]}
        title={game.name}
        description={game.description}
        badge={game.enabled ? <Badge tone="success" dot>Live</Badge> : <Badge tone="warning" dot>Offline</Badge>}
        actions={
          <>
            <Button variant="ghost" onClick={() => setRulesOpen(true)} leftIcon={<BookOpen className="h-4 w-4" />}>
              Rules
            </Button>
            <Link to="/games">
              <Button variant="secondary" leftIcon={<ArrowLeft className="h-4 w-4" />}>
                All games
              </Button>
            </Link>
          </>
        }
      />
      {(!game.enabled || maintenance) && (
        <Alert tone="warning" className="mb-5" title={maintenance ? 'Platform maintenance' : 'Game unavailable'}>
          {maintenance
            ? 'All games are paused while the platform is in maintenance mode.'
            : 'This game has been disabled by an administrator. Your balance is safe.'}
        </Alert>
      )}
      {bettingBlocked ? (
        <Card className="mx-auto max-w-2xl p-6 text-center">
          <span className={`mx-auto grid h-12 w-12 place-items-center rounded-2xl border ${user?.accountHold ? 'border-warning/30 bg-warning/10 text-warning' : 'border-gold/30 bg-gold/10 text-gold'}`}>
            {user?.accountHold ? <ShieldCheck className="h-6 w-6" /> : <Mail className="h-6 w-6" />}
          </span>
          <h2 className="mt-4 font-display text-xl font-semibold text-ink">
            {user?.accountHold ? 'Your account is under review' : 'Verify your email to play'}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-[12.5px] leading-relaxed text-muted">
            {user?.accountHold
              ? 'Betting, bonuses, and cashier requests are paused while support reviews this account. Open a support ticket if you need help.'
              : 'A verified email is required before your first wager. We sent you a verification link; you can request a new one from Settings.'}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link to={user?.accountHold ? '/tickets/new' : '/settings#email'}>
              <Button variant="primary" leftIcon={user?.accountHold ? <LifeBuoy className="h-4 w-4" /> : <Mail className="h-4 w-4" />}>
                {user?.accountHold ? 'Contact support' : 'Open email settings'}
              </Button>
            </Link>
            <Link to="/games">
              <Button variant="secondary">Browse games</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_358px]">
          <div className="min-w-0">{board}</div>
          <aside className="space-y-4">{aside}</aside>
        </div>
      )}
      <Modal
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
        title={`${game.name} — rules & payouts`}
        description="Everything is settled in DonutSMP money by the server."
        size="lg"
        footer={
          <Button variant="primary" onClick={() => setRulesOpen(false)}>
            Back to the table
          </Button>
        }
      >
        <div className="space-y-4 text-[13px] leading-relaxed text-muted">
          {rules}
          <div className="rounded-xl border border-line bg-surface-2 p-3.5 text-[12px]">
            <p className="flex items-center gap-2 font-medium text-ink">
              <ShieldCheck className="h-4 w-4 text-gold" /> Server-authoritative play
            </p>
            <p className="mt-1.5">
              Wagers, random outcomes and payouts are generated and validated on the server with a cryptographically
              secure random number generator. Animations only reveal the settled result.
            </p>
            <p className="mt-1.5">Limits: {money(game.minBet)}–{money(game.maxBet)} money per round. Maximum payout cap: {money(maxPayout ?? 0)} money.</p>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function GameSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-10 w-56" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_358px]">
        <Skeleton className="h-[420px] rounded-2xl" />
        <Skeleton className="h-[420px] rounded-2xl" />
      </div>
    </div>
  );
}

export function GameError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <Alert tone="error" title="Could not load this table">
        {message}
      </Alert>
      <Button className="mt-4" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

export function BoardCard({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: ReactNode;
}) {
  return (
    <Card className={cn('relative overflow-hidden', className)}>
      <div className="absolute inset-0 surface-grid opacity-20" />
      <div className="relative flex min-h-[420px] flex-col p-4 sm:p-6">
        {label && <div className="mb-4 flex items-center justify-between">{label}</div>}
        <div className="flex flex-1 flex-col justify-center">{children}</div>
      </div>
    </Card>
  );
}

export function SidePanel({ children, title = 'Place your bet' }: { children: ReactNode; title?: string }) {
  return (
    <Card>
      <div className="border-b border-line px-4 py-3.5">
        <h3 className="font-display text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">{title}</h3>
      </div>
      <div className="space-y-4 p-4">{children}</div>
    </Card>
  );
}

export function BalanceRow() {
  const { user } = useAuth();
  return (
    <div className="flex items-center justify-between rounded-xl border border-gold/15 bg-gold/5 px-3.5 py-2.5">
      <span className="flex items-center gap-2 text-[11.5px] font-medium uppercase tracking-wider text-gold-dim">
        <Wallet className="h-3.5 w-3.5" /> Balance
      </span>
      <span className="font-display text-[15px] font-semibold text-gold-bright tnum">
        {money(user?.balance ?? 0)} <span className="text-[9px] uppercase tracking-wider text-gold-dim">money</span>
      </span>
    </div>
  );
}

export function WagerField({
  value,
  onChange,
  min,
  max,
  balance,
  disabled,
  label = 'Wager',
  maxAllowed,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  balance: number;
  disabled?: boolean;
  label?: string;
  maxAllowed?: number;
}) {
  const [text, setText] = useState(compactAmount(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(compactAmount(value));
  }, [value, focused]);

  const commit = (raw: string) => {
    const parsed = parseAmount(raw);
    if (parsed !== null) onChange(Math.max(0, parsed));
  };

  const ceiling = Math.min(max, maxAllowed ?? max, Math.max(balance, min));
  const quick = [
    { label: 'Min', value: min },
    { label: '½', value: Math.max(min, Math.floor(value / 2)) },
    { label: '2×', value: Math.min(ceiling, value * 2) },
    { label: 'Max', value: ceiling },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label htmlFor="wager" className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted">
          {label}
        </label>
        <span className="text-[10.5px] text-faint tnum">
          {money(min)}–{money(max)} money
        </span>
      </div>
      <div className="relative">
        <Input
          id="wager"
          type="text"
          inputMode="text"
          autoComplete="off"
          placeholder="e.g. 100k"
          value={text}
          disabled={disabled}
          onFocus={(event) => {
            setFocused(true);
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setText(event.target.value);
            commit(event.target.value);
          }}
          onBlur={() => {
            setFocused(false);
            const parsed = parseAmount(text);
            const clamped = Math.min(Math.max(parsed ?? value ?? min, min), Math.min(max, Math.max(balance, min)));
            onChange(clamped);
            setText(compactAmount(clamped));
          }}
          className="pr-16 text-[15px] font-semibold tnum"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[9.5px] font-medium uppercase tracking-wider text-faint">
          money
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {quick.map((item) => (
          <button
            key={item.label}
            type="button"
            disabled={disabled}
            onClick={() => onChange(item.value)}
            className="rounded-md border border-line bg-surface-2 py-1 text-[10.5px] font-medium text-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-40"
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between text-[10.5px] text-faint">
        <span>Available {money(balance)}</span>
        {value > balance && <span className="text-danger">Exceeds balance</span>}
      </div>
    </div>
  );
}

export function ResultBanner({
  tone,
  title,
  detail,
  extra,
}: {
  tone: 'win' | 'lose' | 'neutral';
  title: string;
  detail?: string;
  extra?: ReactNode;
}) {
  const styles =
    tone === 'win'
      ? 'border-success/30 bg-success/8 text-success'
      : tone === 'lose'
        ? 'border-danger/30 bg-danger/8 text-danger'
        : 'border-line-strong bg-surface-2 text-muted';
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-3 animate-fade-up', styles)}>
      <div className="flex items-center gap-2">
        {tone === 'win' ? <Sparkles className="h-4 w-4" /> : <Info className="h-4 w-4" />}
        <div>
          <p className="text-[12.5px] font-semibold text-ink">{title}</p>
          {detail && <p className="text-[11px] opacity-90">{detail}</p>}
        </div>
      </div>
      {extra}
    </div>
  );
}

export function PlayingCard({ card, index = 0, hidden = false }: { card: CardData; index?: number; hidden?: boolean }) {
  if (hidden || card.hidden) {
    return (
      <div className="playing-card back animate-deal" style={{ animationDelay: `${index * 90}ms` }}>
        <span className="font-display text-[10px] tracking-[0.2em] text-gold/70">DONUTSPIN</span>
        <span className="self-center font-display text-2xl text-gold/40">A</span>
        <span className="self-end text-[8px] tracking-[0.2em] text-gold/40">DONUTSMP</span>
      </div>
    );
  }
  const red = card.suit === '♥' || card.suit === '♦';
  return (
    <div className="playing-card animate-deal" style={{ animationDelay: `${index * 90}ms` }}>
      <div className={cn('flex flex-col leading-none', red ? 'text-[#b3262d]' : 'text-[#1a1d24]')}>
        <span className="font-display text-[17px] font-bold">{card.rank}</span>
        <span className="text-[15px]">{card.suit}</span>
      </div>
      <div className={cn('self-center font-display text-[26px]', red ? 'text-[#b3262d]' : 'text-[#1a1d24]/85')}>
        {card.suit}
      </div>
      <div className={cn('flex rotate-180 flex-col self-end leading-none', red ? 'text-[#b3262d]' : 'text-[#1a1d24]')}>
        <span className="font-display text-[17px] font-bold">{card.rank}</span>
        <span className="text-[15px]">{card.suit}</span>
      </div>
    </div>
  );
}

export function ChipButton({
  value,
  active,
  onClick,
  disabled,
}: {
  value: number;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold tnum transition-colors disabled:opacity-40',
        active
          ? 'border-gold/50 bg-gold/15 text-gold'
          : 'border-line bg-surface-2 text-muted hover:border-line-strong hover:text-ink',
      )}
    >
      <Plus className="h-3 w-3" /> {compactAmount(value)}
    </button>
  );
}

export function Stepper({
  value,
  onChange,
  min,
  max,
  disabled,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted">{label}</span>
      <div className="flex items-center gap-1 rounded-lg border border-line bg-surface-2 p-1">
        <button
          type="button"
          disabled={disabled || value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          className="grid h-6 w-6 place-items-center rounded-md text-faint hover:bg-surface-3 hover:text-ink disabled:opacity-30"
          aria-label="Decrease"
        >
          <Minus className="h-3 w-3" />
        </button>
        <span className="w-8 text-center font-display text-[13px] font-semibold tnum text-ink">{value}</span>
        <button
          type="button"
          disabled={disabled || value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          className="grid h-6 w-6 place-items-center rounded-md text-faint hover:bg-surface-3 hover:ink disabled:opacity-30"
          aria-label="Increase"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

export function GameArtHeader({ slug }: { slug: string }) {
  return (
    <div className="w-40">
      <GameArtwork slug={slug} compact />
    </div>
  );
}

export function useActionError() {
  const [error, setError] = useState<string | null>(null);
  return {
    error,
    clear: () => setError(null),
    show: (err: unknown) => setError(errorMessage(err)),
  };
}

export async function refreshBalance(): Promise<number | null> {
  try {
    const [wallet] = await Promise.all([api.get<{ balance: number }>('/me/wallet')]);
    return wallet.balance;
  } catch {
    return null;
  }
}
