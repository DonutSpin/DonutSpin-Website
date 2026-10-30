import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeftRight,
  ArrowUpRight,
  Coins,
  Download,
  Filter,
  Gamepad2,
  Info,
  Landmark,
  ReceiptText,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import type { CashierRequestSummary, LedgerEntry, Paginated } from '../../shared/types';
import {
  CASHIER_KIND_LABELS,
  CashierKindIcon,
  CashierStatusBadge,
} from '../components/cashier';
import { useAuth } from '../context/AuthContext';
import { useApiQuery } from '../lib/useApi';
import { money, dateTime, signedCredits, timeAgo, titleCase } from '../lib/format';
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
  Modal,
  Money,
  Pagination,
  Select,
  StatCard,
  TableWrap,
  Td,
  Th,
  Tr,
  cn,
} from '../components/ui';

interface WalletSummary {
  balance: number;
  lifetimeWagered: number;
  lifetimeWon: number;
  lifetimeGranted: number;
  net: number;
  pendingCashier: number;
  payoutCap: number;
}

function ledgerLabel(type: string): string {
  const labels: Record<string, string> = {
    initial_grant: 'Welcome grant',
    admin_adjustment: 'Admin adjustment',
    game_wager: 'Game wager',
    game_payout: 'Game payout',
    game_refund: 'Game refund',
    credit_request: 'Money credited',
    reversal: 'Reversal',
  };
  return labels[type] ?? titleCase(type);
}

export function TransactionTable({ entries, loading }: { entries: LedgerEntry[]; loading?: boolean }) {
  const [selected, setSelected] = useState<LedgerEntry | null>(null);
  if (loading) return <LoadingBlock label="Loading ledger" />;
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<ReceiptText className="h-5 w-5" />}
        title="No ledger entries"
        description="Every wager, payout, grant, and correction is recorded here permanently. Your first welcome grant will appear as soon as it is issued."
      />
    );
  }
  return (
    <>
      <div className="divide-y divide-line/70 md:hidden">
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setSelected(entry)}
            className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2/60"
          >
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-ink">{ledgerLabel(entry.type)}</p>
              <p className="mt-0.5 truncate font-mono text-[10.5px] text-faint">{entry.id}</p>
              <p className="mt-1 text-[10.5px] text-faint">
                {dateTime(entry.createdAt)} · balance {money(entry.balanceAfter)}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <Money amount={entry.amount} signed size="sm" />
              <p className="mt-1 text-[10px] text-faint">{entry.refType ?? 'ledger'}</p>
            </div>
          </button>
        ))}
      </div>
      <TableWrap className="hidden md:block">
        <thead>
          <tr>
            <Th>Transaction</Th>
            <Th>Type</Th>
            <Th className="text-right">Amount</Th>
            <Th className="text-right">Balance after</Th>
            <Th>Reference</Th>
            <Th>Date</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <Tr key={entry.id} onClick={() => setSelected(entry)}>
              <Td className="font-mono text-[11px] text-muted">{entry.id}</Td>
              <Td>
                <span className="text-[12.5px] text-ink">{ledgerLabel(entry.type)}</span>
              </Td>
              <Td className="text-right">
                <Money amount={entry.amount} signed size="sm" />
              </Td>
              <Td className="text-right tnum text-[12px]">{money(entry.balanceAfter)}</Td>
              <Td>
                <span className="font-mono text-[10.5px] text-faint">{entry.refType ?? '—'}</span>
              </Td>
              <Td className="whitespace-nowrap text-[11.5px]">{dateTime(entry.createdAt)}</Td>
              <Td>
                <Badge tone="success">Completed</Badge>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableWrap>
      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Transaction detail"
        description={selected ? ledgerLabel(selected.type) : undefined}
        size="md"
        footer={
          <Button variant="secondary" onClick={() => setSelected(null)}>
            Close
          </Button>
        }
      >
        {selected && (
          <dl className="space-y-3 text-[12.5px]">
            {[
              ['Transaction ID', <span className="font-mono text-[11px]">{selected.id}</span>],
              ['Type', ledgerLabel(selected.type)],
              ['Amount', <Money amount={selected.amount} signed />],
              ['Balance before', `${money(selected.balanceBefore)} money`],
              ['Balance after', `${money(selected.balanceAfter)} money`],
              ['Reason', selected.reason ?? '—'],
              ['Reference type', selected.refType ?? '—'],
              ['Reference ID', selected.refId ? <span className="font-mono text-[11px] break-all">{selected.refId}</span> : '—'],
              ['Initiated by', selected.actorName ?? 'System'],
              ['Recorded', dateTime(selected.createdAt)],
            ].map(([label, value], index) => (
              <div key={index} className="flex items-start justify-between gap-4 border-b border-line/60 pb-2.5 last:border-0">
                <dt className="shrink-0 text-muted">{label as string}</dt>
                <dd className="text-right text-ink">{value as React.ReactNode}</dd>
              </div>
            ))}
            {selected.metadata && (
              <div>
                <dt className="mb-1 text-muted">Metadata</dt>
                <pre className="overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 text-[10.5px] text-muted">
                  {JSON.stringify(selected.metadata, null, 2)}
                </pre>
              </div>
            )}
          </dl>
        )}
      </Modal>
    </>
  );
}

