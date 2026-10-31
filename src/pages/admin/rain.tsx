import { useEffect, useState } from 'react';
import { CloudRain, Coins, RefreshCw, Timer, Users } from 'lucide-react';
import type { RainLimits, RainStateResponse, RainView } from '../../../shared/types';
import { useToast } from '../../context/ToastContext';
import { useApiQuery } from '../../lib/useApi';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { dateTime, money, timeAgo } from '../../lib/format';
import { PageHeader } from '../../components/layout';
import {
  Alert,
  AmountInput,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  LoadingBlock,
  StatCard,
  cn,
} from '../../components/ui';

const POLL_MS = 3000;

function clock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

export function AdminRainPage() {
  const { success, error: toastError } = useToast();
  const settingsQuery = useApiQuery<RainLimits>('/rain/settings');
  const historyQuery = useApiQuery<{ items: RainView[] }>('/rain/history?limit=10');
  const [overview, setOverview] = useState<RainStateResponse | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [minAmount, setMinAmount] = useState<number | ''>('');
  const [maxAmount, setMaxAmount] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await api.get<RainStateResponse>('/rain');
        if (active) setOverview(response);
      } catch {
        /* The settings and history panels stay usable if a poll fails. */
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!settingsQuery.data) return;
    setMinAmount(settingsQuery.data.minAmount);
    setMaxAmount(settingsQuery.data.maxAmount);
  }, [settingsQuery.data]);

  const save = async () => {
    const min = minAmount === '' ? 0 : minAmount;
    const max = maxAmount === '' ? 0 : maxAmount;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min <= 0 || max <= 0) {
      setFields({ minAmount: 'Enter a whole amount.', maxAmount: 'Enter a whole amount.' });
      return;
    }
    if (max < min) {
      setFields({ maxAmount: 'Maximum must be at least the minimum.' });
      return;
    }
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api.patch('/rain/settings', { minAmount: min, maxAmount: max });
      success('Rain limits saved', 'New rains use these bounds immediately.');
      settingsQuery.refetch();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fieldErrors);
    } finally {
      setBusy(false);
    }
  };

  if (settingsQuery.loading) return <LoadingBlock label="Loading rain controls" />;
  if (settingsQuery.error) return <Alert tone="error">{settingsQuery.error}</Alert>;

  const activeRains = overview?.active ?? [];
  const latest = overview?.latest ?? null;
  const rain = activeRains[0] ?? latest;
  const active = activeRains.length > 0;
  const secondsLeft = (target: RainView | null): number =>
    target?.status === 'countdown'
      ? Math.max(0, Math.ceil((new Date(target.countdownEndsAt).getTime() - now) / 1000))
      : 0;

  return (
    <div>
      <PageHeader
        title="Rain control"
        description="Moderators set the platform-wide minimum and maximum rain amount. Changes apply to every new rain immediately."
        actions={
          <Button
            variant="secondary"
            leftIcon={<RefreshCw className="h-4 w-4" />}
            onClick={() => {
              settingsQuery.refetch();
              historyQuery.refetch();
            }}
          >
            Refresh
          </Button>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Platform rain limits"
            description="Every creation is validated server-side against these values."
            action={settingsQuery.data ? <Badge tone="gold">Live limits</Badge> : null}
          />
          <div className="space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Minimum rain amount"
                hint="The smallest pool a user can create."
                error={fields.minAmount}
              >
                <AmountInput
                  min={1}
                  value={minAmount}
                  onChange={(value) => setMinAmount(value)}
                  placeholder="10k"
                  invalid={Boolean(fields.minAmount)}
                />
              </Field>
              <Field
                label="Maximum rain amount"
                hint="The largest pool a user can create."
                error={fields.maxAmount}
              >
                <AmountInput
                  min={1}
                  value={maxAmount}
                  onChange={(value) => setMaxAmount(value)}
                  placeholder="5M"
                  invalid={Boolean(fields.maxAmount)}
                />
              </Field>
            </div>
            {error && <Alert tone="error">{error}</Alert>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[10.5px] leading-relaxed text-faint">
                Creators can set any countdown between 10 and 300 seconds. Limits never change an existing rain; its
                pool was already escrowed when it started.
              </p>
              <Button variant="primary" loading={busy} onClick={() => void save()}>
                Save limits
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title={active ? (activeRains.length === 1 ? 'Live rain' : `${activeRains.length} live rains`) : 'Rain status'}
            description={active ? 'The homepage chat and rains page use this state.' : 'The most recent rain is shown when none is running.'}
            action={active ? <Badge tone="success" dot>Live</Badge> : <Badge tone="neutral">Idle</Badge>}
          />
          <div className="p-4">
            {activeRains.length > 1 && (
              <div className="mb-4 space-y-2">
                {activeRains.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2/50 px-3 py-2 text-[11px]"
                  >
                    <span className="font-medium text-ink">@{entry.creator.username}</span>
                    <span className="text-gold-bright tnum">{money(entry.totalAmount)}</span>
                    <span className="text-muted tnum">{clock(secondsLeft(entry))}</span>
                    <span className="text-faint">{entry.participantCount} joined</span>
                  </div>
                ))}
              </div>
            )}
            {!rain ? (
              <EmptyState
                icon={<CloudRain className="h-5 w-5" />}
                title="No rain yet"
                description="The first rain a user starts will appear here with its pool, participants and countdown."
              />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <StatCard
                    label="Prize pool"
                    value={`${money(rain.totalAmount)}`}
                    hint="DonutSMP money"
                    icon={<Coins className="h-4 w-4" />}
                    tone="gold"
                  />
                  <StatCard
                    label="Participants"
                    value={String(rain.participantCount)}
                    hint={`Funded by @${rain.creator.username}`}
                    icon={<Users className="h-4 w-4" />}
                  />
                  <StatCard
                    label={active ? 'Each so far' : 'Each received'}
                    value={rain.payoutPerParticipant === null ? '—' : money(rain.payoutPerParticipant)}
                    hint={rain.remainder > 0 ? `+${money(rain.remainder)} remainder` : 'Equal split'}
                    icon={<CloudRain className="h-4 w-4" />}
                  />
                  <StatCard
                    label={active ? 'Countdown' : 'Settled'}
                    value={active ? clock(secondsLeft(rain)) : 'done'}
                    hint={active ? `${secondsLeft(rain)}s remaining` : timeAgo(rain.settledAt)}
                    icon={<Timer className="h-4 w-4" />}
                    tone={active ? 'info' : 'success'}
                  />
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {rain.participants.map((participant) => (
                    <span
                      key={participant.id}
                      className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[10.5px] text-muted"
                    >
                      @{participant.username}
                      {participant.payout !== null ? (
                        <span className={cn('ml-1.5 tnum', participant.payout > 0 ? 'text-success' : 'text-faint')}>
                          {money(participant.payout)}
                        </span>
                      ) : null}
                    </span>
                  ))}
                  {rain.participantCount > rain.participants.length && (
                    <span className="self-center text-[10.5px] text-faint">
                      +{rain.participantCount - rain.participants.length} more
                    </span>
                  )}
                  {rain.participantCount === 0 && <span className="text-[11px] text-faint">No participants joined.</span>}
                </div>

                <p className="mt-3 text-[10.5px] leading-relaxed text-faint">
                  Created {dateTime(rain.createdAt)}
                  {rain.settledAt ? ` · settled ${dateTime(rain.settledAt)}` : ` · ends ${dateTime(rain.countdownEndsAt)}`}
                  {rain.remainder > 0 ? ` · ${money(rain.remainder)} split across the first joiners` : ''}.
                </p>
              </>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-5 overflow-hidden">
        <CardHeader title="Recent rains" description="The last ten settled rain events." />
        {historyQuery.loading ? (
          <div className="p-4 text-[12px] text-faint">Loading rain history…</div>
        ) : historyQuery.error ? (
          <div className="p-4"><Alert tone="error">{historyQuery.error}</Alert></div>
        ) : (historyQuery.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            icon={<CloudRain className="h-5 w-5" />}
            title="No settled rains yet"
            description="Settled pools will stay listed here as a read-only record."
          />
        ) : (
          <div className="divide-y divide-line/70">
            {historyQuery.data!.items.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-ink">
                    {money(entry.totalAmount)} money
                    <span className="ml-2 text-[10.5px] font-normal text-faint">by @{entry.creator.username}</span>
                  </p>
                  <p className="mt-0.5 text-[10.5px] text-faint">
                    {entry.participantCount} participant{entry.participantCount === 1 ? '' : 's'} ·{' '}
                    {entry.payoutPerParticipant === null ? 'refunded' : `${money(entry.payoutPerParticipant)} each`} ·{' '}
                    {timeAgo(entry.settledAt)}
                  </p>
                </div>
                <span className={cn('text-[11px] font-medium', entry.participantCount > 0 ? 'text-success' : 'text-muted')}>
                  {entry.participantCount > 0 ? 'Paid out' : 'Refunded'}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
