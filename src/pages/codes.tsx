import { useState, type FormEvent } from 'react';
import { Coins, Gift, History, Sparkles, TicketPercent } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, ApiRequestError, errorMessage } from '../lib/api';
import { useApiQuery } from '../lib/useApi';
import { dateTime, money } from '../lib/format';
import { PageHeader } from '../components/layout';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  StatCard,
} from '../components/ui';

interface Redemption {
  id: string;
  code: string;
  amount: number;
  source: 'web' | 'discord';
  redeemedAt: string;
}

export function CodesPage() {
  const { user, refresh } = useAuth();
  const { success, error: toastError } = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const history = useApiQuery<{ redemptions: Redemption[] }>('/codes/redemptions');
  const totalRedeemed = (history.data?.redemptions ?? []).reduce((sum, row) => sum + row.amount, 0);

  const redeem = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldError(null);
    try {
      const result = await api.post<{ amount: number; balance: number; code: { code: string } }>('/codes/redeem', {
        code,
      });
      success(
        `Code redeemed — ${money(result.amount)}`,
        `${result.code.code} was added to your wallet. New balance: ${money(result.balance)}.`,
      );
      setCode('');
      history.refetch();
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFieldError(err.fieldErrors.code ?? null);
      toastError('Could not redeem that code', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Reward codes"
        description="Redeem weekly drops and promotional codes. The same code works here and in the DonutSpin Discord."
        badge={<Badge tone="gold">Shared with Discord</Badge>}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-gold/[0.13] via-violet/[0.04] to-transparent" />
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-gold/15 blur-[70px]" />
          <div className="relative p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-2xl border border-gold/30 bg-gold/10 text-gold shadow-[0_0_30px_-10px_rgba(230,194,122,0.7)]">
                <TicketPercent className="h-6 w-6" />
              </span>
              <div>
                <p className="font-display text-[20px] font-semibold tracking-tight text-ink">Have a code?</p>
                <p className="mt-0.5 text-[12px] text-muted">Codes are case-insensitive and can only be redeemed once per account.</p>
              </div>
            </div>

            <form onSubmit={(event) => void redeem(event)} className="mt-6 space-y-4">
              {error && (
                <Alert tone="error" title="Redemption failed">
                  {error}
                </Alert>
              )}
              <Field
                label="Reward code"
                htmlFor="reward-code"
                required
                error={fieldError ?? undefined}
                hint="Find the latest code in the Discord codes channel or in an announcement."
              >
                <Input
                  id="reward-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder="DONUT-WEEKEND"
                  maxLength={32}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-display text-[18px] tracking-[0.14em] uppercase"
                  invalid={Boolean(fieldError)}
                />
              </Field>
              <Button type="submit" variant="primary" size="lg" loading={busy} disabled={code.trim().length < 3}>
                <Sparkles className="h-4 w-4" /> Redeem code
              </Button>
            </form>

            <div className="mt-7 grid gap-3 border-t border-line/80 pt-5 sm:grid-cols-3">
              <div className="rounded-xl border border-line/80 bg-surface-2/45 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">One account</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted">A code pays the same wallet on the site and in Discord.</p>
              </div>
              <div className="rounded-xl border border-line/80 bg-surface-2/45 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">Ledger recorded</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted">Every redemption is written to your permanent ledger.</p>
              </div>
              <div className="rounded-xl border border-line/80 bg-surface-2/45 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">Limited drops</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted">Codes can expire or reach their redemption limit.</p>
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <StatCard label="Wallet balance" value={money(user?.balance ?? 0)} hint="Updated after every redemption" icon={<Coins className="h-4 w-4" />} tone="gold" />
          <StatCard
            label="Redeemed here"
            value={money(totalRedeemed)}
            hint={`${history.data?.redemptions.length ?? 0} code${(history.data?.redemptions.length ?? 0) === 1 ? '' : 's'} on this page`}
            icon={<Gift className="h-4 w-4" />}
            tone="violet"
          />
        </div>
      </div>

      <Card className="mt-5">
        <CardHeader
          title="Redemption history"
          description="Codes redeemed on the website or through the DonutSpin Discord bot."
          action={
            <Badge tone="neutral">
              <History className="h-3 w-3" /> {history.data?.redemptions.length ?? 0} total
            </Badge>
          }
        />
        {history.loading ? (
          <LoadingBlock label="Loading redemptions" />
        ) : history.error ? (
          <div className="p-5">
            <Alert tone="error">{history.error}</Alert>
          </div>
        ) : (history.data?.redemptions.length ?? 0) === 0 ? (
          <EmptyState
            icon={<TicketPercent className="h-5 w-5" />}
            title="No codes redeemed yet"
            description="Weekly drops and event codes will appear here after you redeem them."
          />
        ) : (
          <div className="divide-y divide-line/70">
            {history.data?.redemptions.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-xl border border-gold/20 bg-gold/[0.07] text-gold">
                    <TicketPercent className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="font-display text-[13px] font-semibold tracking-[0.08em] text-ink">{row.code}</p>
                    <p className="mt-0.5 text-[10.5px] text-faint">
                      {dateTime(row.redeemedAt)} · {row.source === 'discord' ? 'Discord' : 'Website'}
                    </p>
                  </div>
                </div>
                <p className="text-[14px] font-semibold text-success tnum">+{money(row.amount)}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
