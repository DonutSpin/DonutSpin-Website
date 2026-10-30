import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Eye,
  Fingerprint,
  History,
  Search,
  ShieldCheck,
  ShieldQuestion,
  UserRoundCheck,
  Users,
} from 'lucide-react';
import {
  ACCOUNT_REVIEW_STATUS_LABELS,
  roleHasPermission,
  type AccountReviewCounts,
  type AccountReviewDetail,
  type AccountReviewStatus,
  type AccountReviewSummary,
  type Paginated,
} from '../../shared/types';
import { useApiQuery } from '../lib/useApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, errorMessage } from '../lib/api';
import { dateTime, timeAgo, titleCase } from '../lib/format';
import { PageHeader } from '../components/layout';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  LoadingBlock,
  Modal,
  Pagination,
  Skeleton,
  TableWrap,
  Td,
  Textarea,
  Th,
  Tabs,
  Tr,
  cn,
} from '../components/ui';

type ReviewList = Paginated<AccountReviewSummary> & {
  counts: AccountReviewCounts;
  accountsPerIp: number;
};

const STATUS_TONES: Record<AccountReviewStatus, 'warning' | 'success' | 'danger' | 'neutral'> = {
  open: 'warning',
  cleared: 'success',
  alt_confirmed: 'danger',
  resolved: 'neutral',
};

const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'alt_confirmed', label: 'Alt confirmed' },
  { key: 'cleared', label: 'Separate users' },
  { key: 'resolved', label: 'Resolved' },
];

function ReviewStatusBadge({ status }: { status: AccountReviewStatus }) {
  return (
    <Badge tone={STATUS_TONES[status]} dot>
      {ACCOUNT_REVIEW_STATUS_LABELS[status]}
    </Badge>
  );
}

