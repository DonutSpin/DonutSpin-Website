import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Gift, Timer, Trophy, Users } from 'lucide-react';
import type { GiveawayFeaturedResponse, GiveawayJoinResponse, GiveawayView } from '../../shared/types';
import { useToast } from '../context/ToastContext';
import { api, errorMessage } from '../lib/api';
import { money } from '../lib/format';
import { Badge, Button, Card, Spinner, cn } from './ui';

const POLL_MS = 4000;

function secondsLeft(giveaway: GiveawayView, now: number): number {
  if (giveaway.status !== 'active') return 0;
  return Math.max(0, Math.ceil((new Date(giveaway.endsAt).getTime() - now) / 1000));
}

export function compactClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function GiveawayWidget() {
  const { success, error: toastError } = useToast();
  const [featured, setFeatured] = useState<GiveawayFeaturedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setFeatured(await api.get<GiveawayFeaturedResponse>('/giveaways/featured'));
    } catch {
      // The homepage stays usable if a poll fails; the next tick retries.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const join = async (giveaway: GiveawayView) => {
    setBusyId(giveaway.id);
    try {
      await api.post<GiveawayJoinResponse>(`/giveaways/${encodeURIComponent(giveaway.id)}/join`);
      success('Giveaway joined', `You are entered in “${giveaway.title}”. Good luck!`);
      await load();
    } catch (error) {
      toastError('Could not join the giveaway', errorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <Card className="flex items-center justify-center gap-2 border-gold/20 p-5 text-[12px] text-faint">
        <Spinner className="h-4 w-4" /> Checking the prize board…
      </Card>
    );
  }

  const active = featured?.active ?? [];
  const giveaway = active[0];
  const upcoming = featured?.upcoming ?? null;

  if (!giveaway) {
    return (
      <Card className="relative overflow-hidden border-line/90">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-violet/[0.06] via-transparent to-transparent" />
        <div className="relative flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-violet/25 bg-violet/10 text-violet">
              <Gift className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0">
              <p className="font-display text-[14px] font-semibold text-ink">
                {upcoming ? 'A giveaway is coming up' : 'Community giveaways'}
              </p>
              <p className="mt-0.5 truncate text-[11.5px] text-muted">
                {upcoming
                  ? `${upcoming.title} · starts in ${compactClock(upcoming.secondsUntilStart)}`
                  : 'Community prize pools funded by staff and players.'}
              </p>
            </div>
          </div>
          <Link to="/giveaways">
            <Button variant="secondary" size="sm" leftIcon={<Trophy className="h-3.5 w-3.5" />}>
              {upcoming ? 'View upcoming' : 'Open giveaways'}
            </Button>
          </Link>
        </div>
      </Card>
    );
  }

  const remaining = secondsLeft(giveaway, now);
  const live = remaining > 0;

  return (
    <Card className="relative overflow-hidden border-gold/35">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-gold/[0.14] via-violet/[0.05] to-transparent" />
      <div className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-gold/20 blur-[70px]" />
      <div className="relative p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-gold/35 bg-gold/12 text-gold shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <Trophy className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gold-dim">Live giveaway</p>
                {giveaway.fundingKind === 'sponsor' && giveaway.sponsor && (
                  <Badge tone="violet" className="py-0.5 text-[9px]">
                    Sponsored by @{giveaway.sponsor.username}
                  </Badge>
                )}
              </div>
              <h2 className="mt-1 truncate font-display text-[18px] font-semibold leading-tight text-ink sm:text-[20px]">
                {giveaway.title}
              </h2>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-faint">Ends in</p>
            <p
              className={cn(
                'font-display text-[24px] font-semibold leading-none tracking-tight tnum',
                live ? 'text-gold-bright' : 'text-danger',
              )}
            >
              {compactClock(remaining)}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-gold/20 bg-gold/[0.06] px-2.5 py-2">
            <p className="text-[8.5px] font-semibold uppercase tracking-[0.12em] text-gold-dim">Prize pool</p>
            <p className="mt-1 font-display text-[17px] font-semibold leading-none text-gold-bright tnum">
              {money(giveaway.prizeAmount)}
            </p>
          </div>
          <div className="rounded-xl border border-line/80 bg-surface-1/60 px-2.5 py-2">
            <p className="flex items-center gap-1 text-[8.5px] font-semibold uppercase tracking-[0.12em] text-faint">
              <Users className="h-2.5 w-2.5" /> Players
            </p>
            <p className="mt-1 font-display text-[17px] font-semibold leading-none text-ink tnum">
              {giveaway.participantCount}
            </p>
          </div>
          <div className="rounded-xl border border-line/80 bg-surface-1/60 px-2.5 py-2">
            <p className="flex items-center gap-1 text-[8.5px] font-semibold uppercase tracking-[0.12em] text-faint">
              <Trophy className="h-2.5 w-2.5" /> Winners
            </p>
            <p className="mt-1 font-display text-[17px] font-semibold leading-none text-ink tnum">
              {giveaway.winnerCount}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <Link
            to="/giveaways"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted transition-colors hover:text-gold"
          >
            All giveaways {active.length > 1 ? `· ${active.length} live` : ''} <ArrowRight className="h-3 w-3" />
          </Link>
          <div className="flex items-center gap-2">
            {giveaway.isFunder ? (
              <Badge tone="gold">You funded this</Badge>
            ) : giveaway.joined ? (
              <Badge tone="success" dot>
                You are entered
              </Badge>
            ) : live ? (
              <Button
                variant="primary"
                size="sm"
                loading={busyId === giveaway.id}
                onClick={() => void join(giveaway)}
                leftIcon={<Timer className="h-3.5 w-3.5" />}
                className="shadow-[0_12px_30px_-14px_rgba(230,194,122,0.9)]"
              >
                Join giveaway
              </Button>
            ) : (
              <Badge tone="neutral">Drawing winners…</Badge>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
