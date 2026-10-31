import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BadgeCheck,
  CheckCircle2,
  Coins,
  ExternalLink,
  Gift,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Ticket,
  Trophy,
  XCircle,
} from 'lucide-react';
import {
  GIVEAWAY_CLAIM_STATUS_LABELS,
  GIVEAWAY_STATUS_LABELS,
  type GiveawayManageResponse,
  type GiveawaySponsorshipView,
  type GiveawayStatus,
  type GiveawayView,
} from '../../shared/types';
import { useToast } from '../context/ToastContext';
import { api, ApiRequestError, errorMessage } from '../lib/api';
import { dateTime, exactMoney, money, timeAgo } from '../lib/format';
import { PageHeader } from '../components/layout';
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
} from '../components/ui';

const POLL_MS = 6000;

function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

function localToIso(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function statusTone(status: GiveawayStatus): 'success' | 'info' | 'danger' | 'neutral' {
  return status === 'active' ? 'success' : status === 'scheduled' ? 'info' : status === 'cancelled' ? 'danger' : 'neutral';
}

const sponsorshipLabels: Record<GiveawaySponsorshipView['status'], string> = {
  pending: 'Pending review',
  approved: 'Approved · awaiting publish',
  rejected: 'Rejected',
  published: 'Published',
  cancelled: 'Cancelled / refunded',
};

function EditGiveawayModal({
  giveaway,
  open,
  onClose,
  onSaved,
}: {
  giveaway: GiveawayView | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { success, error: toastError } = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [prize, setPrize] = useState<number | ''>('');
  const [winners, setWinners] = useState('1');
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!giveaway || !open) return;
    setTitle(giveaway.title);
    setDescription(giveaway.description);
    setPrize(giveaway.prizeAmount);
    setWinners(String(giveaway.winnerCount));
    setEndsAt(toLocalInput(new Date(giveaway.endsAt)));
    setError(null);
    setFields({});
  }, [giveaway, open]);

  if (!giveaway) return null;
  const locked = giveaway.status === 'active';
  const endIso = localToIso(endsAt);
  const endMs = endIso ? new Date(endIso).getTime() : 0;
  const prizeValue = prize === '' ? 0 : prize;
  const winnerValue = Number(winners);
  const valid =
    title.trim().length >= 4 &&
    endMs > Date.now() &&
    Number.isInteger(prizeValue) &&
    prizeValue > 0 &&
    Number.isInteger(winnerValue) &&
    winnerValue > 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api.patch(`/giveaways/${encodeURIComponent(giveaway.id)}`, {
        title,
        description,
        ...(locked ? {} : { prizeAmount: prizeValue, winnerCount: winnerValue }),
        endsAt: endIso,
      });
      success('Giveaway updated', 'The new details are live immediately.');
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fieldErrors);
      toastError('Could not update the giveaway', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit giveaway"
      description={
        locked
          ? 'An active giveaway locks its prize and winner count. You can still edit the copy and extend the end time.'
          : 'Upcoming giveaways can still change the prize; the escrow adjusts in the same transaction.'
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void submit()}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Title" required error={fields.title}>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} />
        </Field>
        <Field label="Description" error={fields.description}>
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={2000} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Prize" error={fields.prizeAmount} hint={locked ? 'Locked while the giveaway is active.' : undefined}>
            <AmountInput value={prize} onChange={setPrize} disabled={locked} min={1} />
          </Field>
          <Field label="Winners" error={fields.winnerCount} hint={locked ? 'Locked while the giveaway is active.' : undefined}>
            <Input
              type="number"
              min={1}
              max={50}
              step={1}
              value={winners}
              onChange={(event) => setWinners(event.target.value)}
              disabled={locked}
            />
          </Field>
        </div>
        <Field label="Ends" required error={fields.endsAt}>
          <Input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function PublishSponsorshipModal({
  sponsorship,
  open,
  onClose,
  onPublished,
}: {
  sponsorship: GiveawaySponsorshipView | null;
  open: boolean;
  onClose: () => void;
  onPublished: () => void;
}) {
  const { success, error: toastError } = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState(() => toLocalInput(new Date()));
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sponsorship || !open) return;
    setTitle(sponsorship.title ?? 'Community giveaway');
    setDescription(sponsorship.description ?? '');
    setStartsAt(toLocalInput(new Date()));
    setEndsAt(toLocalInput(new Date(Date.now() + sponsorship.durationSeconds * 1000)));
    setError(null);
  }, [sponsorship, open]);

  if (!sponsorship) return null;
  const startIso = localToIso(startsAt);
  const endIso = localToIso(endsAt);
  const valid = title.trim().length >= 4 && Boolean(startIso) && Boolean(endIso) && new Date(endIso!).getTime() > Date.now();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/giveaways/sponsorships/${encodeURIComponent(sponsorship.id)}/publish`, {
        title,
        description,
        startsAt: startIso,
        endsAt: endIso,
      });
      success('Giveaway published', 'The sponsor has been notified and the prize is already in escrow.');
      onPublished();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      toastError('Could not publish the giveaway', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Publish sponsored giveaway"
      description={`${money(sponsorship.prizeAmount)} money is already held in escrow for @${sponsorship.sponsor.username}.`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void submit()}>
            Publish giveaway
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Title" required>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} />
        </Field>
        <Field label="Description">
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={2000} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts" required>
            <Input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
          </Field>
          <Field label="Ends" required>
            <Input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
          </Field>
        </div>
        <div className="rounded-xl border border-violet/20 bg-violet/[0.05] p-3 text-[11px] text-muted">
          <p>
            <span className="font-semibold text-ink">{sponsorship.winnerCount}</span> winners · prize{' '}
            <span className="font-semibold text-ink">{exactMoney(sponsorship.prizeAmount)} money</span> · sponsored by @
            {sponsorship.sponsor.username}
          </p>
          <p className="mt-1 text-faint">
            The sponsor is charged once, at approval. Publishing only links the already-escrowed pool to the giveaway.
          </p>
        </div>
      </div>
    </Modal>
  );
}

export function GiveawayAdminPage() {
  const { success, error: toastError } = useToast();
  const [data, setData] = useState<GiveawayManageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<GiveawayView | null>(null);
  const [publishTarget, setPublishTarget] = useState<GiveawaySponsorshipView | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<GiveawayManageResponse>('/giveaways/manage'));
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
    return () => window.clearInterval(timer);
  }, [load]);

  const act = async (key: string, action: () => Promise<unknown>, message: string) => {
    setBusy(key);
    try {
      await action();
      success(message);
      await load();
    } catch (err) {
      toastError('Action failed', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const rejectSponsorship = (sponsorship: GiveawaySponsorshipView) => {
    const reason = window.prompt('Reason for rejecting this sponsorship request?');
    if (!reason || reason.trim().length < 3) return;
    void act(
      `sponsorship-reject-${sponsorship.id}`,
      () =>
        api.post(`/giveaways/sponsorships/${encodeURIComponent(sponsorship.id)}/reject`, {
          reason: reason.trim(),
        }),
      'Sponsorship rejected',
    );
  };

  const rejectClaim = (claimId: string) => {
    const reason = window.prompt('Reason for rejecting this claim?');
    if (!reason || reason.trim().length < 3) return;
    void act(
      `claim-reject-${claimId}`,
      () => api.post(`/giveaways/claims/${encodeURIComponent(claimId)}/reject`, { reason: reason.trim() }),
      'Claim rejected',
    );
  };

  const cancelGiveaway = (giveaway: GiveawayView) => {
    const reason = window.prompt('Cancellation reason? The full prize returns to the funder.');
    if (!reason || reason.trim().length < 3) return;
    void act(
      `cancel-${giveaway.id}`,
      () => api.post(`/giveaways/${encodeURIComponent(giveaway.id)}/cancel`, { reason: reason.trim() }),
      'Giveaway cancelled and refunded',
    );
  };

  const tabs = useMemo(
    () => [
      { key: 'overview', label: 'Giveaways', count: data?.giveaways.length ?? 0 },
      {
        key: 'claims',
        label: 'Claims',
        count: data?.claims.filter((claim) => claim.claimStatus === 'pending').length ?? 0,
      },
      {
        key: 'sponsorships',
        label: 'Sponsorships',
        count: data?.sponsorships.filter((entry) => entry.status === 'pending' || entry.status === 'approved').length ?? 0,
      },
    ],
    [data],
  );

  if (loading) return <LoadingBlock label="Loading giveaway controls" />;
  if (!data) {
    return (
      <div>
        <PageHeader title="Giveaway control" description="Review sponsorships, verify claims and manage prize pools." />
        <Alert tone="error">{error ?? 'The giveaway controls are unavailable.'}</Alert>
        <Button className="mt-4" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  const pendingClaims = data.claims.filter((claim) => claim.claimStatus === 'pending');
  const pendingSponsorships = data.sponsorships.filter(
    (entry) => entry.status === 'pending' || entry.status === 'approved',
  );
  const approvedClaims = data.claims.filter((claim) => claim.claimStatus === 'approved');
  const activePools = data.giveaways.filter((entry) => entry.status === 'active');

  return (
    <div>
      <PageHeader
        title="Giveaway control"
        description="Review player sponsorships, verify winner claims and manage every prize pool. Payouts are ledger-backed and idempotent."
        actions={
          <Button variant="secondary" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()}>
            Refresh
          </Button>
        }
      />

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Live prize pools"
          value={money(activePools.reduce((sum, entry) => sum + entry.prizeAmount, 0))}
          hint={`${activePools.length} active giveaway${activePools.length === 1 ? '' : 's'}`}
          icon={<Trophy className="h-4 w-4" />}
          tone="gold"
        />
        <StatCard
          label="Claims to review"
          value={String(pendingClaims.length)}
          hint={`${approvedClaims.length} paid all-time`}
          icon={<Ticket className="h-4 w-4" />}
          tone={pendingClaims.length > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Sponsorships"
          value={String(pendingSponsorships.length)}
          hint="Pending approval or waiting to publish"
          icon={<Gift className="h-4 w-4" />}
          tone="violet"
        />
        <StatCard
          label="Total giveaways"
          value={String(data.giveaways.length)}
          hint="All statuses"
          icon={<Sparkles className="h-4 w-4" />}
          tone="info"
        />
      </div>

      <div className="mt-5">
        <Tabs items={tabs} value={tab} onChange={setTab} />
      </div>

      {tab === 'overview' && (
        <Card className="mt-4 overflow-hidden">
          <CardHeader
            title="All giveaways"
            description="Active and scheduled prizes can be edited or cancelled. Completed draws stay as permanent records."
          />
          {data.giveaways.length === 0 ? (
            <EmptyState
              icon={<Trophy className="h-5 w-5" />}
              title="No giveaways yet"
              description="Create one from the Giveaways page, or publish an approved sponsor request."
              action={
                <Link to="/giveaways">
                  <Button variant="primary" size="sm">
                    Open giveaways
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="divide-y divide-line/70">
              {data.giveaways.map((giveaway) => (
                <div key={giveaway.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[12.5px] font-semibold text-ink">{giveaway.title}</span>
                      <Badge tone={statusTone(giveaway.status)}>{GIVEAWAY_STATUS_LABELS[giveaway.status]}</Badge>
                      {giveaway.fundingKind === 'sponsor' && giveaway.sponsor && (
                        <Badge tone="violet">Sponsored by @{giveaway.sponsor.username}</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-[10.5px] text-faint">
                      {money(giveaway.prizeAmount)} money · {giveaway.winnerCount} winners · {giveaway.participantCount}{' '}
                      entered · {giveaway.reference}
                      {giveaway.status === 'completed' ? ` · drawn ${timeAgo(giveaway.completedAt)}` : ` · ends ${dateTime(giveaway.endsAt)}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {(giveaway.status === 'scheduled' || giveaway.status === 'active') && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<Pencil className="h-3.5 w-3.5" />}
                          onClick={() => setEditTarget(giveaway)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          loading={busy === `cancel-${giveaway.id}`}
                          onClick={() => cancelGiveaway(giveaway)}
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                    {giveaway.status === 'completed' && (
                      <Link to={`/giveaways?tab=completed`}>
                        <Button variant="ghost" size="sm">
                          View board
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'claims' && (
        <Card className="mt-4 overflow-hidden">
          <CardHeader
            title="Winner claims"
            description="Approve only after verifying the winner. Approval credits the exact prize once and resolves the ticket."
          />
          {data.claims.length === 0 ? (
            <EmptyState
              icon={<Ticket className="h-5 w-5" />}
              title="No giveaway claims yet"
              description="Winners appear here as soon as they open a Giveaway Claim ticket."
            />
          ) : (
            <div className="divide-y divide-line/70">
              {data.claims.map((claim) => (
                <div key={claim.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12.5px] font-semibold text-ink">@{claim.username}</span>
                      <Badge
                        tone={
                          claim.claimStatus === 'approved'
                            ? 'success'
                            : claim.claimStatus === 'pending'
                              ? 'warning'
                              : claim.claimStatus === 'rejected'
                                ? 'danger'
                                : 'neutral'
                        }
                      >
                        {GIVEAWAY_CLAIM_STATUS_LABELS[claim.claimStatus]}
                      </Badge>
                      <span className="text-[10.5px] text-faint">{claim.giveawayReference}</span>
                    </div>
                    <p className="mt-1 text-[10.5px] text-faint">
                      {money(claim.payoutAmount)} money · {claim.giveawayTitle}
                      {claim.ticketReference ? ` · ${claim.ticketReference}` : ' · no claim ticket'}
                    </p>
                    {claim.rejectionReason && (
                      <p className="mt-1 text-[10.5px] text-danger">Reason: {claim.rejectionReason}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {claim.ticketId && (
                      <Link to={`/staff/tickets/${claim.ticketReference}`}>
                        <Button variant="ghost" size="sm" leftIcon={<ExternalLink className="h-3.5 w-3.5" />}>
                          Ticket
                        </Button>
                      </Link>
                    )}
                    {claim.claimStatus === 'pending' && (
                      <>
                        <Button
                          variant="danger"
                          size="sm"
                          loading={busy === `claim-reject-${claim.id}`}
                          onClick={() => rejectClaim(claim.id)}
                        >
                          Reject
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          leftIcon={<BadgeCheck className="h-3.5 w-3.5" />}
                          loading={busy === `claim-approve-${claim.id}`}
                          onClick={() =>
                            void act(
                              `claim-approve-${claim.id}`,
                              () => api.post(`/giveaways/claims/${encodeURIComponent(claim.id)}/approve`),
                              'Prize approved and paid',
                            )
                          }
                        >
                          Approve & pay
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'sponsorships' && (
        <Card className="mt-4 overflow-hidden">
          <CardHeader
            title="Sponsorship requests"
            description="Approval deducts the prize from the sponsor's balance and holds it in escrow. Publish the giveaway afterwards."
          />
          {data.sponsorships.length === 0 ? (
            <EmptyState
              icon={<Gift className="h-5 w-5" />}
              title="No sponsorship requests"
              description="Players can submit one from the Giveaways page. Staff-created giveaways are funded directly."
            />
          ) : (
            <div className="divide-y divide-line/70">
              {data.sponsorships.map((sponsorship) => (
                <div key={sponsorship.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12.5px] font-semibold text-ink">@{sponsorship.sponsor.username}</span>
                      <Badge
                        tone={
                          sponsorship.status === 'published'
                            ? 'success'
                            : sponsorship.status === 'approved'
                              ? 'info'
                              : sponsorship.status === 'pending'
                                ? 'warning'
                                : sponsorship.status === 'rejected'
                                  ? 'danger'
                                  : 'neutral'
                        }
                      >
                        {sponsorshipLabels[sponsorship.status]}
                      </Badge>
                      <span className="text-[10.5px] text-faint">{sponsorship.ticketReference}</span>
                    </div>
                    <p className="mt-1 text-[10.5px] text-faint">
                      {money(sponsorship.prizeAmount)} money · {sponsorship.winnerCount} winners ·{' '}
                      {Math.round(sponsorship.durationSeconds / 60)} minutes
                      {sponsorship.title ? ` · ${sponsorship.title}` : ''}
                      {giveawayReference(sponsorship) ? ` · ${giveawayReference(sponsorship)}` : ''}
                    </p>
                    {sponsorship.reviewReason && (
                      <p className="mt-1 text-[10.5px] text-muted">{sponsorship.reviewReason}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <Link to={`/staff/tickets/${sponsorship.ticketReference}`}>
                      <Button variant="ghost" size="sm" leftIcon={<ExternalLink className="h-3.5 w-3.5" />}>
                        Ticket
                      </Button>
                    </Link>
                    {sponsorship.status === 'pending' && (
                      <>
                        <Button
                          variant="danger"
                          size="sm"
                          loading={busy === `sponsorship-reject-${sponsorship.id}`}
                          onClick={() => rejectSponsorship(sponsorship)}
                        >
                          Reject
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
                          loading={busy === `sponsorship-approve-${sponsorship.id}`}
                          onClick={() =>
                            void act(
                              `sponsorship-approve-${sponsorship.id}`,
                              () => api.post(`/giveaways/sponsorships/${encodeURIComponent(sponsorship.id)}/approve`),
                              'Sponsorship approved and funded',
                            )
                          }
                        >
                          Approve
                        </Button>
                      </>
                    )}
                    {sponsorship.status === 'approved' && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={busy === `sponsorship-refund-${sponsorship.id}`}
                          onClick={() => {
                            if (!window.confirm('Refund this sponsorship and keep the giveaway unpublished?')) return;
                            void act(
                              `sponsorship-refund-${sponsorship.id}`,
                              () => api.post(`/giveaways/sponsorships/${encodeURIComponent(sponsorship.id)}/refund`),
                              'Sponsorship refunded',
                            );
                          }}
                        >
                          Refund
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          leftIcon={<Sparkles className="h-3.5 w-3.5" />}
                          onClick={() => setPublishTarget(sponsorship)}
                        >
                          Publish
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card className="mt-5">
        <CardHeader title="Payout safety" description="Why a claim cannot be paid twice." />
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          {[
            {
              icon: ShieldCheck,
              title: 'Verified winners only',
              text: 'A claim must match the stored winner row for the signed-in account. The winner must open the ticket.',
            },
            {
              icon: Coins,
              title: 'One ledger entry',
              text: 'The payout uses a single-use idempotency key per winner. Retries return the original entry, never a new credit.',
            },
            {
              icon: XCircle,
              title: 'Self-review blocked',
              text: 'Staff cannot approve their own claim, and a rejected or paid claim cannot transition back to pending.',
            },
          ].map((item) => (
            <div key={item.title} className="rounded-xl border border-line bg-surface-2/35 p-3">
              <item.icon className="h-4 w-4 text-gold" />
              <p className="mt-2 text-[11.5px] font-semibold text-ink">{item.title}</p>
              <p className="mt-1 text-[10.5px] leading-relaxed text-muted">{item.text}</p>
            </div>
          ))}
        </div>
      </Card>

      <EditGiveawayModal
        giveaway={editTarget}
        open={Boolean(editTarget)}
        onClose={() => setEditTarget(null)}
        onSaved={() => void load()}
      />
      <PublishSponsorshipModal
        sponsorship={publishTarget}
        open={Boolean(publishTarget)}
        onClose={() => setPublishTarget(null)}
        onPublished={() => void load()}
      />
    </div>
  );
}

function giveawayReference(sponsorship: GiveawaySponsorshipView): string | null {
  return sponsorship.giveawayReference ?? null;
}
