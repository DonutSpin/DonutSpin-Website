import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  Info,
  Landmark,
  MessageSquare,
  Plus,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import type {
  CashierCounts,
  CashierRequestDetail,
  CashierRequestKind,
  CashierRequestSummary,
  CashierRequestStatus,
} from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useApiQuery } from '../lib/useApi';
import { api, ApiRequestError, errorMessage } from '../lib/api';
import { money, dateTime, timeAgo } from '../lib/format';
import { PageHeader } from '../components/layout';
import {
  CASHIER_KIND_LABELS,
  CashierKindIcon,
  CashierStatusBadge,
  CashierThread,
} from '../components/cashier';
import {
  Alert,
  AmountInput,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Pagination,
  StatCard,
  Tabs,
  cn,
} from '../components/ui';

interface CashierListResponse {
  items: CashierRequestSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  counts: CashierCounts;
  balance: number;
  requestLimit: number;
}

const STATUS_TABS: { key: CashierRequestStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All requests' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'cancelled', label: 'Cancelled' },
];

function statusCount(counts: CashierCounts | undefined, key: CashierRequestStatus | 'all'): number | undefined {
  if (!counts) return undefined;
  if (key === 'all') return counts.all;
  return counts[key];
}

export function CashierPage() {
  const { user, config } = useAuth();
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();
  const [status, setStatus] = useState<CashierRequestStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const query = useApiQuery<CashierListResponse>(
    `/cashier?status=${status}&page=${page}&pageSize=12`,
  );

  const data = query.data;
  const limit = data?.requestLimit ?? 50_000;
  // The shared auth balance is kept current in the background, so prefer it
  // over the snapshot returned with the request list.
  const balance = user?.balance ?? data?.balance ?? 0;

  return (
    <div>
      <PageHeader
        title="Cashier"
        description="Request a DonutSMP money deposit or withdrawal. Owners and administrators review every amount."
        actions={
          <Button
            variant="primary"
            onClick={() => setCreateOpen(true)}
            leftIcon={<Plus className="h-4 w-4" />}
            disabled={Boolean(config?.maintenance)}
          >
            New request
          </Button>
        }
      />

      <Alert tone="info" className="mb-5" title="The only place to request DonutSMP money">
        Deposits add money to your wallet; withdrawals remove it. Every request, including corrections, is reviewed by
        an owner or administrator here. Support tickets cannot grant or adjust money.
      </Alert>

      {config?.maintenance && (
        <Alert tone="warning" className="mb-5" title="Maintenance mode">
          New cashier requests are paused while maintenance is active.
        </Alert>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Available balance"
          value={money(balance)}
          hint="DonutSMP money"
          icon={<Wallet className="h-4 w-4" />}
          tone="gold"
        />
        <StatCard
          label="Pending review"
          value={data?.counts.pending ?? '—'}
          hint="Waiting for an owner or admin"
          icon={<Landmark className="h-4 w-4" />}
          tone="warning"
        />
        <StatCard
          label="Approved"
          value={data?.counts.approved ?? '—'}
          hint={`${data?.counts.deposits ?? 0} deposit request${(data?.counts.deposits ?? 0) === 1 ? '' : 's'}`}
          icon={<ShieldCheck className="h-4 w-4" />}
          tone="success"
        />
        <StatCard
          label="Request limit"
          value={money(limit)}
          hint="Maximum money per request"
          icon={<Info className="h-4 w-4" />}
          tone="info"
        />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            items={STATUS_TABS.map((tab) => ({
              ...tab,
              count: statusCount(data?.counts, tab.key),
            }))}
            value={status}
            onChange={(value) => {
              setStatus(value as CashierRequestStatus | 'all');
              setPage(1);
            }}
          />
          <Badge tone="neutral">
            {data?.counts.deposits ?? 0} deposit{(data?.counts.deposits ?? 0) === 1 ? '' : 's'} ·{' '}
            {data?.counts.withdrawals ?? 0} withdrawal{(data?.counts.withdrawals ?? 0) === 1 ? '' : 's'}
          </Badge>
        </div>

        {query.loading ? (
          <LoadingBlock label="Loading cashier requests" />
        ) : query.error ? (
          <div className="p-4">
            <Alert tone="error">{query.error}</Alert>
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={<Landmark className="h-5 w-5" />}
            title={status === 'all' ? 'No cashier requests yet' : `No ${status} requests`}
            description="Open a deposit or withdrawal request with just an amount. You can message the review team in the request thread."
            action={
              <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)} disabled={Boolean(config?.maintenance)}>
                Open a request
              </Button>
            }
          />
        ) : (
          <>
            <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {data.items.map((request) => (
                <Link key={request.id} to={`/cashier/${request.reference}`} className="group block">
                  <Card className="h-full p-4 transition-colors group-hover:border-gold/35 group-hover:bg-surface-2/50">
                    <div className="flex items-start justify-between gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface-2">
                        <CashierKindIcon
                          kind={request.kind}
                          className={cn('h-4 w-4', request.kind === 'deposit' ? 'text-success' : 'text-warning')}
                        />
                      </span>
                      <CashierStatusBadge status={request.status} />
                    </div>
                    <p className="mt-3 font-mono text-[10.5px] text-faint">{request.reference}</p>
                    <p className="mt-1 font-display text-[24px] font-semibold leading-none text-ink tnum">
                      {money(request.amount)} <span className="text-[10px] font-medium uppercase tracking-wider text-faint">money</span>
                    </p>
                    <div className="mt-3 flex items-center justify-between gap-2 text-[10.5px] text-faint">
                      <span>{CASHIER_KIND_LABELS[request.kind]}</span>
                      <span className="flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" /> {request.messageCount}
                      </span>
                    </div>
                    <p className="mt-2 border-t border-line/60 pt-2 text-[10.5px] text-faint">
                      Updated {timeAgo(request.lastActivityAt)}
                    </p>
                  </Card>
                </Link>
              ))}
            </div>
            {data.total > 0 && (
              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                total={data.total}
                onPage={setPage}
                unit="requests"
              />
            )}
          </>
        )}
      </Card>

      {createOpen && (
        <NewCashierRequestModal
          limit={limit}
          balance={balance}
          onClose={() => setCreateOpen(false)}
          onCreated={(reference) => {
            setCreateOpen(false);
            success('Request submitted', 'An owner or administrator will review it.');
            query.refetch();
            navigate(`/cashier/${reference}`);
          }}
          onError={(message) => toastError('Could not submit request', message)}
        />
      )}
    </div>
  );
}

