import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Flame,
  Gift,
  Mail,
  PartyPopper,
  Sparkles,
  Trophy,
} from 'lucide-react';
import type { RewardCalendarDay, RewardClaimResult, RewardsSummary } from '../../shared/types';
import { useApiQuery } from '../lib/useApi';
import { api, errorMessage } from '../lib/api';
import { money } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/layout';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Progress,
  Skeleton,
  Toggle,
  cn,
} from '../components/ui';

function useCountdown(target: string | null): { label: string; remaining: number } {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = target ? Math.max(0, new Date(target).getTime() - now) : 0;
  if (!target) return { label: '—', remaining: 0 };
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    label: days > 0 ? `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`,
    remaining,
  };
}

function CalendarCell({ day }: { day: RewardCalendarDay }) {
  return (
    <div
      className={cn(
        'reward-calendar-day',
        day.claimed && 'is-claimed',
        day.isToday && 'is-today',
        day.isPast && !day.claimed && 'is-missed',
      )}
      title={day.claimed ? `${money(day.reward ?? 0)} claimed on ${day.label}` : day.isToday ? 'Today' : day.label}
    >
      <span className="text-[8px] font-bold uppercase tracking-[0.12em] opacity-70">{day.weekday}</span>
      <span className="font-display text-[12px] font-semibold leading-none tnum">{Number(day.day.slice(-2))}</span>
      {day.claimed ? (
        <Check className="h-3 w-3" strokeWidth={3} />
      ) : day.isToday ? (
        <span className="h-1.5 w-1.5 rounded-full bg-gold shadow-[0_0_6px_rgba(230,194,122,0.9)]" />
      ) : (
        <span className="text-[8px] opacity-40">—</span>
      )}
    </div>
  );
}

function Confetti() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {Array.from({ length: 30 }).map((_, index) => (
        <span
          key={index}
          className="absolute top-1/3 h-2 w-2 rounded-[2px]"
          style={{
            left: `${4 + ((index * 33) % 92)}%`,
            backgroundColor: ['#e6c27a', '#4dd6a0', '#f8e5b8', '#7cb8ff', '#b79cff'][index % 5],
            animation: `confetti-fall ${1.1 + (index % 6) * 0.18}s ease-in ${(index % 9) * 55}ms both`,
          }}
        />
      ))}
    </div>
  );
}

