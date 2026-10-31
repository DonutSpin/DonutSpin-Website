import { useMemo, useState } from 'react';
import { CloudRain, Coins, Sparkles, Timer, Users } from 'lucide-react';
import type { RainCreateResponse, RainLimits, RainView } from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, errorMessage } from '../lib/api';
import { exactMoney, money } from '../lib/format';
import { AmountInput, Badge, Button, Card, CardHeader, Field, Select, cn } from './ui';

const COUNTDOWN_PRESETS = [15, 30, 60, 120, 300];

export function rainSecondsLeft(rain: RainView, now = Date.now()): number {
  if (rain.status !== 'countdown') return 0;
  return Math.max(0, Math.ceil((new Date(rain.countdownEndsAt).getTime() - now) / 1000));
}

export function clock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function durationOf(rain: RainView): number {
  const start = new Date(rain.createdAt).getTime();
  const end = new Date(rain.countdownEndsAt).getTime();
  return Math.max(1, Math.round((end - start) / 1000));
}

export function RainCard({
  rain,
  now,
  onChange,
  compact = false,
}: {
  rain: RainView;
  now: number;
  onChange: () => void;
  compact?: boolean;
}) {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const [busy, setBusy] = useState<'join' | 'leave' | null>(null);
  const active = rain.status === 'countdown';
  const secondsLeft = rainSecondsLeft(rain, now);
  const progress = active ? Math.max(0, Math.min(100, (secondsLeft / durationOf(rain)) * 100)) : 0;

  const join = async () => {
    setBusy('join');
    try {
      await api.post(`/rain/${encodeURIComponent(rain.id)}/join`);
      success('Rain joined', `You are in @${rain.creator.username}'s rain.`);
      onChange();
    } catch (error) {
      toastError('Could not join the rain', errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const leave = async () => {
    setBusy('leave');
    try {
      await api.post(`/rain/${encodeURIComponent(rain.id)}/leave`);
      onChange();
    } catch (error) {
      toastError('Could not leave the rain', errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const action = rain.isCreator ? (
    <Badge tone="gold">Funded</Badge>
  ) : rain.joined ? (
    active ? (
      <Button variant="ghost" size="sm" loading={busy === 'leave'} disabled={Boolean(busy)} onClick={() => void leave()}>
        Leave
      </Button>
    ) : (
      <Badge tone="success">Joined</Badge>
    )
  ) : active && secondsLeft > 0 && user ? (
    <Button variant="primary" size="sm" loading={busy === 'join'} disabled={Boolean(busy)} onClick={() => void join()}>
      Join
    </Button>
  ) : (
    <Badge tone="neutral">{active ? 'Closing' : 'Settled'}</Badge>
  );

  if (compact) {
    return (
      <div className="rounded-xl border border-gold/20 bg-gold/[0.05] p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[10.5px] text-faint">@{rain.creator.username}</span>
          <span className="shrink-0 font-display text-[10.5px] font-semibold text-gold tnum">
            {active ? clock(secondsLeft) : 'done'}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="font-display text-[16px] font-semibold leading-none text-gold-bright tnum">
            {money(rain.totalAmount)}
          </span>
          {action}
        </div>
        <p className="mt-1 text-[9.5px] text-faint">
          {rain.participantCount} joined
          {rain.payoutPerParticipant === null ? '' : ` · ${money(rain.payoutPerParticipant)} each`}
        </p>
      </div>
    );
  }

  return (
    <Card className="relative overflow-hidden border-gold/25">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-gold/[0.08] via-transparent to-info/[0.04]" />
      <div className="relative p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-gold/30 bg-gold/10 text-gold shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <CloudRain className="h-5 w-5" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-[17px] font-semibold text-ink">Money rain</h2>
                <span className="text-[10.5px] text-faint">by @{rain.creator.username}</span>
                {active ? (
                  <Badge tone="gold" dot>
                    Live
                  </Badge>
                ) : (
                  <Badge tone="neutral">Settled</Badge>
                )}
              </div>
              <p className="mt-1 max-w-xl text-[11.5px] leading-relaxed text-muted">
                {active
                  ? 'The pool is held in escrow. When the countdown ends it is split equally between everyone who joined.'
                  : 'This rain has finished and every participant has been paid automatically.'}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-faint">
              {active ? 'Starts in' : 'Settled'}
            </p>
            <p className="font-display text-[34px] font-semibold leading-none tracking-tight text-gold-bright tnum">
              {active ? clock(secondsLeft) : '—'}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Prize pool" value={`${money(rain.totalAmount)} money`} icon={<Coins className="h-4 w-4" />} />
          <Metric
            label="Participants"
            value={String(rain.participantCount)}
            icon={<Users className="h-4 w-4" />}
            hint={rain.participantCount === 0 && active ? 'Be the first to join' : undefined}
          />
          <Metric
            label={active ? 'Each participant' : 'Each received'}
            value={rain.payoutPerParticipant === null ? '—' : `${money(rain.payoutPerParticipant)} money`}
            icon={<Sparkles className="h-4 w-4" />}
            hint={rain.remainder > 0 ? `${money(rain.remainder)} extra split across the first joiners` : 'Equal split'}
          />
          <Metric
            label={active ? 'Countdown' : 'Funded by'}
            value={active ? `${secondsLeft}s` : `@${rain.creator.username}`}
            icon={<Timer className="h-4 w-4" />}
            hint={active ? `Started by @${rain.creator.username}` : undefined}
          />
        </div>

        {active && (
          <div className="mt-4 h-2 overflow-hidden rounded-full border border-gold/15 bg-surface-2">
            <div
              className="h-full rounded-full bg-gradient-to-r from-gold/70 via-gold-bright to-gold transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

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
              <span className="text-[11px] text-faint">
                {active ? 'No one has joined yet.' : 'No one joined this rain.'}
              </span>
            )}
            {rain.participantCount > rain.participants.length && (
              <span className="text-[10.5px] text-faint">
                +{rain.participantCount - rain.participants.length} more
              </span>
            )}
          </div>
          {action}
        </div>

        {rain.isCreator && (
          <p className="mt-3 text-[10.5px] text-faint">
            You paid {exactMoney(rain.totalAmount)} money from your balance. The pool is held in escrow until the
            countdown ends.
          </p>
        )}
      </div>
    </Card>
  );
}

export function RainCreateForm({
  limits,
  balance,
  onCreated,
  onCancel,
}: {
  limits: RainLimits;
  balance: number;
  onCreated: (response: RainCreateResponse) => void;
  onCancel: () => void;
}) {
  const { error: toastError } = useToast();
  const presets = useMemo(
    () => COUNTDOWN_PRESETS.filter((value) => value >= limits.countdownMinSeconds && value <= limits.countdownMaxSeconds),
    [limits.countdownMaxSeconds, limits.countdownMinSeconds],
  );
  const [amount, setAmount] = useState<number | ''>(limits.minAmount);
  const [countdown, setCountdown] = useState(presets.includes(30) ? 30 : (presets[0] ?? 30));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountValue = amount === '' ? 0 : amount;
  const amountTooLow = amountValue < limits.minAmount;
  const amountTooHigh = amountValue > limits.maxAmount;
  const overBalance = amountValue > balance;
  const amountValid =
    Number.isInteger(amountValue) && amountValue >= limits.minAmount && amountValue <= limits.maxAmount && !overBalance;

  const create = async () => {
    if (!amountValid) {
      setError('Enter an amount within the allowed rain limits.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await api.post<RainCreateResponse>('/rain', { amount: amountValue, countdownSeconds: countdown });
      onCreated(response);
    } catch (error) {
      setError(errorMessage(error));
      toastError('Could not start the rain', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-gold/25">
      <CardHeader
        title="Start a rain"
        description="The pool leaves your balance immediately. Everyone who joins before the countdown ends splits it equally."
      />
      <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_170px]">
        <Field
          label="Prize pool"
          hint={`Between ${money(limits.minAmount)} and ${money(limits.maxAmount)} money. Available: ${exactMoney(balance)}.`}
        >
          <AmountInput
            min={limits.minAmount}
            max={limits.maxAmount}
            value={amount}
            onChange={(value) => setAmount(value === '' ? '' : value)}
            placeholder={money(limits.minAmount)}
            invalid={amountTooLow || amountTooHigh || overBalance}
            autoFocus
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
        <p className="px-4 text-[10.5px] text-danger">
          {overBalance
            ? `The pool is larger than your available balance of ${exactMoney(balance)}.`
            : `Use an amount between ${money(limits.minAmount)} and ${money(limits.maxAmount)}.`}
        </p>
      )}
      {error && <p className="px-4 text-[10.5px] text-danger">{error}</p>}

      {amountValid && (
        <div className="mx-4 mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gold/20 bg-gold/[0.05] px-3 py-2">
          <span className="text-[11px] text-muted">
            You pay <strong className="font-semibold text-ink tnum">{exactMoney(amountValue)}</strong> now
          </span>
          <span className="text-[11px] text-muted">
            Balance after{' '}
            <strong className="font-semibold text-gold-bright tnum">{exactMoney(balance - amountValue)}</strong>
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 p-4">
        <p className="text-[10.5px] leading-relaxed text-faint">
          Anyone can start a rain, including while others are running. You cannot join your own rain.
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={!amountValid || busy}
            onClick={() => void create()}
          >
            Fund rain
          </Button>
        </div>
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