function NewCashierRequestModal({
  limit,
  balance,
  onClose,
  onCreated,
  onError,
}: {
  limit: number;
  balance: number;
  onClose: () => void;
  onCreated: (reference: string) => void;
  onError: (message: string) => void;
}) {
  const [kind, setKind] = useState<CashierRequestKind>('deposit');
  const [amount, setAmount] = useState<number | ''>(1_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const parsedAmount = typeof amount === 'number' ? amount : Number.NaN;
  const amountIsValid =
    Number.isInteger(parsedAmount) &&
    parsedAmount > 0 &&
    parsedAmount <= limit &&
    (kind !== 'withdrawal' || parsedAmount <= balance);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!amountIsValid || busy) return;
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const result = await api.post<{ request: CashierRequestDetail }>('/cashier', {
        kind,
        amount: parsedAmount,
      });
      onCreated(result.request.reference);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fieldErrors);
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New cashier request"
      description="Choose an amount and direction. No description is required."
      size="md"
      dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()} disabled={!amountIsValid}>
            Submit request
          </Button>
        </>
      }
    >
      <form onSubmit={(event) => void submit(event)} className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}

        <div className="grid grid-cols-2 gap-2.5">
          {(['deposit', 'withdrawal'] as CashierRequestKind[]).map((option) => {
            const active = kind === option;
            const Icon = option === 'deposit' ? ArrowDownToLine : ArrowUpFromLine;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setKind(option)}
                className={cn(
                  'rounded-xl border p-3.5 text-left transition-colors',
                  active
                    ? 'border-gold/45 bg-gold/10'
                    : 'border-line bg-surface-2/50 hover:border-line-strong hover:bg-surface-2',
                )}
              >
                <Icon className={cn('h-4 w-4', active ? 'text-gold' : 'text-faint')} />
                <p className={cn('mt-2 text-[12.5px] font-medium', active ? 'text-ink' : 'text-muted')}>
                  {CASHIER_KIND_LABELS[option]}
                </p>
                <p className="mt-0.5 text-[10.5px] leading-relaxed text-faint">
                  {option === 'deposit' ? 'Add DonutSMP money' : 'Remove DonutSMP money'}
                </p>
              </button>
            );
          })}
        </div>

        <Field
          label="Amount"
          htmlFor="cashier-amount"
          error={fields.amount}
          hint={
            kind === 'withdrawal'
              ? `Available to withdraw: ${money(balance)}. Maximum per request: ${money(limit)}. Use K, M, B, or T — for example 100k = 100,000.`
              : `Maximum per request: ${money(limit)}. Use K, M, B, or T — for example 100k = 100,000.`
          }
        >
          <AmountInput
            id="cashier-amount"
            min={1}
            max={kind === 'withdrawal' ? Math.min(balance, limit) : limit}
            value={amount}
            onChange={setAmount}
            placeholder="100k"
            invalid={Boolean(fields.amount)}
          />
        </Field>

        <div className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-2/60 px-3.5 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
          <p className="text-[11.5px] leading-relaxed text-muted">
            {kind === 'deposit'
              ? 'If approved, this amount is added to your DonutSMP balance.'
              : 'If approved, this amount is removed from your DonutSMP balance.'}{' '}
            You can send messages to the review team after submitting.
          </p>
        </div>
      </form>
    </Modal>
  );
}

