import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CloudRain, Coins, Sparkles, Timer, Users } from 'lucide-react';
import type { RainCreateResponse, RainStateResponse, RainView } from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, ApiRequestError, errorMessage } from '../lib/api';
import { exactMoney, money } from '../lib/format';
import { AmountInput, Badge, Button, Card, Field, Select, cn } from './ui';

const COUNTDOWN_PRESETS = [15, 30, 60, 120, 300];
const POLL_MS = 2500;

function clock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function durationOf(rain: RainView): number {
  const start = new Date(rain.createdAt).getTime();
  const end = new Date(rain.countdownEndsAt).getTime();
  return Math.max(1, Math.round((end - start) / 1000));
}

export function RainWidget() {
  const { user, updateBalance } = useAuth();
  const { success, error: toastError } = useToast();
  const [rain, setRain] = useState<RainView | null>(null);
  const [loading, setLoading] = useState(true);
  const [behaviorError, setBehaviorError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'join' | 'leave' | 'create' | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [amount, setAmount] = useState<number | ''>('');
  const [countdown, setCountdown] = useState(30);
  const [now, setNow] = useState(() => Date.now());
  const settledRefresh = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await api.get<RainStateResponse>('/rain');
      setRain(response.rain);
      setBehaviorError(null);
    } catch (error) {
      // A transient poll failure must not wipe a live countdown from the UI.
      if (error instanceof ApiRequestError && error.status === 401) setRain(null);
      setBehaviorError(errorMessage(error));
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
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const secondsLeft =
    rain?.status === 'countdown'
      ? Math.max(0, Math.ceil((new Date(rain.countdownEndsAt).getTime() - now) / 1000))
      : 0;

  // Fetch once as soon as the local clock hits zero so the server settles and
  // the widget flips to the result without waiting for the next poll.
  useEffect(() => {
    if (!rain || rain.status !== 'countdown' || secondsLeft > 0) {
      if (rain?.status !== 'countdown') settledRefresh.current = null;
      return;
    }
    if (settledRefresh.current === rain.id) return;
    settledRefresh.current = rain.id;
    void load();
  }, [load, rain, secondsLeft]);

  const limits = rain ?? {
    minAmount: 10_000,
    maxAmount: 5_000_000,
    countdownMinSeconds: 10,
    countdownMaxSeconds: 300,
  };
  const presets = useMemo(
    () => COUNTDOWN_PRESETS.filter((value) => value >= limits.countdownMinSeconds && value <= limits.countdownMaxSeconds),
    [limits.countdownMaxSeconds, limits.countdownMinSeconds],
  );

  const active = rain?.status === 'countdown';
  const amountValue = amount === '' ? 0 : amount;
  const amountTooLow = amountValue < limits.minAmount;
  const amountTooHigh = amountValue > limits.maxAmount;
  const overBalance = Boolean(user && amountValue > user.balance);
  const amountValid =
    Number.isInteger(amountValue) && amountValue >= limits.minAmount && amountValue <= limits.maxAmount && !overBalance;

  const join = async () => {
    setBusy('join');
    try {
      const response = await api.post<{ rain: RainView }>('/rain/join');
      setRain(response.rain);
    } catch (error) {
      toastError('Could not join the rain', errorMessage(error));
      void load();
    } finally {
      setBusy(null);
    }
  };

  const leave = async () => {
    setBusy('leave');
    try {
      const response = await api.post<{ rain: RainView }>('/rain/leave');
      setRain(response.rain);
    } catch (error) {
      toastError('Could not leave the rain', errorMessage(error));
      void load();
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (!amountValid) {
      setBehaviorError('Enter an amount within the allowed rain limits.');
      return;
    }
    setBusy('create');
    setBehaviorError(null);
    try {
      const response = await api.post<RainCreateResponse>('/rain', {
        amount: amountValue,
        countdownSeconds: countdown,
      });
      setRain(response.rain);
      // The server already took the pool out of the wallet. Publish that exact
      // balance now instead of waiting for the next background sync, so a
      // compact header such as "1B" can never make the payment look free.
      updateBalance(response.balance);
      setCreateOpen(false);
      setAmount('');
      success(
        'Rain funded',
        `${exactMoney(amountValue)} money was deducted from your balance and is in escrow for ${countdown} seconds.`,
      );
    } catch (error) {
      setBehaviorError(errorMessage(error));
      toastError('Could not start the rain', errorMessage(error));
      void load();
    } finally {
      setBusy(null);
    }
  };

  const openCreate = () => {
    setBehaviorError(null);
    setAmount(rain?.minAmount ?? 10_000);
    setCountdown(presets.includes(30) ? 30 : (presets[0] ?? 30));
    setCreateOpen(true);
  };

  if (loading) {
    return <div className="h-[186px] animate-pulse rounded-2xl border border-line bg-surface-2/40" aria-label="Loading rain" />;
  }

  return (
    <Card className="relative overflow-hidden border-gold/25">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-gold/[0.09] via-transparent to-info/[0.05]" />
      <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-gold/10 blur-[80px]" />
      <div className="relative p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-gold/30 bg-gold/10 text-gold shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <CloudRain className="h-5 w-5" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-[17px] font-semibold text-ink">Money rain</h2>
                {rain && (
                  <span className="text-[10.5px] text-faint">by @{rain.creator.username}</span>
                )}
                {active ? (
                  <Badge tone="gold" dot>
                    Live now
                  </Badge>
                ) : rain ? (
                  <Badge tone="neutral">Last rain</Badge>
                ) : (
                  <Badge tone="success" dot>
                    Ready
                  </Badge>
                )}
              </div>
              <p className="mt-1 max-w-xl text-[11.5px] leading-relaxed text-muted">
                Anyone can fund a rain. Everyone can join. When the countdown ends, the whole pool is split between the
                participants automatically — no refresh, no claims.
              </p>
            </div>
          </div>

          {active ? (
            <div className="text-right">
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-faint">Starts in</p>
              <p className="font-display text-[34px] font-semibold leading-none tracking-tight text-gold-bright tnum">
                {clock(secondsLeft)}
              </p>
            </div>
          ) : null}
        </div>

        {rain && active ? (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Prize pool" value={`${money(rain.totalAmount)} money`} icon={<Coins className="h-4 w-4" />} />
              <Metric
                label="Participants"
                value={String(rain.participantCount)}
                icon={<Users className="h-4 w-4" />}
                hint={rain.participantCount === 0 ? 'Be the first to join' : undefined}
              />
              <Metric
                label="Each participant"
                value={rain.payoutPerParticipant === null ? '—' : `${money(rain.payoutPerParticipant)} money`}
                icon={<Sparkles className="h-4 w-4" />}
                hint={rain.remainder > 0 ? `${money(rain.remainder)} extra split across the first joiners` : 'Equal split'}
              />
              <Metric
                label="Countdown"
                value={`${secondsLeft}s`}
                icon={<Timer className="h-4 w-4" />}
                hint={`Started by @${rain.creator.username}`}
              />
            </div>

            <div className="mt-4 h-2 overflow-hidden rounded-full border border-gold/15 bg-surface-2">
              <div
                className="h-full rounded-full bg-gradient-to-r from-gold/70 via-gold-bright to-gold transition-[width] duration-500"
                style={{ width: `${Math.max(0, Math.min(100, (secondsLeft / durationOf(rain)) * 100))}%` }}
              />
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-1.5">
                {rain.participants.length > 0 ? (
                  rain.participants.map((participant) => (
                    <span
                      key={participant.id}
                      className="rounded-full border border-line bg-surface-1/80 px-2.5 py-1 text-[10.5px] text-muted"
                      title={participant.username}
                    >
                      @{participant.username}
                    </span>
                  ))
                ) : (
                  <span className="text-[11px] text-faint">No one has joined yet.</span>
                )}
                {rain.participantCount > rain.participants.length && (
                  <span className="text-[10.5px] text-faint">+{rain.participantCount - rain.participants.length} more</span>
                )}
              </div>

              {rain.isCreator ? (
                <span className="rounded-lg border border-gold/20 bg-gold/[0.06] px-3 py-2 text-[11px] font-medium text-gold">
                  You are funding this rain
                </span>
              ) : rain.joined ? (
                <Button
                  variant="secondary"
                  loading={busy === 'leave'}
                  disabled={Boolean(busy) || secondsLeft === 0}
                  onClick={() => void leave()}
                >
                  Leave rain
                </Button>
              ) : (
                <Button
                  variant="primary"
                  loading={busy === 'join'}
                  disabled={Boolean(busy) || secondsLeft === 0}
                  onClick={() => void join()}
                  leftIcon={<CloudRain className="h-4 w-4" />}
                >
                  Join rain
                </Button>
              )}
            </div>
            {rain.isCreator && (
              <p className="mt-3 text-[10.5px] text-faint">
                You paid {exactMoney(rain.totalAmount)} money from your balance. The full pool is held in escrow until
                the countdown ends.
              </p>
            )}
          </>
        ) : (
          <>
            {rain && (
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Pool" value={`${money(rain.totalAmount)} money`} icon={<Coins className="h-4 w-4" />} />
                <Metric label="Participants" value={String(rain.participantCount)} icon={<Users className="h-4 w-4" />} />
                <Metric
                  label="Each received"
                  value={rain.payoutPerParticipant === null ? '—' : `${money(rain.payoutPerParticipant)} money`}
                  icon={<Sparkles className="h-4 w-4" />}
                  hint={rain.remainder > 0 ? `${money(rain.remainder)} extra distributed` : 'Equal split'}
                />
                <Metric label="Funded by" value={`@${rain.creator.username}`} icon={<CloudRain className="h-4 w-4" />} />
              </div>
            )}

            {rain && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-1/70 px-3.5 py-3">
                <p className="text-[11.5px] text-muted">
                  {rain.participantCount === 0
                    ? 'No one joined, so the full pool was refunded to the creator.'
                    : rain.yourPayout !== null
                      ? `You received ${money(rain.yourPayout)} money.`
                      : `Settled ${rain.settledAt ? new Date(rain.settledAt).toLocaleString() : 'just now'}.`}
                </p>
                {rain.participantCount > 0 && (
                  <span className="text-[10.5px] text-faint">
                    {rain.participantCount} {rain.participantCount === 1 ? 'participant' : 'participants'} paid
                    automatically.
                  </span>
                )}
              </div>
            )}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] text-faint">
                Minimum {money(limits.minAmount)} · maximum {money(limits.maxAmount)} per rain. One rain at a time.
              </p>
              {!createOpen && (
                <Button variant="primary" onClick={openCreate} leftIcon={<CloudRain className="h-4 w-4" />}>
                  Start a rain
                </Button>
              )}
            </div>
          </>
        )}

        {createOpen && !active && (
          <div className="mt-4 rounded-xl border border-gold/20 bg-surface-1/80 p-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px]">
              <Field
                label="Prize pool"
                hint={`Between ${money(limits.minAmount)} and ${money(limits.maxAmount)} money. Available: ${exactMoney(user?.balance ?? 0)}.`}
              >
                <AmountInput
                  min={limits.minAmount}
                  max={limits.maxAmount}
                  value={amount}
                  onChange={(value) => setAmount(value === '' ? '' : value)}
                  placeholder={money(limits.minAmount)}
                  invalid={amountTooLow || amountTooHigh || overBalance}
                />
              </Field>
              <Field label="Countdown">
                <Select value={String(countdown)} onChange={(event) => setCountdown(Number(event.target.value))}>
                  {presets.map((value) => (
                    <option key={value} value={value}>
                      {value < 60 ? `${value} seconds` : `${value / 60} minute${value === 60 ? '' : 's'}`}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {(amountTooLow || amountTooHigh || overBalance) && (
              <p className="mt-2 text-[10.5px] text-danger">
                {overBalance
                  ? `The pool is larger than your available balance of ${exactMoney(user?.balance ?? 0)}.`
                  : `Use an amount between ${money(limits.minAmount)} and ${money(limits.maxAmount)}.`}
              </p>
            )}
            {behaviorError && <p className="mt-2 text-[10.5px] text-danger">{behaviorError}</p>}

            {amountValid && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gold/20 bg-gold/[0.05] px-3 py-2">
                <span className="text-[11px] text-muted">
                  You pay <strong className="font-semibold text-ink tnum">{exactMoney(amountValue)}</strong> now
                </span>
                <span className="text-[11px] text-muted">
                  Balance after{' '}
                  <strong className="font-semibold text-gold-bright tnum">
                    {exactMoney((user?.balance ?? 0) - amountValue)}
                  </strong>
                </span>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10.5px] leading-relaxed text-faint">
                The pool is deducted immediately and paid out when the countdown reaches zero.
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)} disabled={busy === 'create'}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy === 'create'}
                  disabled={!amountValid || Boolean(busy)}
                  onClick={() => void create()}
                >
                  Fund rain
                </Button>
              </div>
            </div>
          </div>
        )}

        {behaviorError && !createOpen && active && (
          <p className="mt-3 text-[10.5px] text-danger">{behaviorError}</p>
        )}
      </div>
    </Card>
  );
}

function Metric({
  label,
  value,
  icon,
  hint,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-line/80 bg-surface-1/70 p-3')}>
      <p className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-faint">
        {icon} {label}
      </p>
      <p className="mt-1.5 font-display text-[16px] font-semibold leading-tight text-ink tnum">{value}</p>
      {hint && <p className="mt-0.5 truncate text-[10px] text-faint">{hint}</p>}
    </div>
  );
}
