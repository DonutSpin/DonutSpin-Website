import { useCallback, useEffect, useState } from 'react';
import { CloudRain, Coins, Sparkles, Users } from 'lucide-react';
import type { RainStateResponse } from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, errorMessage } from '../lib/api';
import { exactMoney, money, timeAgo } from '../lib/format';
import { PageHeader } from '../components/layout';
import { RainCard, RainCreateForm } from '../components/rain';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Skeleton,
  StatCard,
} from '../components/ui';

const POLL_MS = 3000;

export function RainsPage() {
  const { user, updateBalance } = useAuth();
  const { success } = useToast();
  const [overview, setOverview] = useState<RainStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const response = await api.get<RainStateResponse>('/rain');
      setOverview(response);
      setError(null);
    } catch (error) {
      setError(errorMessage(error));
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

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 rounded-2xl" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (!overview) {
    return (
      <>
        <PageHeader title="Money rain" description="Fund a pool and let the room split it." />
        <Alert tone="error" title="Could not load the rain board">
          {error ?? 'The rain board is unavailable right now.'}
        </Alert>
        <Button className="mt-4" onClick={() => void load()}>
          Retry
        </Button>
      </>
    );
  }

  const active = overview.active;
  const latest = overview.latest;
  const totalPool = active.reduce((sum, rain) => sum + rain.totalAmount, 0);
  const totalParticipants = active.reduce((sum, rain) => sum + rain.participantCount, 0);
  const canCreate = Boolean(user);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Money rain"
        description="Fund a pool for the room. Everyone can start a rain, and every active rain runs on its own countdown."
        actions={
          canCreate ? (
            <Button
              variant="primary"
              leftIcon={<CloudRain className="h-4 w-4" />}
              onClick={() => setCreateOpen((open) => !open)}
            >
              {createOpen ? 'Close form' : 'Start a rain'}
            </Button>
          ) : undefined
        }
      />

      {error && (
        <Alert tone="error" title="Rain board refresh failed">
          {error}
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Live rains"
          value={String(active.length)}
          hint={active.length === 0 ? 'No rain running right now' : 'Each with its own countdown'}
          icon={<CloudRain className="h-4 w-4" />}
          tone="gold"
        />
        <StatCard
          label="Raining now"
          value={`${money(totalPool)} money`}
          hint="Total pool held in escrow"
          icon={<Coins className="h-4 w-4" />}
          tone="info"
        />
        <StatCard
          label="Players joined"
          value={String(totalParticipants)}
          hint="Across every live rain"
          icon={<Users className="h-4 w-4" />}
          tone="success"
        />
      </div>

      {createOpen && canCreate && (
        <RainCreateForm
          limits={overview.limits}
          balance={user?.balance ?? 0}
          onCancel={() => setCreateOpen(false)}
          onCreated={(response) => {
            updateBalance(response.balance);
            setCreateOpen(false);
            success(
              'Rain funded',
              `${exactMoney(response.rain.totalAmount)} money left your balance and is now in escrow.`,
            );
            void load();
          }}
        />
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-display text-xl font-semibold text-ink">Live rain board</h2>
            <p className="mt-0.5 text-[12.5px] text-muted">Join any pool before its countdown reaches zero.</p>
          </div>
          <Badge tone={active.length ? 'success' : 'neutral'} dot={active.length > 0}>
            {active.length ? `${active.length} live` : 'Idle'}
          </Badge>
        </div>

        {active.length === 0 ? (
          <EmptyState
            icon={<CloudRain className="h-5 w-5" />}
            title="No rain is running"
            description="Start the first one. The pool is taken from your balance immediately, and everyone who joins before the countdown ends splits it."
            action={
              canCreate ? (
                <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                  Start a rain
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-4">
            {active.map((rain) => (
              <RainCard key={rain.id} rain={rain} now={now} onChange={() => void load()} />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <Card>
          <CardHeader title="How rains work" description="No claims, no manual payouts." />
          <ul className="space-y-2.5 p-5 text-[12px] leading-relaxed text-muted">
            <li className="flex gap-2">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
              The creator pays the full pool up front. It is held in escrow until the countdown ends.
            </li>
            <li className="flex gap-2">
              <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
              Anyone except the creator can join or leave while the rain is live.
            </li>
            <li className="flex gap-2">
              <Coins className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
              At zero, the pool is split equally. Remainder units go to the first joiners, and nobody joins means a
              full refund to the creator.
            </li>
            <li className="flex gap-2">
              <CloudRain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
              Any number of rains can run at the same time. Each creator funds their own pool.
            </li>
          </ul>
        </Card>

        <Card>
          <CardHeader title="Last settled rain" description="The most recent completed pool." />
          {latest ? (
            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-[24px] font-semibold leading-none text-gold-bright tnum">
                    {money(latest.totalAmount)} money
                  </p>
                  <p className="mt-1 text-[11px] text-faint">Funded by @{latest.creator.username}</p>
                </div>
                <Badge tone={latest.participantCount > 0 ? 'success' : 'neutral'}>
                  {latest.participantCount > 0 ? 'Paid out' : 'Refunded'}
                </Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-[11.5px]">
                <div className="rounded-lg border border-line bg-surface-2/50 p-2.5">
                  <p className="text-[9px] uppercase tracking-[0.12em] text-faint">Participants</p>
                  <p className="mt-0.5 font-semibold text-ink tnum">{latest.participantCount}</p>
                </div>
                <div className="rounded-lg border border-line bg-surface-2/50 p-2.5">
                  <p className="text-[9px] uppercase tracking-[0.12em] text-faint">Each received</p>
                  <p className="mt-0.5 font-semibold text-ink tnum">
                    {latest.payoutPerParticipant === null ? '—' : money(latest.payoutPerParticipant)}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-[10.5px] text-faint">Settled {timeAgo(latest.settledAt)}.</p>
            </div>
          ) : (
            <div className="p-5 text-[12px] text-faint">No rain has settled yet.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