export function CashierDetailPage() {
  const { reference = '' } = useParams();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const query = useApiQuery<{ request: CashierRequestDetail }>(`/cashier/${reference}`);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const request = query.data?.request;

  const sendMessage = async (body: string): Promise<boolean> => {
    if (!request) return false;
    try {
      await api.post(`/cashier/${request.reference}/messages`, { body });
      query.refetch();
      return true;
    } catch (err) {
      toastError('Message not sent', errorMessage(err));
      return false;
    }
  };

  const cancelRequest = async () => {
    if (!request) return;
    setCancelBusy(true);
    try {
      await api.post(`/cashier/${request.reference}/cancel`);
      success('Request cancelled');
      setCancelOpen(false);
      query.refetch();
    } catch (err) {
      toastError('Could not cancel request', errorMessage(err));
    } finally {
      setCancelBusy(false);
    }
  };

  if (query.loading) return <LoadingBlock label="Loading cashier request" />;
  if (query.error || !request) {
    return (
      <div className="mx-auto max-w-md py-12">
        <Alert tone="error">{query.error ?? 'Cashier request not found.'}</Alert>
        <Button className="mt-4" variant="secondary" onClick={() => navigate('/cashier')}>
          Back to cashier
        </Button>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Cashier', to: '/cashier' },
          { label: request.reference },
        ]}
        title={`${CASHIER_KIND_LABELS[request.kind]} request`}
        description={`${money(request.amount)} DonutSMP money · submitted ${dateTime(request.createdAt)}`}
        badge={<CashierStatusBadge status={request.status} />}
        actions={
          <Link to="/cashier">
            <Button variant="secondary" leftIcon={<ArrowLeft className="h-4 w-4" />}>
              All requests
            </Button>
          </Link>
        }
      />

      <Card className="mb-5 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3.5">
            <span className="grid h-12 w-12 place-items-center rounded-xl border border-gold/25 bg-gold/8">
              <CashierKindIcon kind={request.kind} className={cn('h-5 w-5', request.kind === 'deposit' ? 'text-success' : 'text-warning')} />
            </span>
            <div>
              <p className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-faint">
                {CASHIER_KIND_LABELS[request.kind]} request
              </p>
              <p className="mt-1 font-display text-[30px] font-semibold leading-none text-gold-bright tnum">
                {money(request.amount)} <span className="text-[10px] font-medium uppercase tracking-wider text-faint">money</span>
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-mono text-[11px] text-muted">{request.reference}</p>
            <p className="mt-1 text-[10.5px] text-faint">Last activity {timeAgo(request.lastActivityAt)}</p>
          </div>
        </div>
        <div className="border-t border-line bg-surface-2/35 px-5 py-2.5 text-[11px] text-faint">
          {request.status === 'pending'
            ? 'Waiting for an owner or administrator to review this amount. You can still send a message below.'
            : request.status === 'approved'
              ? 'This request was approved and recorded in your ledger.'
              : request.status === 'rejected'
                ? 'This request was not approved. The decision reason is shown on the right.'
                : 'This request was cancelled by you.'}
        </div>
      </Card>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader
            title="Conversation"
            description="Messages between you and the review team."
            action={<Badge tone="neutral">{request.messages.length}</Badge>}
          />
          <div className="p-5">
            <CashierThread
              messages={request.messages}
              currentUserId={request.requester.id}
              canMessage={request.canMessage}
              onSend={sendMessage}
            />
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Request details" />
            <dl className="space-y-3 p-5 text-[12px]">
              {[
                ['Reference', <span className="font-mono text-[11px]">{request.reference}</span>],
                ['Type', CASHIER_KIND_LABELS[request.kind]],
                ['Amount', `${money(request.amount)} money`],
                ['Status', <CashierStatusBadge status={request.status} />],
                ['Requested', dateTime(request.createdAt)],
                ['Reviewer', request.reviewer?.username ?? 'Waiting for review'],
                ['Decided', request.decidedAt ? dateTime(request.decidedAt) : '—'],
              ].map(([label, value], index) => (
                <div key={index} className="flex items-start justify-between gap-3 border-b border-line/60 pb-2.5 last:border-0 last:pb-0">
                  <dt className="text-muted">{label as string}</dt>
                  <dd className="text-right text-ink">{value as React.ReactNode}</dd>
                </div>
              ))}
              {request.decisionReason && (
                <div className="rounded-lg border border-line bg-surface-2/60 p-2.5">
                  <dt className="text-[10px] uppercase tracking-wider text-faint">Decision note</dt>
                  <dd className="mt-1 text-[11.5px] leading-relaxed text-muted">{request.decisionReason}</dd>
                </div>
              )}
              {request.ledgerId && (
                <div className="flex items-start justify-between gap-3 rounded-lg border border-success/20 bg-success/6 p-2.5">
                  <dt className="text-[11px] text-success">Ledger entry</dt>
                  <dd className="break-all text-right font-mono text-[10px] text-success">{request.ledgerId}</dd>
                </div>
              )}
            </dl>
          </Card>

          {request.canCancel && (
            <Card className="p-4">
              <p className="text-[12.5px] font-medium text-ink">Change your mind?</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">
                You can cancel this request while it is still pending. Nothing has moved in your wallet.
              </p>
              <Button className="mt-3 w-full" variant="danger" size="sm" onClick={() => setCancelOpen(true)}>
                Cancel request
              </Button>
            </Card>
          )}

          <div className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-1 p-4">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
            <p className="text-[10.5px] leading-relaxed text-faint">
              Cashier requests are amount-only. Every decision is recorded in the audit log and settled in the
              append-only ledger. Every decision is final and recorded in the audit log.
            </p>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => void cancelRequest()}
        title="Cancel this cashier request?"
        description="The request will stop waiting for review. You can open a new request later."
        confirmLabel="Cancel request"
        tone="danger"
        loading={cancelBusy}
      />
    </div>
  );
}
