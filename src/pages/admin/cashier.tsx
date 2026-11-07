import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Landmark,
  PauseCircle,
  Pencil,
  PlayCircle,
  ScrollText,
  Search,
  ShieldCheck,
  UserRound,
  Wallet,
  XCircle,
} from 'lucide-react';
import type {
  CashierCounts,
  CashierRequestDetail,
  CashierRequestKind,
  CashierRequestStatus,
  CashierRequestSummary,
} from '../../../shared/types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useApiQuery } from '../../lib/useApi';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { money, dateTime, timeAgo } from '../../lib/format';
import { PageHeader } from '../../components/layout';
import {
  CASHIER_KIND_LABELS,
  CashierKindIcon,
  CashierStatusBadge,
  CashierThread,
} from '../../components/cashier';
import {
  AccountStatusBadge,
  Alert,
  AmountInput,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Pagination,
  Select,
  StatCard,
  TableWrap,
  Tabs,
  Td,
  Textarea,
  Th,
  Tr,
  cn,
} from '../../components/ui';

interface AdminCashierListResponse {
  items: CashierRequestSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  counts: CashierCounts;
}

const STATUS_TABS: { key: CashierRequestStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'cancelled', label: 'Cancelled' },
];

export function AdminCashierPage() {
  const [status, setStatus] = useState<CashierRequestStatus | 'all'>('pending');
  const [kind, setKind] = useState<CashierRequestKind | ''>('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams();
  params.set('status', status);
  params.set('page', String(page));
  params.set('pageSize', '20');
  if (kind) params.set('kind', kind);
  if (appliedSearch) params.set('q', appliedSearch);

  const query = useApiQuery<AdminCashierListResponse>(`/admin/cashier?${params.toString()}`, { pollMs: 10_000 });
  const data = query.data;

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(search.trim());
  };

  return (
    <div>
      <PageHeader
        title="Cashier requests"
        description="The single review queue for every DonutSMP money request, deposit, and withdrawal."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/admin/transcripts?kind=cashier">
              <Button variant="secondary" leftIcon={<ScrollText className="h-4 w-4" />}>
                Transcripts
              </Button>
            </Link>
            <Link to="/admin/economy">
              <Button variant="secondary" leftIcon={<Wallet className="h-4 w-4" />}>
                Economy
              </Button>
            </Link>
          </div>
        }
      />

      <Alert tone="info" className="mb-5">
        Approving a deposit adds DonutSMP money to the requester's wallet. Approving a withdrawal removes it. Every
        decision is ledger-backed and written to the audit log.
      </Alert>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Pending review"
          value={data?.counts.pending ?? '—'}
          hint="Needs an owner or admin"
          icon={<Landmark className="h-4 w-4" />}
          tone="warning"
        />
        <StatCard
          label="Approved"
          value={data?.counts.approved ?? '—'}
          hint="Settled requests"
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="success"
        />
        <StatCard
          label="Deposits requested"
          value={data?.counts.deposits ?? '—'}
          hint="Lifetime deposit requests"
          icon={<Wallet className="h-4 w-4" />}
          tone="gold"
        />
        <StatCard
          label="Withdrawals requested"
          value={data?.counts.withdrawals ?? '—'}
          hint="Lifetime withdrawal requests"
          icon={<XCircle className="h-4 w-4" />}
          tone="danger"
        />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-end lg:justify-between">
          <Tabs
            items={STATUS_TABS.map((tab) => ({
              ...tab,
              count: data?.counts[tab.key === 'all' ? 'all' : tab.key],
            }))}
            value={status}
            onChange={(value) => {
              setStatus(value as CashierRequestStatus | 'all');
              setPage(1);
            }}
          />
          <form onSubmit={submitSearch} className="flex flex-wrap items-end gap-2">
            <Field label="Type" className="w-36">
              <Select
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as CashierRequestKind | '');
                  setPage(1);
                }}
              >
                <option value="">Both</option>
                <option value="deposit">Deposits</option>
                <option value="withdrawal">Withdrawals</option>
              </Select>
            </Field>
            <Field label="Search" className="w-52">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Reference or username"
                  className="pl-8"
                />
              </div>
            </Field>
            <Button type="submit" variant="secondary" size="sm">
              Apply
            </Button>
          </form>
        </div>

        {query.loading ? (
          <LoadingBlock label="Loading cashier queue" />
        ) : query.error ? (
          <div className="p-4">
            <Alert tone="error">{query.error}</Alert>
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="h-5 w-5" />}
            title="Queue is clear"
            description="No cashier requests match these filters. New requests appear here immediately."
          />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Request</Th>
                  <Th>Requester</Th>
                  <Th>Type</Th>
                  <Th className="text-right">Amount</Th>
                  <Th className="text-right">Balance</Th>
                  <Th>Status</Th>
                  <Th>Last activity</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((request) => (
                  <Tr key={request.id}>
                    <Td>
                      <Link to={`/admin/cashier/${request.reference}`} className="font-display text-[11.5px] font-medium text-gold">
                        {request.reference}
                      </Link>
                      <p className="mt-0.5 text-[10px] text-faint">{timeAgo(request.createdAt)}</p>
                    </Td>
                    <Td>
                      <span className="text-[12px] text-ink">{request.requester.username}</span>
                    </Td>
                    <Td>
                      <span className="flex items-center gap-1.5">
                        <CashierKindIcon
                          kind={request.kind}
                          className={cn('h-3.5 w-3.5', request.kind === 'deposit' ? 'text-success' : 'text-warning')}
                        />
                        {CASHIER_KIND_LABELS[request.kind]}
                      </span>
                    </Td>
                    <Td className="text-right font-semibold text-ink tnum">{money(request.amount)}</Td>
                    <Td className="text-right tnum">{money(request.requester.balance ?? 0)}</Td>
                    <Td>
                      <CashierStatusBadge status={request.status} />
                    </Td>
                    <Td className="whitespace-nowrap text-[11px]">{timeAgo(request.lastActivityAt)}</Td>
                    <Td className="text-right">
                      <Link to={`/admin/cashier/${request.reference}`}>
                        <Button size="sm" variant={request.status === 'pending' ? 'primary' : 'secondary'}>
                          {request.status === 'pending' ? 'Review' : 'Open'}
                        </Button>
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              total={data.total}
              onPage={setPage}
              unit="requests"
            />
          </>
        )}
      </Card>
    </div>
  );
}