export function WalletPage() {
  const { user } = useAuth();
  const walletQuery = useApiQuery<WalletSummary>('/me/wallet');
  const cashierQuery = useApiQuery<{ items: CashierRequestSummary[] }>('/cashier?pageSize=4');
  const ledgerQuery = useApiQuery<Paginated<LedgerEntry>>('/me/transactions?pageSize=8');

  const wallet = walletQuery.data;
  const cashierRequests = cashierQuery.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Wallet"
        description="Your DonutSMP money balance and every movement behind it."
        actions={
          <>
            <Link to="/cashier">
              <Button variant="secondary" leftIcon={<Landmark className="h-4 w-4" />}>
                Cashier
              </Button>
            </Link>
            <Link to="/games">
              <Button variant="primary" leftIcon={<Gamepad2 className="h-4 w-4" />}>
                Play
              </Button>
            </Link>
          </>
        }
      />

      {walletQuery.error && (
        <Alert tone="error" className="mb-5">
          {walletQuery.error}
        </Alert>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card className="relative overflow-hidden p-6">
          <div className="absolute inset-0 surface-grid opacity-25" />
          <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gold/10 blur-[80px]" />
          <div className="relative">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
                <Wallet className="h-3.5 w-3.5" /> Available balance
              </span>
              <Badge tone="gold">DonutSMP money</Badge>
            </div>
            <p className="mt-4 font-display text-[46px] font-semibold leading-none tracking-tight text-gold-bright tnum">
              {wallet ? money(wallet.balance) : '—'}
            </p>
            <p className="mt-2 max-w-md text-[11.5px] leading-relaxed text-muted">
              Your DonutSMP money is held in your wallet and reconciled against every game round and cashier decision
              in the append-only ledger.
            </p>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {[
                { label: 'Wagered', value: wallet?.lifetimeWagered ?? 0 },
                { label: 'Payouts', value: wallet?.lifetimeWon ?? 0 },
                { label: 'Game net', value: wallet?.net ?? 0, signed: true },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg border border-line bg-surface-2/50 px-3 py-2.5">
                  <p className="text-[9.5px] font-medium uppercase tracking-[0.1em] text-faint">{stat.label}</p>
                  <p className={cn('mt-1 font-display text-[15px] font-semibold tnum', stat.signed && (stat.value < 0 ? 'text-danger' : 'text-success'))}>
                    {stat.signed ? signedCredits(stat.value) : money(stat.value)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
          <StatCard
            label="Lifetime granted"
            value={wallet ? money(wallet.lifetimeGranted) : '—'}
            hint="Grants and corrections"
            icon={<Coins className="h-4 w-4" />}
            tone="gold"
          />
          <StatCard
            label="Pending requests"
            value={wallet?.pendingCashier ?? '—'}
            hint="Cashier review queue"
            icon={<Info className="h-4 w-4" />}
            tone="warning"
          />
          <StatCard
            label="Payout cap"
            value={wallet ? money(wallet.payoutCap) : '—'}
            hint="Per round platform limit"
            icon={<ShieldCheck className="h-4 w-4" />}
            tone="info"
          />
          <StatCard
            label="Ledger mode"
            value="Immutable"
            hint="Updates and deletes blocked"
            icon={<ArrowLeftRight className="h-4 w-4" />}
            tone="success"
          />
        </div>
      </div>

      <div className="mt-5 grid items-start gap-5">
        <Card>
          <CardHeader
            title="Recent transactions"
            description="Click any row for the full ledger record."
            action={
              <Link to="/transactions" className="flex items-center gap-1 text-[11.5px] font-medium text-gold hover:text-gold-bright">
                Full history <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          <TransactionTable entries={ledgerQuery.data?.items ?? []} loading={ledgerQuery.loading} />
        </Card>

        <Card>
          <CardHeader
            title="Deposits & withdrawals"
            description="Amount-only cashier requests reviewed by owners and administrators."
            action={
              <Link to="/cashier" className="text-[11.5px] font-medium text-gold hover:text-gold-bright">
                Open cashier
              </Link>
            }
          />
          {cashierQuery.loading ? (
            <LoadingBlock label="Loading cashier requests" />
          ) : cashierQuery.error ? (
            <div className="p-4">
              <Alert tone="error">{cashierQuery.error}</Alert>
            </div>
          ) : cashierRequests.length === 0 ? (
            <EmptyState
              icon={<Landmark className="h-5 w-5" />}
              title="No cashier requests"
              description="Deposit or withdraw DonutSMP money with a simple amount request. Owners and administrators review each one."
              action={
                <Link to="/cashier">
                  <Button variant="secondary" size="sm">
                    Open cashier
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="divide-y divide-line/70">
              {cashierRequests.map((request) => (
                <Link
                  key={request.id}
                  to={`/cashier/${request.reference}`}
                  className="block px-5 py-3.5 transition-colors hover:bg-surface-2/60"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-display text-[11px] font-medium text-gold">
                      <CashierKindIcon
                        kind={request.kind}
                        className={request.kind === 'deposit' ? 'h-3.5 w-3.5 text-success' : 'h-3.5 w-3.5 text-warning'}
                      />
                      {request.reference}
                    </span>
                    <CashierStatusBadge status={request.status} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <p className="truncate text-[12.5px] text-ink">
                      {CASHIER_KIND_LABELS[request.kind]} request
                    </p>
                    <span className="shrink-0 font-display text-[13px] font-semibold text-ink tnum">
                      {money(request.amount)} money
                    </span>
                  </div>
                  <p className="mt-1 text-[10.5px] text-faint">
                    Updated {timeAgo(request.lastActivityAt)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card className="overflow-hidden border-gold/15">
          <div className="flex flex-col gap-4 bg-gradient-to-br from-gold/[0.06] via-transparent to-transparent p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-gold/20 bg-gold/10 text-gold">
                <Landmark className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[12.5px] font-semibold text-ink">Money requests are Cashier-only</p>
                <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-muted">
                  Deposits, withdrawals, and every DonutSMP money request are handled in one place. Support tickets no
                  longer grant or adjust money; historical ticket requests remain visible as read-only records.
                </p>
              </div>
            </div>
            <Link to="/cashier" className="shrink-0">
              <Button variant="secondary" size="sm" leftIcon={<Landmark className="h-3.5 w-3.5" />}>Open Cashier</Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

const LEDGER_TYPES = [
  'initial_grant',
  'admin_adjustment',
  'game_wager',
  'game_payout',
  'game_refund',
  'credit_request',
  'reversal',
];

export function TransactionsPage() {
  const { user } = useAuth();
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', '20');
  if (type) params.set('type', type);
  if (from) params.set('from', `${from}T00:00:00.000Z`);
  if (to) params.set('to', `${to}T23:59:59.999Z`);

  const query = useApiQuery<Paginated<LedgerEntry> & { balance: number }>(`/me/transactions?${params.toString()}`);
  const hasFilters = Boolean(type || from || to);

  return (
    <div>
      <PageHeader
        title="Transactions"
        description="The complete, append-only history of your DonutSMP money balance."
        actions={
          <div className="flex items-center gap-2 rounded-lg border border-gold/20 bg-gold/8 px-3 py-2">
            <Coins className="h-4 w-4 text-gold" />
            <span className="font-display text-[13px] font-semibold text-gold-bright tnum">
              {money(query.data?.balance ?? user?.balance ?? 0)}
            </span>
            <span className="text-[9px] uppercase tracking-wider text-gold-dim">money</span>
          </div>
        }
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <Field label="Type" className="w-full sm:w-48">
            <Select
              value={type}
              onChange={(event) => {
                setType(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All types</option>
              {LEDGER_TYPES.map((value) => (
                <option key={value} value={value}>
                  {ledgerLabel(value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From" className="w-full sm:w-40">
            <Input
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
            />
          </Field>
          <Field label="To" className="w-full sm:w-40">
            <Input
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
            />
          </Field>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setType('');
                setFrom('');
                setTo('');
                setPage(1);
              }}
            >
              Reset filters
            </Button>
          )}
          <div className="ml-auto flex items-center gap-1.5 text-[11px] text-faint">
            <Filter className="h-3.5 w-3.5" /> {query.data?.total ?? 0} records
          </div>
        </div>

        {query.error ? (
          <div className="p-4">
            <Alert tone="error">{query.error}</Alert>
          </div>
        ) : (
          <TransactionTable entries={query.data?.items ?? []} loading={query.loading} />
        )}

        {query.data && query.data.total > 0 && (
          <Pagination page={query.data.page} totalPages={query.data.totalPages} total={query.data.total} onPage={setPage} unit="transactions" />
        )}
      </Card>

      <div className="mt-5 flex items-start gap-3 rounded-xl border border-line bg-surface-1 p-4">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
        <div>
          <p className="text-[12.5px] font-medium text-ink">Ledger integrity</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
            Ledger entries are append-only: database triggers block updates and deletions. Corrections are written as
            new traceable entries instead of editing history. Your balance is continuously reconcilable against the sum
            of these records.
          </p>
        </div>
      </div>
    </div>
  );
}