export function RewardsPage() {
  const query = useApiQuery<RewardsSummary>('/rewards');
  const { user, updateBalance, setUser } = useAuth();
  const { success, error: toastError } = useToast();
  const [summary, setSummary] = useState<RewardsSummary | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState<RewardClaimResult['claim'] | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const celebrationTimer = useRef<number | null>(null);
  const countdown = useCountdown(summary?.nextResetAt ?? null);

  useEffect(() => {
    if (query.data) setSummary(query.data);
  }, [query.data]);

  useEffect(() => {
    return () => {
      if (celebrationTimer.current) window.clearTimeout(celebrationTimer.current);
    };
  }, []);

  useEffect(() => {
    if (summary && countdown.remaining === 0 && !summary.claimedToday) {
      query.refetch();
    }
    // The countdown ticks every second; refetching only at zero avoids loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown.remaining, summary?.claimedToday]);

  const currentStreak = summary?.streak ?? 0;
  const claimDay = summary?.todayClaim?.streakDay ?? currentStreak;
  const sortedMilestones = useMemo(
    () => (summary?.milestones ?? []).slice().sort((a, b) => a.day - b.day),
    [summary?.milestones],
  );
  const nextMilestone = sortedMilestones.find((milestone) => milestone.day > currentStreak);
  const progressMax = summary?.maxStreakDays ?? 365;
  const nextReward = summary?.nextReward;

  const claim = async () => {
    if (claiming || summary?.claimedToday) return;
    setClaiming(true);
    setClaimError(null);
    try {
      const result = await api.post<RewardClaimResult>('/rewards/claim');
      setSummary(result);
      updateBalance(result.balance);
      setCelebrate(result.claim);
      success(
        `Day ${result.claim.streakDay} reward claimed`,
        `${money(result.claim.amount)} money added to your wallet.`,
      );
      if (celebrationTimer.current) window.clearTimeout(celebrationTimer.current);
      celebrationTimer.current = window.setTimeout(() => setCelebrate(null), 2600);
      query.refetch();
    } catch (err) {
      setClaimError(errorMessage(err));
      toastError('Could not claim your reward', errorMessage(err));
    } finally {
      setClaiming(false);
    }
  };

  const toggleEmail = async (value: boolean) => {
    if (!summary || emailBusy) return;
    setEmailBusy(true);
    const previous = summary.emailNotifications;
    setSummary({ ...summary, emailNotifications: value });
    if (user) setUser({ ...user, emailNotifications: value });
    try {
      await api.patch('/me', { emailNotifications: value });
      success(value ? 'Reward emails enabled' : 'Reward emails paused', value ? 'We will email you when a reward is waiting.' : 'You can still claim rewards in the app.');
    } catch (err) {
      setSummary({ ...summary, emailNotifications: previous });
      if (user) setUser({ ...user, emailNotifications: previous });
      toastError('Could not update email preferences', errorMessage(err));
    } finally {
      setEmailBusy(false);
    }
  };

  if (query.loading && !summary) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-72 rounded-2xl" />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (query.error && !summary) {
    return (
      <>
        <PageHeader title="Rewards" description="Daily drops and streak bonuses." />
        <Alert tone="error" title="Could not load your rewards">
          {query.error}
        </Alert>
        <Button className="mt-4" onClick={query.refetch}>
          Try again
        </Button>
      </>
    );
  }

  if (!summary) return null;

  const claimedToday = summary.claimedToday;
  const claimedAmount = summary.todayClaim?.amount ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rewards"
        description="Show up, claim your daily drop, and let your streak build something bigger."
        badge={
          summary.enabled ? (
            <Badge tone="success" dot>
              Live
            </Badge>
          ) : (
            <Badge tone="warning" dot>
              Paused
            </Badge>
          )
        }
        actions={
          <Link to="/wallet">
            <Button variant="secondary" leftIcon={<Gift className="h-4 w-4" />}>
              View wallet
            </Button>
          </Link>
        }
      />

      {!summary.enabled ? (
        <Card className="overflow-hidden">
          <EmptyState
            icon={<Gift className="h-6 w-6" />}
            title="Daily rewards are taking a break"
            description="The team has paused the rewards programme. Your existing streak and claim history are safe. Check back soon."
            action={
              <Link to="/games">
                <Button variant="primary">Play a round</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <Card className="relative overflow-hidden border-gold/20">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(800px_420px_at_80%_-10%,rgba(230,194,122,0.16),transparent_64%)]" />
            <div className="absolute inset-0 surface-grid opacity-20" />
            {celebrate && <Confetti />}
            <div className="relative grid gap-7 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.08] px-3 py-1 text-[9.5px] font-bold uppercase tracking-[0.14em] text-gold">
                    <Sparkles className="h-3 w-3" /> Daily drop
                  </span>
                  <span className="text-[10.5px] text-faint">
                    Resets at {String(summary.resetHour).padStart(2, '0')}:00 · {summary.timezone}
                  </span>
                </div>
                <h2 className="mt-4 max-w-xl font-display text-[27px] font-semibold leading-[1.12] tracking-[-0.03em] text-ink sm:text-[34px]">
                  {claimedToday ? 'Today’s drop is in the bank.' : 'Your next drop is ready.'}
                </h2>
                <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-muted">
                  {claimedToday
                    ? `You claimed ${money(claimedAmount)} money for day ${claimDay}. Come back after the reset to keep the streak alive.`
                    : `Claim now for day ${nextReward?.streakDay ?? 1}. Keep the streak going to unlock a bigger daily reward${nextMilestone ? ` and the day ${nextMilestone.day} milestone` : ''}.`}
                </p>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 rounded-xl border border-line/80 bg-surface-2/60 px-3 py-2.5">
                    <span className="grid h-8 w-8 place-items-center rounded-lg border border-warning/25 bg-warning/10 text-warning">
                      <Flame className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="font-display text-[18px] font-semibold leading-none text-ink tnum">{currentStreak}</p>
                      <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-faint">day streak</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-line/80 bg-surface-2/60 px-3 py-2.5">
                    <span className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface-3 text-gold">
                      <Clock3 className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="font-display text-[18px] font-semibold leading-none text-ink tnum">
                        {claimedToday ? countdown.label : 'Ready'}
                      </p>
                      <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-faint">
                        {claimedToday ? 'next reset' : 'claim window'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-line/80 bg-surface-2/60 px-3 py-2.5">
                    <span className="grid h-8 w-8 place-items-center rounded-lg border border-success/25 bg-success/10 text-success">
                      <Trophy className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="font-display text-[18px] font-semibold leading-none text-ink tnum">{summary.streak}</p>
                      <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-faint">best streak</p>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Button
                    variant="primary"
                    size="lg"
                    className="min-w-44"
                    loading={claiming}
                    onClick={() => void claim()}
                    disabled={claimedToday}
                    leftIcon={claimedToday ? <Check className="h-4 w-4" /> : <Gift className="h-4 w-4" />}
                  >
                    {claimedToday ? 'Claimed today' : `Claim ${money(nextReward?.total ?? 0)}`}
                  </Button>
                  {claimedToday && (
                    <div className="rounded-xl border border-line/80 bg-surface-2/60 px-3.5 py-2.5 text-[11px] text-muted">
                      Next drop in <span className="font-semibold text-ink tnum">{countdown.label}</span>
                    </div>
                  )}
                  {!claimedToday && nextReward && nextReward.milestoneAmount > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.07] px-3 py-2 text-[10.5px] font-semibold text-gold-bright">
                      <PartyPopper className="h-3.5 w-3.5" /> Includes {money(nextReward.milestoneAmount)} milestone bonus
                    </span>
                  )}
                </div>
                {claimError && (
                  <div className="mt-4">
                    <Alert tone="error">{claimError}</Alert>
                  </div>
                )}
              </div>

              <div className="relative mx-auto w-full max-w-[270px]">
                <div className="relative flex aspect-square flex-col items-center justify-center rounded-[30px] border border-gold/25 bg-gradient-to-b from-gold/[0.13] via-surface-2 to-surface-1 p-6 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_30px_60px_-40px_rgba(230,194,122,0.55)]">
                  <div className="absolute inset-4 rounded-[24px] border border-white/[0.04]" />
                  <span className={cn('grid h-16 w-16 place-items-center rounded-full border border-gold/30 bg-gradient-to-br from-gold/25 to-gold/[0.04] text-gold-bright', !claimedToday && 'animate-reward')}>
                    <Gift className={cn('h-8 w-8', celebrate && 'animate-bounce')} />
                  </span>
                  <p className="mt-4 text-[9.5px] font-bold uppercase tracking-[0.16em] text-gold-dim">
                    {claimedToday ? 'Claimed today' : 'Ready to claim'}
                  </p>
                  <p className="mt-1 font-display text-[34px] font-semibold leading-none tracking-[-0.03em] text-gold-bright tnum">
                    {money(claimedToday ? claimedAmount : nextReward?.total ?? 0)}
                  </p>
                  <p className="mt-1 text-[9px] font-medium uppercase tracking-[0.16em] text-faint">money</p>
                  <div className="mt-4 w-full">
                    <Progress value={currentStreak} max={Math.max(7, progressMax === 365 ? 30 : progressMax)} />
                    <p className="mt-2 text-[9.5px] text-faint">
                      {nextMilestone ? `${nextMilestone.day - currentStreak} day${nextMilestone.day - currentStreak === 1 ? '' : 's'} to ${nextMilestone.label}` : 'Top milestone reached'}
                    </p>
                  </div>
                </div>
                {celebrate && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-success/30 bg-surface-1 px-3 py-1.5 text-[11px] font-semibold text-success shadow-xl animate-fade-up">
                    +{money(celebrate.amount)} money
                  </div>
                )}
              </div>
            </div>
          </Card>

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/80 px-5 py-4">
                <div>
                  <h3 className="flex items-center gap-2 font-display text-[15px] font-semibold text-ink">
                    <CalendarDays className="h-4 w-4 text-gold" /> Streak calendar
                  </h3>
                  <p className="mt-0.5 text-[11.5px] text-muted">The last 14 reward days in {summary.timezone}.</p>
                </div>
                <div className="flex items-center gap-3 text-[9px] font-medium uppercase tracking-[0.1em] text-faint">
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-success/70" /> Claimed</span>
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-gold/80" /> Today</span>
                </div>
              </div>
              <div className="p-4 sm:p-5">
                <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                  {summary.calendar.map((day) => (
                    <CalendarCell key={day.day} day={day} />
                  ))}
                </div>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line/70 bg-surface-2/40 px-3.5 py-3">
                  <p className="text-[11px] text-muted">
                    Missed days:{' '}
                    <span className="font-medium text-ink">
                      {summary.missedPolicy === 'grace'
                        ? `${summary.graceDays} grace day${summary.graceDays === 1 ? '' : 's'} before reset`
                        : 'streak resets'}
                    </span>
                  </p>
                  <p className="text-[10.5px] text-faint">Streak {currentStreak} / {progressMax}</p>
                </div>
              </div>
            </Card>

            <Card>
              <div className="border-b border-line/80 px-5 py-4">
                <h3 className="flex items-center gap-2 font-display text-[15px] font-semibold text-ink">
                  <Trophy className="h-4 w-4 text-gold" /> Milestones
                </h3>
                <p className="mt-0.5 text-[11.5px] text-muted">Bonus money on top of the daily drop.</p>
              </div>
              <div className="space-y-2.5 p-4">
                {sortedMilestones.length === 0 ? (
                  <p className="px-1 py-6 text-center text-[11.5px] text-faint">No milestones configured yet.</p>
                ) : (
                  sortedMilestones.map((milestone) => {
                    const reached = currentStreak >= milestone.day || Boolean(summary.todayClaim && summary.todayClaim.streakDay >= milestone.day);
                    const isNext = nextMilestone?.day === milestone.day;
                    return (
                      <div
                        key={milestone.day}
                        className={cn(
                          'rounded-xl border p-3 transition-colors',
                          reached
                            ? 'border-success/25 bg-success/[0.06]'
                            : isNext
                              ? 'border-gold/30 bg-gold/[0.05]'
                              : 'border-line/70 bg-surface-2/35',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <span
                              className={cn(
                                'grid h-8 w-8 place-items-center rounded-lg border text-[10px] font-bold tnum',
                                reached
                                  ? 'border-success/30 bg-success/10 text-success'
                                  : 'border-gold/20 bg-gold/[0.06] text-gold-dim',
                              )}
                            >
                              {reached ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : `D${milestone.day}`}
                            </span>
                            <div>
                              <p className="text-[11.5px] font-semibold text-ink">{milestone.label}</p>
                              <p className="text-[9.5px] text-faint">Day {milestone.day} · {money(milestone.amount)} money</p>
                            </div>
                          </div>
                          {isNext && !reached && <Badge tone="gold">Next</Badge>}
                          {reached && <Badge tone="success">Unlocked</Badge>}
                        </div>
                        {!reached && (
                          <div className="mt-2.5">
                            <Progress value={Math.min(currentStreak, milestone.day)} max={milestone.day} />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </Card>
          </div>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/80 px-5 py-4">
              <div>
                <h3 className="font-display text-[15px] font-semibold text-ink">Claim history</h3>
                <p className="mt-0.5 text-[11.5px] text-muted">Every daily drop is recorded in your wallet ledger.</p>
              </div>
              <Link to="/transactions" className="flex items-center gap-1 text-[11px] font-semibold text-gold hover:text-gold-bright">
                Full ledger <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {summary.history.length === 0 ? (
              <EmptyState
                icon={<Gift className="h-5 w-5" />}
                title="No claims yet"
                description="Your first daily reward starts your streak. Claim it now and come back tomorrow."
                action={
                  <Button variant="primary" onClick={() => void claim()} disabled={claimedToday} loading={claiming}>
                    Claim first reward
                  </Button>
                }
              />
            ) : (
              <div className="divide-y divide-line/60">
                {summary.history.map((claim) => (
                  <div key={claim.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-success/20 bg-success/[0.07] text-success">
                      <Check className="h-4 w-4" strokeWidth={2.5} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-semibold text-ink">
                        Day {claim.streakDay} reward
                        {claim.milestoneLabel && <span className="ml-2 text-success">· {claim.milestoneLabel}</span>}
                      </p>
                      <p className="text-[10.5px] text-faint">
                        {claim.day} · base {money(claim.baseAmount)}
                        {claim.milestoneAmount > 0 ? ` + ${money(claim.milestoneAmount)} milestone` : ''}
                      </p>
                    </div>
                    <span className="font-display text-[13px] font-semibold text-success tnum">+{money(claim.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-surface-2 text-gold">
                <Mail className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[12.5px] font-semibold text-ink">Reward reminder emails</p>
                <p className="mt-0.5 max-w-xl text-[11px] leading-relaxed text-muted">
                  Get a short email when your daily drop is ready or a streak milestone lands. Account security alerts
                  are always sent separately.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              <span className="text-[10.5px] font-medium text-faint">{summary.emailNotifications ? 'On' : 'Off'}</span>
              <Toggle checked={summary.emailNotifications} onChange={(value) => void toggleEmail(value)} label="Reward reminder emails" disabled={emailBusy} />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