export function AdminCashierDetailPage() {
  const { reference = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const query = useApiQuery<{ request: CashierRequestDetail }>(`/admin/cashier/${reference}`, { pollMs: 5_000 });
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decisionFields, setDecisionFields] = useState<Record<string, string>>({});
  const [editOpen, setEditOpen] = useState(false);
  const [editAmount, setEditAmount] = useState<number | ''>('');
  const [editReason, setEditReason] = useState('');
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdReason, setHoldReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const request = query.data?.request;

  const sendMessage = async (body: string): Promise<boolean> => {
    if (!request) return false;
    try {
      await api.post(`/admin/cashier/${request.reference}/messages`, { body });
      query.refetch();
      return true;
    } catch (err) {
      toastError('Message not sent', errorMessage(err));
      return false;
    }
  };

  const openDecision = (next: 'approve' | 'reject') => {
    setReason('');
    setDecisionError(null);
    setDecisionFields({});
    setDecision(next);
  };

  const submitDecision = async () => {
    if (!request || !decision) return;
    if (decision === 'reject' && reason.trim().length < 5) {
      setDecisionFields({ reason: 'Record a reason of at least 5 characters.' });
      return;
    }
    setDecisionBusy(true);
    setDecisionError(null);
    setDecisionFields({});
    try {
      await api.post(`/admin/cashier/${request.reference}/decision`, {
        decision,
        reason: reason.trim() || undefined,
      });
      success(decision === 'approve' ? 'Cashier request approved' : 'Cashier request rejected');
      setDecision(null);
      query.refetch();
    } catch (err) {
      setDecisionError(errorMessage(err));
      if (err instanceof ApiRequestError) setDecisionFields(err.fieldErrors);
    } finally {
      setDecisionBusy(false);
    }
  };

  const saveAmount = async () => {
    if (!request || typeof editAmount !== 'number' || editAmount <= 0) return;
    setActionBusy(true);
    try {
      await api.post(`/admin/cashier/${request.reference}/amount`, {
        amount: editAmount,
        reason: editReason.trim() || undefined,
      });
      success('Amount updated');
      setEditOpen(false);
      query.refetch();
    } catch (err) {
      toastError('Could not update the amount', errorMessage(err));
    } finally {
      setActionBusy(false);
    }
  };

  const holdRequest = async () => {
    if (!request || holdReason.trim().length < 3) return;
    setActionBusy(true);
    try {
      await api.post(`/admin/cashier/${request.reference}/hold`, { reason: holdReason.trim() });
      success('Request placed on hold');
      setHoldOpen(false);
      setHoldReason('');
      query.refetch();
    } catch (err) {
      toastError('Could not hold the request', errorMessage(err));
    } finally {
      setActionBusy(false);
    }
  };

  const resumeRequest = async () => {
    if (!request) return;
    setActionBusy(true);
    try {
      await api.delete(`/admin/cashier/${request.reference}/hold`);
      success('Request resumed');
      query.refetch();
    } catch (err) {
      toastError('Could not resume the request', errorMessage(err));
    } finally {
      setActionBusy(false);
    }
  };

  if (query.loading) return <LoadingBlock label="Loading cashier request" />;
  if (query.error || !request) {
    return (
      <div className="mx-auto max-w-md py-12">
        <Alert tone="error">{query.error ?? 'Cashier request not found.'}</Alert>
        <Button className="mt-4" variant="secondary" onClick={() => navigate('/admin/cashier')}>
          Back to queue
        </Button>
      </div>
    );
  }

  const withdrawalShortfall =
    request.kind === 'withdrawal' && (request.requester.balance ?? 0) < request.amount;

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Deposit & withdrawal', to: '/admin/cashier' },
          { label: request.reference },
        ]}
        title={`${CASHIER_KIND_LABELS[request.kind]} request`}
        description={`${money(request.amount)} DonutSMP money from ${request.requester.username}`}
        badge={<CashierStatusBadge status={request.status} />}
        actions={
          <>
            {request.status !== 'pending' && (
              <Link to={`/transcripts/cashier/${request.reference}`}>
                <Button variant="secondary" leftIcon={<ScrollText className="h-4 w-4" />}>
                  Transcript
                </Button>
              </Link>
            )}
            <Link to="/admin/cashier">
              <Button variant="secondary" leftIcon={<ArrowLeft className="h-4 w-4" />}>
                Back to queue
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_370px]">
        <div className="space-y-5">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="flex items-center gap-3.5">
                <span className="grid h-12 w-12 place-items-center rounded-xl border border-gold/25 bg-gold/8">
                  <CashierKindIcon
                    kind={request.kind}
                    className={cn('h-5 w-5', request.kind === 'deposit' ? 'text-success' : 'text-warning')}
                  />
                </span>
                <div>
                  <p className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-faint">
                    {CASHIER_KIND_LABELS[request.kind]} request
                  </p>
                  <p className="mt-1 font-display text-[30px] font-semibold leading-none text-gold-bright tnum">
                    {money(request.amount)}{' '}
                    <span className="text-[10px] font-medium uppercase tracking-wider text-faint">money</span>
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-mono text-[11px] text-muted">{request.reference}</p>
                <p className="mt-1 text-[10.5px] text-faint">Last activity {timeAgo(request.lastActivityAt)}</p>
              </div>
            </div>
            <div className="border-t border-line bg-surface-2/35 px-5 py-2.5 text-[11px] text-faint">
              Submitted {dateTime(request.createdAt)} by {request.requester.username}.
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Conversation"
              description="Public messages between the requester and administrators."
              action={<Badge tone="neutral">{request.messages.length}</Badge>}
            />
            <div className="p-5">
              <CashierThread
                messages={request.messages}
                currentUserId={user?.id ?? ''}
                canMessage={request.canMessage}
                status={request.status}
                onSend={sendMessage}
              />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Requester" />
            <div className="p-5">
              <div className="flex items-center gap-3">
                <Avatar name={request.requester.username} size={40} />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-ink">{request.requester.username}</p>
                  <p className="truncate text-[10.5px] text-faint">{request.requester.email}</p>
                </div>
              </div>
              <dl className="mt-4 space-y-2.5 text-[11.5px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Balance</dt>
                  <dd className="font-semibold text-ink tnum">{money(request.requester.balance ?? 0)} money</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Status</dt>
                  <dd>{request.requester.status ? <AccountStatusBadge status={request.requester.status} /> : '—'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Joined</dt>
                  <dd className="text-ink">{request.requester.createdAt ? dateTime(request.requester.createdAt) : '—'}</dd>
                </div>
              </dl>
              <Link to={`/admin/users/${request.requester.id}`}>
                <Button className="mt-4 w-full" variant="secondary" size="sm" leftIcon={<UserRound className="h-3.5 w-3.5" />}>
                  Open user record
                </Button>
              </Link>
            </div>
          </Card>

          <Card>
            <CardHeader title="Decision" />
            <div className="p-5">
              {request.status === 'pending' ? (
                <>
                  {request.onHold && (
                    <Alert tone="warning" className="mb-3" title="On hold">
                      {request.holdReason ?? 'This request is temporarily paused.'}
                      <Button
                        className="mt-3 w-full"
                        variant="secondary"
                        size="sm"
                        loading={actionBusy}
                        leftIcon={<PlayCircle className="h-3.5 w-3.5" />}
                        onClick={() => void resumeRequest()}
                      >
                        Resume request
                      </Button>
                    </Alert>
                  )}
                  {withdrawalShortfall && (
                    <Alert tone="warning" className="mb-3">
                      The requester's balance is now {money(request.requester.balance ?? 0)} money, below this
                      withdrawal. Reject it or ask the requester to submit a new amount.
                    </Alert>
                  )}
                  <p className="text-[11.5px] leading-relaxed text-muted">
                    Approval settles immediately in the wallet ledger. Rejection requires a short reason.
                  </p>
                  <div className="mt-4 grid gap-2">
                    <Button
                      variant="primary"
                      leftIcon={<CheckCircle2 className="h-4 w-4" />}
                      onClick={() => openDecision('approve')}
                      disabled={withdrawalShortfall || request.onHold}
                    >
                      Approve request
                    </Button>
                    <Button
                      variant="danger"
                      leftIcon={<XCircle className="h-4 w-4" />}
                      onClick={() => openDecision('reject')}
                      disabled={request.onHold}
                    >
                      Reject request
                    </Button>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={request.onHold}
                        leftIcon={<Pencil className="h-3.5 w-3.5" />}
                        onClick={() => {
                          setEditAmount(request.amount);
                          setEditReason('');
                          setEditOpen(true);
                        }}
                      >
                        Edit amount
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={request.onHold}
                        leftIcon={<PauseCircle className="h-3.5 w-3.5" />}
                        onClick={() => setHoldOpen(true)}
                      >
                        Put on hold
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <dl className="space-y-3 text-[11.5px]">
                  {request.holdReason && (
                    <div className="rounded-lg border border-warning/25 bg-warning/6 p-2.5">
                      <dt className="text-[10px] uppercase tracking-wider text-warning">Hold reason</dt>
                      <dd className="mt-1 leading-relaxed text-muted">{request.holdReason}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Status</dt>
                    <dd>
                      <CashierStatusBadge status={request.status} />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Reviewer</dt>
                    <dd className="text-ink">{request.reviewer?.username ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Decided</dt>
                    <dd className="text-right text-ink">{request.decidedAt ? dateTime(request.decidedAt) : '—'}</dd>
                  </div>
                  {request.decisionReason && (
                    <div className="rounded-lg border border-line bg-surface-2/60 p-2.5">
                      <dt className="text-[10px] uppercase tracking-wider text-faint">Decision note</dt>
                      <dd className="mt-1 leading-relaxed text-muted">{request.decisionReason}</dd>
                    </div>
                  )}
                  {request.ledgerId && (
                    <div className="rounded-lg border border-success/20 bg-success/6 p-2.5">
                      <dt className="text-[10px] uppercase tracking-wider text-success">Ledger entry</dt>
                      <dd className="mt-1 break-all font-mono text-[10px] text-success">{request.ledgerId}</dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
          </Card>

          <div className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-1 p-4">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
            <p className="text-[10.5px] leading-relaxed text-faint">
              Only owners and administrators can decide cashier requests. Each decision is final, idempotent, and
              recorded in both the ledger and audit log.
            </p>
          </div>
        </div>
      </div>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Change the requested amount"
        description="The requester is notified and the change is recorded in the audit transcript."
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={actionBusy}>
              Cancel
            </Button>
            <Button variant="primary" loading={actionBusy} onClick={() => void saveAmount()}>
              Save amount
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="New amount" hint="The request must still be pending and not on hold.">
            <AmountInput value={editAmount} onChange={setEditAmount} min={1} />
          </Field>
          <Field label="Reason (optional)" hint="Shown to the requester and recorded in the transcript.">
            <Textarea value={editReason} onChange={(event) => setEditReason(event.target.value)} rows={2} maxLength={500} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={holdOpen}
        onClose={() => setHoldOpen(false)}
        title="Place this request on hold?"
        description="The requester stays notified, but decisions are paused until an administrator resumes it."
        footer={
          <>
            <Button variant="ghost" onClick={() => setHoldOpen(false)} disabled={actionBusy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={actionBusy}
              disabled={holdReason.trim().length < 3}
              onClick={() => void holdRequest()}
            >
              Put on hold
            </Button>
          </>
        }
      >
        <Field label="Reason" required hint="At least 3 characters. Recorded in the audit transcript.">
          <Textarea value={holdReason} onChange={(event) => setHoldReason(event.target.value)} rows={3} maxLength={500} />
        </Field>
      </Modal>

      <Modal
        open={Boolean(decision)}
        onClose={() => setDecision(null)}
        title={decision === 'approve' ? 'Approve this request?' : 'Reject this request?'}
        description={
          decision === 'approve'
            ? `${money(request.amount)} DonutSMP money will be ${
                request.kind === 'deposit' ? 'added to' : 'removed from'
              } ${request.requester.username}'s wallet immediately.`
            : 'The requester will see your reason in the request thread and notification.'
        }
        size="md"
        dismissible={!decisionBusy}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDecision(null)} disabled={decisionBusy}>
              Back
            </Button>
            <Button
              variant={decision === 'approve' ? 'primary' : 'danger'}
              loading={decisionBusy}
              onClick={() => void submitDecision()}
            >
              {decision === 'approve' ? 'Approve & settle' : 'Reject request'}
            </Button>
          </>
        }
      >
        {decisionError && <Alert tone="error" className="mb-4">{decisionError}</Alert>}
        <Field
          label={decision === 'approve' ? 'Note (optional)' : 'Reason'}
          htmlFor="decision-reason"
          error={decisionFields.reason}
          hint={
            decision === 'approve'
              ? 'Shown to the requester and recorded in the audit log.'
              : 'At least 5 characters. Shown to the requester.'
          }
        >
          <Textarea
            id="decision-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={1000}
            invalid={Boolean(decisionFields.reason)}
            placeholder={decision === 'approve' ? 'Optional note' : 'Why is this request being rejected?'}
          />
        </Field>
      </Modal>
    </div>
  );
}
