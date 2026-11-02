import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  Coins,
  Gift,
  LockKeyhole,
  PartyPopper,
  Plus,
  ShieldCheck,
  Sparkles,
  Ticket,
  Trophy,
  Users,
} from 'lucide-react';
import {
  GIVEAWAY_CLAIM_STATUS_LABELS,
  GIVEAWAY_STATUS_LABELS,
  roleHasPermission,
  type GiveawayJoinResponse,
  type GiveawayOverviewResponse,
  type GiveawayStatus,
  type GiveawayView,
} from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, ApiRequestError, errorMessage } from '../lib/api';
import { dateTime, exactMoney, money } from '../lib/format';
import { PageHeader } from '../components/layout';
import { compactClock } from '../components/giveaway-widget';
import {
  Alert,
  AmountInput,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  StatCard,
  Tabs,
  Textarea,
  cn,
} from '../components/ui';

const POLL_MS = 5000;

function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

function localToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function statusTone(status: GiveawayStatus): 'success' | 'info' | 'danger' | 'neutral' {
  return status === 'active' ? 'success' : status === 'scheduled' ? 'info' : status === 'cancelled' ? 'danger' : 'neutral';
}

function GiveawayCard({
  giveaway,
  now,
  canManage,
  busy,
  onJoin,
  onClaim,
  onCancel,
}: {
  giveaway: GiveawayView;
  now: number;
  canManage: boolean;
  busy: boolean;
  onJoin: () => void;
  onClaim: () => void;
  onCancel: () => void;
}) {
  const active = giveaway.status === 'active';
  const remaining = active ? Math.max(0, Math.ceil((new Date(giveaway.endsAt).getTime() - now) / 1000)) : 0;
  const startsIn = giveaway.status === 'scheduled'
    ? Math.max(0, Math.ceil((new Date(giveaway.startsAt).getTime() - now) / 1000))
    : 0;
  const claim = giveaway.yourWin;
  const canClaim = Boolean(claim && claim.claimStatus === 'unclaimed');

  return (
    <Card className={cn('relative overflow-hidden', active ? 'border-gold/30' : 'border-line/90')}>
      {giveaway.bannerUrl && (
        <div className="relative aspect-[3/1] overflow-hidden border-b border-line/70 bg-surface-2">
          <img
            src={giveaway.bannerUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            onError={(event) => {
              event.currentTarget.parentElement?.remove();
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-surface-1/80 to-transparent" />
        </div>
      )}
      {active && (
        <>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-gold/[0.09] via-violet/[0.035] to-transparent" />
          <div className="pointer-events-none absolute -right-14 -top-20 h-48 w-48 rounded-full bg-gold/15 blur-[60px]" />
        </>
      )}
      <div className="relative flex h-full flex-col p-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={statusTone(giveaway.status)} dot={active}>
            {GIVEAWAY_STATUS_LABELS[giveaway.status]}
          </Badge>
          {giveaway.fundingKind === 'sponsor' && giveaway.sponsor ? (
            <Badge tone="violet">
              <Sparkles className="h-2.5 w-2.5" /> Sponsored by @{giveaway.sponsor.username}
            </Badge>
          ) : (
            <Badge tone="neutral">Staff funded</Badge>
          )}
          {giveaway.joined && <Badge tone="success">Entered</Badge>}
        </div>

        <h2 className="mt-3 font-display text-[19px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          {giveaway.title}
        </h2>
        {giveaway.description && (
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-muted">{giveaway.description}</p>
        )}

        <div className="mt-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-faint">Prize pool</p>
            <p className="mt-1 font-display text-[30px] font-semibold leading-none tracking-tight text-gold-bright tnum">
              {money(giveaway.prizeAmount)}
              <span className="ml-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-gold-dim">money</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-faint">
              {active ? 'Ends in' : giveaway.status === 'scheduled' ? 'Starts in' : 'Ended'}
            </p>
            <p
              className={cn(
                'mt-1 font-display text-[21px] font-semibold leading-none tnum',
                active ? 'text-ink' : 'text-muted',
              )}
            >
              {active ? compactClock(remaining) : giveaway.status === 'scheduled' ? compactClock(startsIn) : '—'}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-line/80 bg-surface-2/45 px-2 py-2">
            <p className="text-[8.5px] font-semibold uppercase tracking-[0.1em] text-faint">Winners</p>
            <p className="mt-1 text-[13px] font-semibold text-ink tnum">{giveaway.winnerCount}</p>
          </div>
          <div className="rounded-lg border border-line/80 bg-surface-2/45 px-2 py-2">
            <p className="text-[8.5px] font-semibold uppercase tracking-[0.1em] text-faint">Entered</p>
            <p className="mt-1 text-[13px] font-semibold text-ink tnum">{giveaway.participantCount}</p>
          </div>
          <div className="rounded-lg border border-line/80 bg-surface-2/45 px-2 py-2">
            <p className="text-[8.5px] font-semibold uppercase tracking-[0.1em] text-faint">Per winner</p>
            <p className="mt-1 text-[13px] font-semibold text-ink tnum">
              {money(Math.floor(giveaway.prizeAmount / Math.max(1, giveaway.winnerCount)))}
            </p>
          </div>
        </div>

        {giveaway.participants.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {giveaway.participants.slice(0, 5).map((participant) => (
              <span
                key={participant.userId}
                className="rounded-full border border-line bg-surface-1/70 px-2 py-0.5 text-[9.5px] text-muted"
              >
                @{participant.username}
              </span>
            ))}
            {giveaway.participantCount > 5 && (
              <span className="self-center text-[9.5px] text-faint">+{giveaway.participantCount - 5} more</span>
            )}
          </div>
        )}

        {giveaway.winners.length > 0 && (
          <div className="mt-3 rounded-lg border border-success/20 bg-success/[0.05] p-2.5">
            <p className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-success">
              <Trophy className="h-3 w-3" /> Winners
            </p>
            <div className="mt-1.5 space-y-1">
              {giveaway.winners.slice(0, 5).map((winner) => (
                <div key={winner.id} className="flex items-center justify-between gap-2 text-[10.5px]">
                  <span className="truncate text-ink">@{winner.username}</span>
                  <span className="shrink-0 text-muted tnum">
                    {money(winner.payoutAmount)}
                    {winner.claimStatus === 'approved' && ' · paid'}
                  </span>
                </div>
              ))}
              {giveaway.winners.length > 5 && (
                <p className="text-[9.5px] text-faint">+{giveaway.winners.length - 5} more winners</p>
              )}
            </div>
          </div>
        )}

        {claim && (
          <div className="mt-3 rounded-lg border border-gold/25 bg-gold/[0.06] p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-gold-dim">Your prize</p>
                <p className="mt-0.5 text-[12px] font-semibold text-ink tnum">
                  {money(claim.payoutAmount)} money · {GIVEAWAY_CLAIM_STATUS_LABELS[claim.claimStatus]}
                </p>
              </div>
              {claim.claimStatus === 'unclaimed' && (
                <Button variant="primary" size="sm" onClick={onClaim} disabled={busy}>
                  Claim prize
                </Button>
              )}
              {claim.claimStatus === 'pending' && claim.claimTicketId && (
                <Link to={`/tickets/${claim.claimTicketId}`}>
                  <Button variant="secondary" size="sm">
                    Open claim ticket
                  </Button>
                </Link>
              )}
            </div>
          </div>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {giveaway.fundingKind === 'sponsor' && giveaway.sponsor ? (
              <span className="text-[9.5px] text-faint">Funded by @{giveaway.sponsor.username}</span>
            ) : (
              <span className="text-[9.5px] text-faint">
                {giveaway.creator ? `Published by @${giveaway.creator.username}` : 'Published by staff'}
              </span>
            )}
            {canManage && (giveaway.status === 'active' || giveaway.status === 'scheduled') && (
              <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
            )}
          </div>

          {giveaway.isFunder ? (
            <Badge tone="gold">You funded this</Badge>
          ) : giveaway.status === 'active' && !giveaway.joined ? (
            <Button variant="primary" size="sm" loading={busy} onClick={onJoin}>
              Join giveaway
            </Button>
          ) : null}
          {giveaway.status === 'scheduled' && !giveaway.joined && !giveaway.isFunder && (
            <Badge tone="info">
              <CalendarClock className="h-3 w-3" /> Starts {dateTime(giveaway.startsAt)}
            </Badge>
          )}
          {giveaway.status === 'completed' && !claim && <Badge tone="neutral">Draw complete</Badge>}
        </div>

        <details className="mt-3 text-[9.5px] text-faint">
          <summary className="cursor-pointer select-none hover:text-muted">Fair draw proof</summary>
          <div className="mt-1.5 space-y-1 rounded-lg border border-line/70 bg-surface-2/40 p-2">
            <p className="leading-relaxed">{giveaway.drawAlgorithm}</p>
            <p className="break-all font-mono text-[8.5px] text-muted">Commitment: {giveaway.drawCommitment}</p>
            {giveaway.drawSeed ? (
              <p className="break-all font-mono text-[8.5px] text-success">Revealed seed: {giveaway.drawSeed}</p>
            ) : (
              <p>Seed is revealed after the draw so the result can be recomputed.</p>
            )}
          </div>
        </details>
      </div>
    </Card>
  );
}

function CreateGiveawayModal({
  overview,
  open,
  onClose,
  onCreated,
}: {
  overview: GiveawayOverviewResponse;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { user, updateBalance } = useAuth();
  const { success, error: toastError } = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [prize, setPrize] = useState<number | ''>(overview.limits.minAmount);
  const [winners, setWinners] = useState('1');
  const [startsAt, setStartsAt] = useState(() => toLocalInput(new Date()));
  const [endsAt, setEndsAt] = useState(() => toLocalInput(new Date(Date.now() + 24 * 3600_000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const prizeValue = prize === '' ? 0 : prize;
  const winnerValue = Number(winners);
  const startIso = localToIso(startsAt);
  const endIso = localToIso(endsAt);
  const startMs = startIso ? new Date(startIso).getTime() : 0;
  const endMs = endIso ? new Date(endIso).getTime() : 0;
  const duration = endMs > startMs ? Math.round((endMs - startMs) / 1000) : 0;
  const durationValid =
    duration >= overview.limits.minDurationSeconds && duration <= overview.limits.maxDurationSeconds;
  const scheduleLeadMs = startMs - Date.now();
  const scheduleValid = scheduleLeadMs <= 1000 || scheduleLeadMs >= overview.limits.minScheduleLeadSeconds * 1000;
  const amountValid =
    Number.isInteger(prizeValue) &&
    prizeValue >= overview.limits.minAmount &&
    prizeValue <= overview.limits.maxAmount &&
    prizeValue <= (user?.balance ?? 0);
  const winnersValid =
    Number.isInteger(winnerValue) &&
    winnerValue >= overview.limits.minWinners &&
    winnerValue <= overview.limits.maxWinners;
  const formValid = title.trim().length >= 4 && amountValid && winnersValid && durationValid && scheduleValid && endMs > Date.now();

  const submit = async () => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api.post('/giveaways', {
        title,
        description,
        bannerUrl: bannerUrl.trim() || null,
        prizeAmount: prizeValue,
        winnerCount: winnerValue,
        startsAt: startIso,
        endsAt: endIso,
      });
      updateBalance(Math.max(0, (user?.balance ?? 0) - prizeValue));
      success('Giveaway created', `${exactMoney(prizeValue)} money moved into escrow.`);
      onCreated();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fieldErrors);
      toastError('Could not create the giveaway', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a giveaway"
      description="The full prize is taken from your balance now and held in escrow until the draw completes."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!formValid} onClick={() => void submit()}>
            Fund & publish
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Title" required error={fields.title}>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={100}
            placeholder="Weekend DonutSMP giveaway"
            invalid={Boolean(fields.title)}
          />
        </Field>
        <Field label="Description" error={fields.description} hint="Optional. Tell players what the giveaway is about.">
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="A community prize pool for the weekend."
          />
        </Field>
        <Field label="Banner image" error={fields.bannerUrl} hint="Optional public HTTPS image used on the website and in Discord.">
          <Input
            value={bannerUrl}
            onChange={(event) => setBannerUrl(event.target.value)}
            placeholder="https://…"
            maxLength={500}
            invalid={Boolean(fields.bannerUrl)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Prize amount"
            required
            error={
              fields.prizeAmount ??
              (prizeValue > (user?.balance ?? 0) ? 'The prize is larger than your available balance.' : undefined)
            }
            hint={`Balance: ${exactMoney(user?.balance ?? 0)} money`}
          >
            <AmountInput
              min={overview.limits.minAmount}
              max={overview.limits.maxAmount}
              value={prize}
              onChange={(value) => setPrize(value)}
              invalid={!amountValid}
            />
          </Field>
          <Field label="Number of winners" required error={fields.winnerCount}>
            <Input
              type="number"
              min={overview.limits.minWinners}
              max={overview.limits.maxWinners}
              step={1}
              value={winners}
              onChange={(event) => setWinners(event.target.value)}
              invalid={!winnersValid}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Starts"
            required
            error={fields.startsAt}
            hint={startMs <= Date.now() ? 'Starts immediately.' : 'Scheduled giveaways appear under Upcoming.'}
          >
            <Input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
          </Field>
          <Field
            label="Ends"
            required
            error={
              fields.endsAt ??
              (!durationValid ? `Duration must be between ${Math.round(overview.limits.minDurationSeconds / 60)} minutes and ${Math.round(overview.limits.maxDurationSeconds / 86400)} days.` : undefined)
            }
          >
            <Input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
          </Field>
        </div>
        <div className="rounded-xl border border-gold/20 bg-gold/[0.05] px-3 py-2.5 text-[11px] text-muted">
          Duration <strong className="text-ink">{durationValid ? compactClock(duration) : '—'}</strong> ·{' '}
          {winnerValue > 0 ? `about ${money(Math.floor(prizeValue / Math.max(1, winnerValue)))} money per winner` : '—'} ·{' '}
          prize secured on publish
        </div>
      </div>
    </Modal>
  );
}

function SponsorGiveawayModal({
  overview,
  open,
  onClose,
  onCreated,
}: {
  overview: GiveawayOverviewResponse;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [prize, setPrize] = useState<number | ''>(overview.limits.minAmount);
  const [winners, setWinners] = useState('1');
  const [durationMinutes, setDurationMinutes] = useState('1440');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const prizeValue = prize === '' ? 0 : prize;
  const winnerValue = Number(winners);
  const minutesValue = Number(durationMinutes);
  const durationValid =
    Number.isFinite(minutesValue) &&
    minutesValue >= overview.limits.minDurationSeconds / 60 &&
    minutesValue <= overview.limits.maxDurationSeconds / 60;
  const amountValid =
    Number.isInteger(prizeValue) &&
    prizeValue >= overview.limits.minAmount &&
    prizeValue <= overview.limits.maxAmount &&
    prizeValue <= (user?.balance ?? 0);
  const winnersValid =
    Number.isInteger(winnerValue) &&
    winnerValue >= overview.limits.minWinners &&
    winnerValue <= overview.limits.maxWinners;
  const formValid = amountValid && winnersValid && durationValid;

  const submit = async () => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const result = await api.post<{ sponsorship: { ticketReference: string } }>('/giveaways/sponsorships', {
        prizeAmount: prizeValue,
        winnerCount: winnerValue,
        durationSeconds: Math.round(minutesValue * 60),
        title: title.trim() || undefined,
        description: description.trim() || undefined,
      });
      success(
        'Sponsorship requested',
        `Ticket ${result.sponsorship.ticketReference} is with staff. Your balance is only charged after approval.`,
      );
      onCreated();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fieldErrors);
      toastError('Could not submit the request', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Sponsor a giveaway"
      description="Send a funding request to staff. Once approved, the prize is deducted from your balance and staff publish the giveaway with your name on it."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!formValid} onClick={() => void submit()}>
            Send request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Prize amount" required error={fields.prizeAmount} hint={`Balance: ${exactMoney(user?.balance ?? 0)} money`}>
            <AmountInput
              min={overview.limits.minAmount}
              max={overview.limits.maxAmount}
              value={prize}
              onChange={(value) => setPrize(value)}
              invalid={!amountValid}
            />
          </Field>
          <Field label="Number of winners" required error={fields.winnerCount}>
            <Input
              type="number"
              min={overview.limits.minWinners}
              max={overview.limits.maxWinners}
              step={1}
              value={winners}
              onChange={(event) => setWinners(event.target.value)}
              invalid={!winnersValid}
            />
          </Field>
        </div>
        <Field
          label="Preferred duration (minutes)"
          required
          error={fields.durationSeconds ?? (!durationValid ? 'Choose a duration within the allowed range.' : undefined)}
          hint="Staff can adjust the final schedule when publishing."
        >
          <Input
            type="number"
            min={Math.round(overview.limits.minDurationSeconds / 60)}
            max={Math.round(overview.limits.maxDurationSeconds / 60)}
            step={1}
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(event.target.value)}
            invalid={!durationValid}
          />
        </Field>
        <Field label="Giveaway title" error={fields.title} hint="Optional. Staff can edit it before publishing.">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={100}
            placeholder="Friday night community giveaway"
          />
        </Field>
        <Field label="Description" error={fields.description}>
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Optional details for players."
          />
        </Field>
        <Alert tone="info">
          Your balance is not charged yet. Staff review the request first; approving it deducts the prize into escrow.
        </Alert>
      </div>
    </Modal>
  );
}

function ClaimModal({
  giveaway,
  open,
  onClose,
  onClaimed,
}: {
  giveaway: GiveawayView | null;
  open: boolean;
  onClose: () => void;
  onClaimed: () => void;
}) {
  const { success, error: toastError } = useToast();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMessage('');
      setError(null);
    }
  }, [open]);

  if (!giveaway) return null;
  const claim = giveaway.yourWin;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ ticketReference: string }>(
        `/giveaways/${encodeURIComponent(giveaway.id)}/claim`,
        { message },
      );
      success('Claim ticket opened', `${result.ticketReference} is with staff for verification.`);
      onClaimed();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      toastError('Could not open the claim ticket', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Claim your giveaway prize"
      description="Open a Giveaway Claim ticket so staff can verify the win and release the escrow."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Open claim ticket
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="rounded-xl border border-gold/20 bg-gold/[0.05] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gold-dim">Prize</p>
          <p className="mt-1 font-display text-[24px] font-semibold leading-none text-gold-bright tnum">
            {money(claim?.payoutAmount ?? 0)} <span className="text-[10px] uppercase tracking-wider">money</span>
          </p>
          <p className="mt-1.5 text-[11px] text-muted">{giveaway.title}</p>
        </div>
        <Field label="Message to staff" hint="Optional. Add anything that helps verify your entry.">
          <Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="Hi team, I am claiming my giveaway prize."
          />
        </Field>
        <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-faint">
          <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" /> The prize stays in escrow until staff approve the claim.
        </p>
      </div>
    </Modal>
  );
}

export function GiveawaysPage() {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [overview, setOverview] = useState<GiveawayOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'active' | 'upcoming' | 'completed'>('active');
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [sponsorOpen, setSponsorOpen] = useState(false);
  const [claimTarget, setClaimTarget] = useState<GiveawayView | null>(null);

  const load = useCallback(async () => {
    try {
      setOverview(await api.get<GiveawayOverviewResponse>('/giveaways'));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
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

  const claimParam = searchParams.get('claim');
  useEffect(() => {
    if (!claimParam || !overview) return;
    const target = overview.completed.find((entry) => entry.id === claimParam && entry.yourWin?.claimStatus === 'unclaimed');
    if (target) setClaimTarget(target);
  }, [claimParam, overview]);

  useEffect(() => {
    const status = searchParams.get('tab');
    if (status === 'active' || status === 'upcoming' || status === 'completed') setTab(status);
  }, [searchParams]);

  const canManage = Boolean(overview?.canManage);
  const canSponsor = Boolean(user && roleHasPermission(user.role, 'giveaways.sponsor'));

  const join = async (giveaway: GiveawayView) => {
    setBusyId(giveaway.id);
    try {
      await api.post<GiveawayJoinResponse>(`/giveaways/${encodeURIComponent(giveaway.id)}/join`);
      success('Giveaway joined', `You are entered in “${giveaway.title}”. Good luck!`);
      await load();
    } catch (err) {
      toastError('Could not join the giveaway', errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (giveaway: GiveawayView) => {
    const reason = window.prompt('Why is this giveaway being cancelled? The full prize returns to the funder.');
    if (!reason || reason.trim().length < 3) return;
    setBusyId(giveaway.id);
    try {
      await api.post(`/giveaways/${encodeURIComponent(giveaway.id)}/cancel`, { reason: reason.trim() });
      success('Giveaway cancelled', 'The prize pool was refunded to the funder.');
      await load();
    } catch (err) {
      toastError('Could not cancel the giveaway', errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const setTabAndUrl = (next: string) => {
    setTab(next as 'active' | 'upcoming' | 'completed');
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const tabs = useMemo(
    () => [
      { key: 'active', label: 'Active', count: overview?.active.length ?? 0 },
      { key: 'upcoming', label: 'Upcoming', count: overview?.upcoming.length ?? 0 },
      { key: 'completed', label: 'Completed', count: overview?.completed.length ?? 0 },
    ],
    [overview],
  );

  const items = !overview ? [] : tab === 'active' ? overview.active : tab === 'upcoming' ? overview.upcoming : overview.completed;
  const myClaimable = overview?.myClaims.filter((claim) => claim.claimStatus !== 'rejected') ?? [];

  if (loading) return <LoadingBlock label="Opening the giveaway board" />;

  if (!overview) {
    return (
      <div>
        <PageHeader title="Giveaways" description="Community prize pools, drawn fairly and paid after verification." />
        <Alert tone="error" title="Could not load giveaways">
          {error ?? 'The giveaway board is unavailable right now.'}
        </Alert>
        <Button className="mt-4" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Giveaways"
        description="Live prize pools for the community. Staff and player sponsors fund every prize, and winners claim their payout through a verified ticket."
        actions={
          <>
            {canSponsor && (
              <Button variant="secondary" leftIcon={<Gift className="h-4 w-4" />} onClick={() => setSponsorOpen(true)}>
                Sponsor a giveaway
              </Button>
            )}
            {canManage && (
              <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
                Create giveaway
              </Button>
            )}
            {canManage && (
              <Link
                to={
                  location.pathname.startsWith('/admin')
                    ? '/admin/giveaways'
                    : location.pathname.startsWith('/staff')
                      ? '/staff/giveaways'
                      : user && roleHasPermission(user.role, 'admin.access')
                        ? '/admin/giveaways'
                        : '/staff/giveaways'
                }
              >
                <Button variant="ghost" leftIcon={<ShieldCheck className="h-4 w-4" />}>
                  Manage
                </Button>
              </Link>
            )}
          </>
        }
      />

      {error && (
        <Alert tone="error" title="Giveaway refresh failed">
          {error}
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Live prize pools"
          value={`${money(overview.active.reduce((sum, entry) => sum + entry.prizeAmount, 0))} money`}
          hint={`${overview.active.length} active ${overview.active.length === 1 ? 'giveaway' : 'giveaways'}`}
          icon={<Trophy className="h-4 w-4" />}
          tone="gold"
        />
        <StatCard
          label="Players entered"
          value={String(overview.active.reduce((sum, entry) => sum + entry.participantCount, 0))}
          hint="Across every live giveaway"
          icon={<Users className="h-4 w-4" />}
          tone="info"
        />
        <StatCard
          label="Prizes paid"
          value={String(overview.completed.reduce((sum, entry) => sum + entry.winners.filter((winner) => winner.claimStatus === 'approved').length, 0))}
          hint="Verified winner claims completed"
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="success"
        />
      </div>

      {myClaimable.length > 0 && (
        <Card className="overflow-hidden border-gold/25">
          <CardHeader
            title="Your giveaway prizes"
            description="Open a claim ticket for each unclaimed win. Staff verify the entry before paying."
            action={<Badge tone="gold">{myClaimable.length} claim{myClaimable.length === 1 ? '' : 's'}</Badge>}
          />
          <div className="divide-y divide-line/70">
            {myClaimable.map((claim) => {
              const giveaway = overview.completed.find((entry) => entry.id === claim.giveawayId) ?? null;
              return (
                <div key={claim.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium text-ink">
                      {money(claim.payoutAmount)} money · {claim.giveawayTitle}
                    </p>
                    <p className="mt-0.5 text-[10.5px] text-faint">
                      {GIVEAWAY_CLAIM_STATUS_LABELS[claim.claimStatus]}
                      {claim.ticketReference ? ` · ${claim.ticketReference}` : ''}
                    </p>
                  </div>
                  {claim.claimStatus === 'unclaimed' && giveaway ? (
                    <Button variant="primary" size="sm" onClick={() => setClaimTarget(giveaway)}>
                      Claim prize
                    </Button>
                  ) : claim.ticketId ? (
                    <Link to={`/tickets/${claim.ticketId}`}>
                      <Button variant="secondary" size="sm" leftIcon={<Ticket className="h-3.5 w-3.5" />}>
                        View ticket
                      </Button>
                    </Link>
                  ) : (
                    <Badge tone={claim.claimStatus === 'approved' ? 'success' : 'neutral'}>
                      {GIVEAWAY_CLAIM_STATUS_LABELS[claim.claimStatus]}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs items={tabs} value={tab} onChange={setTabAndUrl} />
        <p className="flex items-center gap-1.5 text-[10.5px] text-faint">
          <Clock3 className="h-3 w-3" /> Updates every few seconds · server-settled draws
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<PartyPopper className="h-5 w-5" />}
          title={
            tab === 'active' ? 'No giveaway is live' : tab === 'upcoming' ? 'Nothing scheduled yet' : 'No completed giveaways'
          }
          description={
            tab === 'active'
              ? 'New prize pools appear here the moment staff or a sponsor publishes one.'
              : tab === 'upcoming'
                ? 'Scheduled giveaways will appear here with a countdown to their start.'
                : 'Finished giveaways and their winners are kept here as a permanent record.'
          }
          action={
            canManage && tab !== 'completed' ? (
              <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                Create giveaway
              </Button>
            ) : canSponsor && tab === 'active' ? (
              <Button variant="secondary" size="sm" onClick={() => setSponsorOpen(true)}>
                Sponsor one
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {items.map((giveaway) => (
            <GiveawayCard
              key={giveaway.id}
              giveaway={giveaway}
              now={now}
              canManage={canManage}
              busy={busyId === giveaway.id}
              onJoin={() => void join(giveaway)}
              onClaim={() => setClaimTarget(giveaway)}
              onCancel={() => void cancel(giveaway)}
            />
          ))}
        </div>
      )}

      <Card>
        <CardHeader title="How giveaways work" description="Prize money is never paid from a client-side balance." />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          {[
            {
              icon: Coins,
              title: 'Escrowed on publish',
              text: 'The full prize leaves the funder’s wallet before the giveaway goes live. Staff fund their own pools; sponsors are charged only after approval.',
            },
            {
              icon: LockKeyhole,
              title: 'Fair, verifiable draw',
              text: 'A random seed is committed at creation. When the timer ends the seed is revealed so anyone can recompute the exact winner order.',
            },
            {
              icon: Ticket,
              title: 'Verified claims',
              text: 'Winners open a Giveaway Claim ticket. Staff review the win and approve one payout per winner — the ledger idempotency key blocks duplicates.',
            },
            {
              icon: ShieldCheck,
              title: 'No duplicate payouts',
              text: 'Winner rows are unique per giveaway, state transitions are conditional, and payout keys are single-use. A retry can never pay twice.',
            },
          ].map((item) => (
            <div key={item.title} className="flex gap-3 rounded-xl border border-line/80 bg-surface-2/35 p-3.5">
              <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
              <div>
                <p className="text-[12px] font-semibold text-ink">{item.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">{item.text}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {canManage && (
        <CreateGiveawayModal
          overview={overview}
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => void load()}
        />
      )}
      {canSponsor && (
        <SponsorGiveawayModal
          overview={overview}
          open={sponsorOpen}
          onClose={() => setSponsorOpen(false)}
          onCreated={() => void load()}
        />
      )}
      <ClaimModal
        giveaway={claimTarget}
        open={Boolean(claimTarget)}
        onClose={() => {
          setClaimTarget(null);
          const params = new URLSearchParams(searchParams);
          params.delete('claim');
          setSearchParams(params, { replace: true });
        }}
        onClaimed={() => void load()}
      />
    </div>
  );
}