function ReviewDetailModal({
  reviewId,
  onClose,
  onChanged,
}: {
  reviewId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const query = useApiQuery<AccountReviewDetail>(reviewId ? `/staff/account-reviews/${reviewId}` : null);
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const [reason, setReason] = useState('');
  const [applyToRelated, setApplyToRelated] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const detail = query.data;
  const canManageUsers = user ? roleHasPermission(user.role, 'users.read') : false;

  useEffect(() => {
    setReason('');
    setApplyToRelated(false);
    setActionError(null);
  }, [reviewId]);

  const decide = async (decision: 'separate_users' | 'alt_account' | 'release_hold') => {
    if (!detail || busy) return;
    if (reason.trim().length < 5) {
      setActionError('Record a reason of at least 5 characters for the review history.');
      return;
    }
    setBusy(decision);
    setActionError(null);
    try {
      await api.post(`/staff/account-reviews/${detail.id}/decision`, {
        decision,
        reason: reason.trim(),
        applyToRelated: decision === 'release_hold' ? false : applyToRelated,
      });
      success(
        decision === 'separate_users'
          ? 'Marked as separate users'
          : decision === 'alt_account'
            ? 'Alt account confirmed'
            : 'Account hold released',
        'The decision is recorded in the review history and audit log.',
      );
      setReason('');
      setApplyToRelated(false);
      query.refetch();
      onChanged();
    } catch (err) {
      setActionError(errorMessage(err));
      toastError('Could not save the review decision', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={Boolean(reviewId)}
      onClose={onClose}
      title={detail ? `Review · ${detail.username}` : 'Account review'}
      description={detail ? detail.reason : 'Loading the review and related account history.'}
      size="xl"
      footer={
        detail ? (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        ) : undefined
      }
    >
      {query.loading && !detail ? (
        <LoadingBlock label="Loading review" />
      ) : query.error && !detail ? (
        <Alert tone="error">{query.error}</Alert>
      ) : detail ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">Review status</p>
              <div className="mt-2"><ReviewStatusBadge status={detail.status} /></div>
              <p className="mt-2 text-[11px] text-muted">Flagged {dateTime(detail.flaggedAt)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">Account hold</p>
              <p className={cn('mt-2 font-display text-[18px] font-semibold', detail.accountHold ? 'text-warning' : 'text-success')}>
                {detail.accountHold ? 'Active' : 'Released'}
              </p>
              <p className="mt-1 text-[11px] text-muted">{detail.accountHold ? 'Betting, bonuses, and cashier requests blocked' : 'No active review hold'}</p>
            </Card>
            <Card className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">Related accounts</p>
              <p className="mt-2 font-display text-[18px] font-semibold text-ink tnum">{detail.relatedAccounts.length}</p>
              <p className="mt-1 text-[11px] text-muted">Shared registration or session network</p>
            </Card>
          </div>

          <div className="rounded-xl border border-line bg-surface-2/50 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral"><Fingerprint className="h-3 w-3" /> {detail.triggerIp ?? 'Address unavailable'}</Badge>
              <Badge tone="neutral"><ShieldQuestion className="h-3 w-3" /> {detail.email}</Badge>
              <Badge tone="neutral"><Users className="h-3 w-3" /> {detail.relatedCount} linked</Badge>
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-muted">{detail.reviewNote}</p>
            <p className="mt-2 text-[10.5px] text-faint">
              Detection is a review trigger, not proof of shared ownership. Households, schools, VPNs, and mobile networks can share an address.
            </p>
          </div>

          <Card>
            <CardHeader
              title="Related accounts"
              description="Registration details and shared network identifiers. Do not treat a match as proof of an alt account."
              action={<Badge tone="neutral">{detail.relatedAccounts.length}</Badge>}
            />
            <TableWrap minWidth={820}>
              <thead>
                <tr>
                  <Th>Account</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <Th>Registered</Th>
                  <Th>Shared IPs</Th>
                  <Th>Review</Th>
                </tr>
              </thead>
              <tbody>
                {detail.relatedAccounts.map((account) => (
                  <Tr key={account.id}>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={account.username} size={27} />
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-medium text-ink">{account.username}</p>
                          <p className="truncate text-[10.5px] text-faint">{account.email}</p>
                        </div>
                      </div>
                    </Td>
                    <Td><Badge tone={account.role === 'user' ? 'neutral' : 'gold'}>{titleCase(account.role)}</Badge></Td>
                    <Td>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={account.status === 'active' ? 'success' : account.status === 'suspended' ? 'danger' : 'warning'}>{titleCase(account.status)}</Badge>
                        {account.accountHold && <Badge tone="warning">Hold</Badge>}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap text-[11px]">{dateTime(account.createdAt)}</Td>
                    <Td className="text-[11px]">{account.sharedIps.length ? account.sharedIps.join(', ') : '—'}</Td>
                    <Td>
                      {account.reviewStatus ? <ReviewStatusBadge status={account.reviewStatus} /> : <span className="text-faint">—</span>}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
            {canManageUsers && (
              <p className="border-t border-line px-4 py-2.5 text-[10.5px] text-faint">
                Account records can be opened from <Link to="/admin/users" className="text-gold hover:text-gold-bright">Users</Link>.
              </p>
            )}
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="IP match history" description="Session and registration addresses across the related accounts." />
              {detail.ipHistory.length === 0 ? (
                <EmptyState icon={<Fingerprint className="h-5 w-5" />} title="No address history" description="The network address was unavailable at registration and in recent sessions." />
              ) : (
                <TableWrap minWidth={520}>
                  <thead>
                    <tr>
                      <Th>Address</Th>
                      <Th className="text-right">Accounts</Th>
                      <Th className="text-right">Registrations</Th>
                      <Th className="text-right">Sessions</Th>
                      <Th>Last seen</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.ipHistory.map((entry) => (
                      <Tr key={entry.ip}>
                        <Td className="font-mono text-[11px] text-ink">{entry.ip}</Td>
                        <Td className="text-right tnum">{entry.accounts}</Td>
                        <Td className="text-right tnum">{entry.registrations}</Td>
                        <Td className="text-right tnum">{entry.sessions}</Td>
                        <Td className="text-[11px]">{timeAgo(entry.lastSeen)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
            </Card>

            <Card>
              <CardHeader title="Review history" description="Who reviewed the case, what they decided, and why." />
              {detail.events.length === 0 ? (
                <EmptyState icon={<History className="h-5 w-5" />} title="No history yet" description="No reviewer decision has been recorded." />
              ) : (
                <ol className="space-y-3 p-4">
                  {detail.events.map((event) => (
                    <li key={event.id} className="rounded-xl border border-line/80 bg-surface-2/40 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11.5px] font-semibold text-ink">{titleCase(event.action)}</p>
                        <time className="text-[10.5px] text-faint">{dateTime(event.createdAt)}</time>
                      </div>
                      <p className="mt-1 text-[11px] text-muted">
                        {event.actorName ?? 'Automatic detection'}
                        {event.toStatus ? ` · ${event.toStatus === 'open' ? 'flagged' : ACCOUNT_REVIEW_STATUS_LABELS[event.toStatus]}` : ''}
                      </p>
                      {event.reason && <p className="mt-1 text-[11px] leading-relaxed text-faint">{event.reason}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>

          {(detail.status === 'open' || detail.status === 'alt_confirmed' || detail.accountHold) && (
            <Card className="border-gold/25">
              <CardHeader
                title="Record a decision"
                description="The reason is required and appears in the internal review history and audit log."
              />
              <div className="space-y-4 p-4">
                {actionError && <Alert tone="error">{actionError}</Alert>}
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Explain what you reviewed and why this decision is appropriate."
                />
                {detail.relatedCount > 1 && (
                  <label className="flex items-start gap-2.5 text-[12px] leading-relaxed text-muted">
                    <input
                      type="checkbox"
                      checked={applyToRelated}
                      onChange={(event) => setApplyToRelated(event.target.checked)}
                      className="mt-1 h-4 w-4 accent-[#e6c27a]"
                    />
                    Apply this decision to every related open review from this network.
                  </label>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="success"
                    loading={busy === 'separate_users'}
                    disabled={busy !== null}
                    onClick={() => void decide('separate_users')}
                    leftIcon={<UserRoundCheck className="h-4 w-4" />}
                  >
                    Mark separate users
                  </Button>
                  <Button
                    variant="danger"
                    loading={busy === 'alt_account'}
                    disabled={busy !== null}
                    onClick={() => void decide('alt_account')}
                    leftIcon={<AlertTriangle className="h-4 w-4" />}
                  >
                    Confirm alt account
                  </Button>
                  {detail.accountHold && (
                    <Button
                      variant="secondary"
                      loading={busy === 'release_hold'}
                      disabled={busy !== null}
                      onClick={() => void decide('release_hold')}
                      leftIcon={<CheckCircle2 className="h-4 w-4" />}
                    >
                      Release hold
                    </Button>
                  )}
                </div>
                <p className="text-[10.5px] leading-relaxed text-faint">
                  Separate users releases the hold immediately. Confirming an alt account keeps the hold in place; release it separately once the case is resolved.
                </p>
              </div>
            </Card>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

export function AccountReviewsPage() {
  const { user } = useAuth();
  const [filter, setFilter] = useState('open');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const params = new URLSearchParams();
  if (filter !== 'all') params.set('status', filter);
  if (search) params.set('q', search);
  params.set('page', String(page));
  params.set('pageSize', '20');
  const query = useApiQuery<ReviewList>(`/staff/account-reviews?${params.toString()}`);
  const data = query.data;

  return (
    <div>
      <PageHeader
        title="Account reviews"
        description="Review shared-network registrations without assuming shared ownership. Holds pause betting, bonuses, and cashier requests until a decision is recorded."
        actions={
          <Badge tone="neutral">
            <ShieldCheck className="h-3 w-3" /> {data?.accountsPerIp ?? 3} accounts allowed per IP
          </Badge>
        }
      />

      {query.error && <Alert tone="error" className="mb-4">{query.error}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Open reviews', value: data?.counts.open, hint: 'Awaiting a decision', icon: ClipboardList, tone: 'text-warning' },
          { label: 'Accounts on hold', value: data?.counts.onHold, hint: 'Restricted pending review', icon: ShieldQuestion, tone: 'text-warning' },
          { label: 'Verified separate', value: data?.counts.cleared, hint: 'Legitimate shared networks', icon: UserRoundCheck, tone: 'text-success' },
          { label: 'Alt accounts confirmed', value: data?.counts.altConfirmed, hint: 'Confirmed duplicates', icon: AlertTriangle, tone: 'text-danger' },
        ].map((stat) => (
          <Card key={stat.label} className="p-4">
            <div className="flex items-start justify-between">
              <p className="text-[10px] font-medium uppercase tracking-[0.09em] text-faint">{stat.label}</p>
              <stat.icon className={cn('h-3.5 w-3.5', stat.tone)} />
            </div>
            <p className="mt-2.5 font-display text-[24px] font-semibold leading-none tnum text-ink">{stat.value ?? '—'}</p>
            <p className="mt-1.5 text-[10.5px] text-faint">{stat.hint}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-5 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <Tabs
            items={FILTERS.map((entry) => ({
              ...entry,
              count:
                entry.key === 'all'
                  ? data?.counts.total
                  : entry.key === 'open'
                    ? data?.counts.open
                    : entry.key === 'alt_confirmed'
                      ? data?.counts.altConfirmed
                      : entry.key === 'cleared'
                        ? data?.counts.cleared
                        : data?.counts.resolved,
            }))}
            value={filter}
            onChange={(value) => {
              setFilter(value);
              setPage(1);
            }}
          />
          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search username, email, or ID" className="pl-9" />
          </div>
        </div>

        {query.loading && !data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-14 w-full" />)}
          </div>
        ) : (data?.items.length ?? 0) === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="h-5 w-5" />}
            title={filter === 'open' ? 'No open account reviews' : 'No reviews match this view'}
            description="Shared-network detection runs invisibly in the background. Cases appear here when the configured allowance is exceeded."
          />
        ) : (
          <>
            <TableWrap minWidth={980}>
              <thead>
                <tr>
                  <Th>Account</Th>
                  <Th>Status</Th>
                  <Th>Reason</Th>
                  <Th className="text-right">Related</Th>
                  <Th>Hold</Th>
                  <Th>Flagged</Th>
                  <Th>Reviewed by</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {data!.items.map((review) => (
                  <Tr key={review.id} onClick={() => setSelected(review.id)}>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={review.username} size={29} />
                        <div className="min-w-0">
                          <p className="truncate text-[12.5px] font-medium text-ink">{review.username}</p>
                          <p className="truncate text-[10.5px] text-faint">{review.email}</p>
                        </div>
                      </div>
                    </Td>
                    <Td><ReviewStatusBadge status={review.status} /></Td>
                    <Td className="max-w-[340px]"><p className="truncate text-[11.5px] text-muted">{review.reason}</p></Td>
                    <Td className="text-right tnum">{review.relatedCount}</Td>
                    <Td>{review.accountHold ? <Badge tone="warning">On hold</Badge> : <Badge tone="success">Clear</Badge>}</Td>
                    <Td className="whitespace-nowrap text-[11px]">{timeAgo(review.flaggedAt)}</Td>
                    <Td className="text-[11px]">{review.reviewedBy ?? '—'}</Td>
                    <Td className="text-right"><Eye className="ml-auto h-3.5 w-3.5 text-faint" /></Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination page={data!.page} totalPages={data!.totalPages} total={data!.total} onPage={setPage} unit="reviews" />
          </>
        )}
      </Card>

      <p className="mt-4 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-faint">
        <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
        IP matches are a risk signal only. Households, schools, VPNs, and mobile networks can share an address; support must review before confirming an alt account. Player-facing screens never show addresses or detection details.
      </p>

      <ReviewDetailModal
        reviewId={selected}
        onClose={() => setSelected(null)}
        onChanged={query.refetch}
      />
    </div>
  );
}
