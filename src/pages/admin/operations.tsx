import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCopy,
  Coins,
  Filter,
  KeyRound,
  Landmark,
  LifeBuoy,
  Plus,
  Search,
  ShieldCheck,
  UserCog,
  Users,
} from 'lucide-react';
import {
  ROLE_LABELS,
  TICKET_STATUS_LABELS,
  roleHasPermission,
  type LedgerEntry,
  type Paginated,
  type Role,
  type StaffMember,
  type TicketCounts,
  type TicketPriority,
} from '../../../shared/types';
import { useApiQuery } from '../../lib/useApi';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { money, dateTime, timeAgo, titleCase } from '../../lib/format';
import { PageHeader } from '../../components/layout';
import { TicketTable } from '../../components/tickets';
import {
  AccountStatusBadge,
  Alert,
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
  RoleBadge,
  Select,
  Skeleton,
  StatusBadge,
  TableWrap,
  Td,
  Textarea,
  Th,
  Tr,
  cn,
} from '../../components/ui';

/* ------------------------------- staff ----------------------------------- */

interface StaffRow extends StaffMember {
  resolvedLast7Days: number;
  actionsLast7Days: number;
}

export function AdminStaffPage() {
  const { user: me } = useAuth();
  const { success, error: toastError } = useToast();
  const query = useApiQuery<{ staff: StaffRow[] }>('/admin/staff');
  const [createOpen, setCreateOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('support');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<{ username: string; temporaryPassword: string } | null>(null);

  const staff = query.data?.staff ?? [];
  const roles: Role[] = me?.role === 'owner' ? ['support', 'moderator', 'admin'] : ['support', 'moderator'];

  const submit = async () => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const result = await api.post<{ user: { username: string }; temporaryPassword: string }>('/admin/staff', {
        username,
        email,
        role,
        reason: reason || undefined,
      });
      setCreated({ username: result.user.username, temporaryPassword: result.temporaryPassword });
      setCreateOpen(false);
      setUsername('');
      setEmail('');
      setRole('support');
      setReason('');
      success('Staff account created');
      query.refetch();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fieldErrors);
    } finally {
      setBusy(false);
    }
  };

  const copyPassword = () => {
    if (!created) return;
    void navigator.clipboard?.writeText(created.temporaryPassword).then(
      () => success('Temporary password copied'),
      () => toastError('Copy failed', 'Select the password and copy it manually.'),
    );
  };

  return (
    <div>
      <PageHeader
        title="Staff & roles"
        description="Provision staff accounts, review workload, and manage role-based access."
        actions={
          <>
            <Link to="/admin/audit">
              <Button variant="ghost">Audit log</Button>
            </Link>
            <Button variant="primary" onClick={() => { setError(null); setFields({}); setCreateOpen(true); }} leftIcon={<Plus className="h-4 w-4" />}>
              Create staff account
            </Button>
          </>
        }
      />

      {query.error && <Alert tone="error" className="mb-4">{query.error}</Alert>}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Staff accounts', value: staff.length, icon: Users },
          { label: 'Open ownership', value: staff.reduce((sum, member) => sum + member.assignedOpen, 0), icon: LifeBuoy },
          { label: 'Resolved · 7d', value: staff.reduce((sum, member) => sum + member.resolvedLast7Days, 0), icon: CheckCircle2 },
          { label: 'Tickets actions · 7d', value: staff.reduce((sum, member) => sum + member.actionsLast7Days, 0), icon: ShieldCheck },
        ].map((stat) => (
          <Card key={stat.label} className="p-4">
            <div className="flex items-start justify-between">
              <p className="text-[10px] font-medium uppercase tracking-[0.09em] text-faint">{stat.label}</p>
              <stat.icon className="h-3.5 w-3.5 text-gold" />
            </div>
            <p className="mt-2.5 font-display text-[22px] font-semibold leading-none tnum">{stat.value}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader
          title="Staff roster"
          description="Workload and recent output. Select a row to open the account record."
          action={<Badge tone="neutral">{staff.length} {staff.length === 1 ? 'account' : 'accounts'}</Badge>}
        />
        {query.loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : staff.length === 0 ? (
          <EmptyState icon={<Users className="h-5 w-5" />} title="No staff accounts" description="Create a support or moderator account to start handling tickets." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Agent</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th className="text-right">Open</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Resolved · 7d</Th>
                <Th className="text-right">Actions · 7d</Th>
                <Th>Last activity</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {staff.map((member) => (
                <tr
                  key={member.id}
                  className="cursor-pointer border-b border-line/70 transition-colors hover:bg-surface-2/70"
                  onClick={() => (window.location.href = `/admin/users/${member.id}`)}
                >
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={member.username} size={30} />
                      <div>
                        <p className="text-[12.5px] font-medium text-ink">{member.username}</p>
                        <p className="text-[10.5px] text-faint">{member.email}</p>
                      </div>
                    </div>
                  </Td>
                  <Td><RoleBadge role={member.role} /></Td>
                  <Td><AccountStatusBadge status={member.status} /></Td>
                  <Td className="text-right tnum">{member.assignedOpen}</Td>
                  <Td className="text-right tnum">{member.assignedTotal}</Td>
                  <Td className="text-right tnum text-success">{member.resolvedLast7Days}</Td>
                  <Td className="text-right tnum">{member.actionsLast7Days}</Td>
                  <Td className="whitespace-nowrap text-[11px]">{timeAgo(member.lastActivityAt)}</Td>
                  <Td className="text-right"><ArrowUpRight className="ml-auto h-3.5 w-3.5 text-faint" /></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <p className="mt-4 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-faint">
        <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
        Roles are enforced on the server. You cannot create a role at or above your own, modify your own account, or
        remove the last active owner. Staff account creation generates a one-time temporary password; deliver it
        securely and require the agent to change it.
      </p>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create a staff account"
        description="The account is active immediately and receives a generated temporary password."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => void submit()} disabled={!username || !email}>
              Create account
            </Button>
          </>
        }
      >
        {error && <Alert tone="error" className="mb-4">{error}</Alert>}
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Username" error={fields.username}>
              <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="agent_name" invalid={Boolean(fields.username)} />
            </Field>
            <Field label="Email" error={fields.email}>
              <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="agent@example.com" invalid={Boolean(fields.email)} />
            </Field>
          </div>
          <Field label="Role" hint="You can only assign roles below your own.">
            <Select value={role} onChange={(event) => setRole(event.target.value as Role)}>
              {roles.map((value) => (
                <option key={value} value={value}>{ROLE_LABELS[value]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Reason (optional)" hint="Recorded in the audit log.">
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={300} />
          </Field>
          <Alert tone="warning" title="Share the password securely">
            The temporary password is shown once after creation. Staff wallets start at zero and can be funded through the
            Cashier or an approved administrator adjustment.
          </Alert>
        </div>
      </Modal>

      <Modal
        open={Boolean(created)}
        onClose={() => setCreated(null)}
        title="Staff account created"
        description="Copy this temporary password now. It will not be shown again."
        size="sm"
        footer={<Button variant="primary" onClick={() => setCreated(null)}>Done</Button>}
      >
        {created && (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-surface-2 p-4">
              <p className="text-[10px] uppercase tracking-wider text-faint">Username</p>
              <p className="font-display text-[15px] font-semibold text-ink">{created.username}</p>
              <p className="mt-3 text-[10px] uppercase tracking-wider text-faint">Temporary password</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 break-all rounded-lg border border-gold/20 bg-gold/5 px-2.5 py-1.5 font-mono text-[12px] text-gold-bright">
                  {created.temporaryPassword}
                </code>
                <Button size="sm" variant="secondary" onClick={copyPassword} leftIcon={<ClipboardCopy className="h-3.5 w-3.5" />}>
                  Copy
                </Button>
              </div>
            </div>
            <Alert tone="warning">
              Deliver this through a secure channel. The agent should change it from Settings after signing in.
            </Alert>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ------------------------------- tickets --------------------------------- */

export function AdminTicketsPage() {
  const countsQuery = useApiQuery<{ counts: TicketCounts }>('/tickets?pageSize=1');
  const counts = countsQuery.data?.counts;

  return (
    <div>
      <PageHeader
        title="Support desk"
        description="Platform-wide ticket oversight and assignment health. Money requests are handled in the Cashier."
        actions={
          <>
            <Link to="/staff/inbox">
              <Button variant="secondary" leftIcon={<LifeBuoy className="h-4 w-4" />}>Open staff inbox</Button>
            </Link>
            <Link to="/staff/activity">
              <Button variant="ghost">Staff activity</Button>
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'All tickets', value: counts?.all, hint: 'Lifetime conversations', tone: 'text-ink' },
          { label: 'Open work', value: counts?.open, hint: 'New + open + in progress', tone: 'text-success' },
          { label: 'Unassigned', value: counts?.unassigned, hint: 'Awaiting an owner', tone: 'text-warning' },
          { label: 'Waiting for user', value: counts?.waitingUser, hint: 'Blocked on requester', tone: 'text-violet' },
          { label: 'New', value: counts?.new, hint: 'First handling pending', tone: 'text-info' },
          { label: 'On hold', value: counts?.onHold, hint: 'Paused with reason', tone: 'text-warning' },
          { label: 'Resolved', value: counts?.resolved, hint: 'Awaiting final closure', tone: 'text-success' },
          { label: 'Closed / rejected', value: (counts?.closed ?? 0) + (counts?.rejected ?? 0), hint: `${counts?.closed ?? 0} closed · ${counts?.rejected ?? 0} rejected`, tone: 'text-muted' },
        ].map((stat) => (
          <Card key={stat.label} className="p-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.09em] text-faint">{stat.label}</p>
            <p className={cn('mt-2 font-display text-[22px] font-semibold leading-none tnum', stat.tone)}>{stat.value ?? '—'}</p>
            <p className="mt-1.5 text-[10.5px] text-faint">{stat.hint}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-5 overflow-hidden border-gold/20">
        <div className="flex flex-col gap-4 bg-gradient-to-br from-gold/[0.07] via-transparent to-transparent p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-gold/25 bg-gold/10 text-gold">
              <Landmark className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[13px] font-semibold text-ink">Money requests are handled in the Cashier</p>
              <p className="mt-1 max-w-2xl text-[11.5px] leading-relaxed text-muted">
                Deposits, withdrawals, and all money requests now have a dedicated review queue with ledger-backed
                decisions. Support tickets only cover account, game, wallet-ledger, and technical issues.
              </p>
            </div>
          </div>
          <Link to="/admin/cashier" className="shrink-0">
            <Button variant="primary" leftIcon={<Landmark className="h-4 w-4" />}>Open cashier queue</Button>
          </Link>
        </div>
      </Card>

      <div className="mt-5">
        <h2 className="mb-3 font-display text-lg font-semibold text-ink">All tickets</h2>
        <TicketTable mode="admin" />
      </div>
    </div>
  );
}

/* ------------------------------- economy --------------------------------- */

interface EconomyResponse {
  circulation: number;
  byType: { type: string; count: number; total: number }[];
  reconcile: { userId: string; username: string; walletBalance: number; ledgerTotal: number; difference: number }[];
  recentAdjustments: {
    id: string;
    amount: number;
    reason: string | null;
    createdAt: string;
    balanceAfter: number;
    target: string;
    actor: string | null;
  }[];
}

export const ledgerTypeLabels: Record<string, string> = {
  initial_grant: 'Welcome grant',
  admin_adjustment: 'Admin adjustment',
  game_wager: 'Game wager',
  game_payout: 'Game payout',
  game_refund: 'Game refund',
  credit_request: 'Money credited',
  reversal: 'Reversal',
};

export function AdminEconomyPage() {
  const query = useApiQuery<EconomyResponse>('/admin/economy');
  const data = query.data;
  const granted = data?.byType.find((entry) => entry.type === 'initial_grant')?.total ?? 0;
  const approved = data?.byType.find((entry) => entry.type === 'credit_request')?.total ?? 0;
  const adjusted = data?.byType.find((entry) => entry.type === 'admin_adjustment')?.total ?? 0;
  const wagers = -(data?.byType.find((entry) => entry.type === 'game_wager')?.total ?? 0);
  const payouts = data?.byType.find((entry) => entry.type === 'game_payout')?.total ?? 0;

  return (
    <div>
      <PageHeader
        title="Economy"
        description="Circulation, flow by transaction type, reconciliation, and administrative corrections."
        actions={
          <Link to="/admin/transactions">
            <Button variant="secondary" leftIcon={<Coins className="h-4 w-4" />}>Open ledger</Button>
          </Link>
        }
      />

      {query.error && <Alert tone="error" className="mb-4">{query.error}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total circulation', value: data?.circulation, hint: 'Sum of stored wallet balances', tone: 'text-gold' },
          { label: 'Welcome grants', value: granted, hint: 'Initial money grant', tone: 'text-ink' },
          { label: 'Money credited', value: approved, hint: 'Approved deposits and legacy requests', tone: 'text-success' },
          { label: 'Admin adjustments', value: adjusted, hint: 'Net manual corrections', tone: adjusted < 0 ? 'text-danger' : 'text-ink' },
        ].map((stat) => (
          <Card key={stat.label} className="p-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.09em] text-faint">{stat.label}</p>
            <p className={cn('mt-2 font-display text-[22px] font-semibold leading-none tnum', stat.tone)}>
              {stat.value === undefined ? '—' : money(stat.value)}
            </p>
            <p className="mt-1.5 text-[10.5px] text-faint">{stat.hint}</p>
          </Card>
        ))}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Reconciliation" description="Wallet balances vs. the sum of ledger entries." />
          <div className="p-5">
            {query.loading ? (
              <LoadingBlock label="Reconciling wallets" />
            ) : (data?.reconcile.length ?? 0) === 0 ? (
              <div className="flex items-start gap-3 rounded-xl border border-success/25 bg-success/5 p-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                <div>
                  <p className="text-[13px] font-medium text-success">Every wallet reconciles</p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                    Stored balances match the append-only ledger for all accounts. No manual intervention is required.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Alert tone="error" title="Reconciliation mismatch">
                  {data!.reconcile.length} wallet(s) differ from the ledger. Investigate before adjusting balances.
                </Alert>
                <TableWrap>
                  <thead>
                    <tr>
                      <Th>User</Th>
                      <Th className="text-right">Wallet</Th>
                      <Th className="text-right">Ledger</Th>
                      <Th className="text-right">Difference</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.reconcile.map((row) => (
                      <Tr key={row.userId}>
                        <Td className="text-ink">{row.username}</Td>
                        <Td className="text-right tnum">{money(row.walletBalance)}</Td>
                        <Td className="text-right tnum">{money(row.ledgerTotal)}</Td>
                        <Td className="text-right tnum text-danger">{money(row.difference)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </TableWrap>
              </div>
            )}
            <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-3">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-faint">Wagers</p>
                <p className="mt-1 font-display text-[16px] font-semibold tnum">{money(wagers)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-faint">Payouts</p>
                <p className="mt-1 font-display text-[16px] font-semibold tnum">{money(payouts)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-faint">House hold</p>
                <p className="mt-1 font-display text-[16px] font-semibold tnum">{money(wagers - payouts)}</p>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Ledger flow by type" description="Aggregate amounts, including signed values." />
          <TableWrap>
            <thead>
              <tr>
                <Th>Type</Th>
                <Th className="text-right">Entries</Th>
                <Th className="text-right">Net amount</Th>
              </tr>
            </thead>
            <tbody>
              {(data?.byType ?? []).map((entry) => (
                <Tr key={entry.type}>
                  <Td className="text-ink">{ledgerTypeLabels[entry.type] ?? titleCase(entry.type)}</Td>
                  <Td className="text-right tnum">{entry.count}</Td>
                  <Td className={cn('text-right font-medium tnum', entry.total < 0 ? 'text-danger' : 'text-success')}>
                    {entry.total > 0 ? '+' : ''}{money(entry.total)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
          <p className="border-t border-line px-4 py-3 text-[10px] leading-relaxed text-faint">
            Negative amounts are outflows (wagers or deductions). Payouts and grants are inflows. The ledger is
            append-only; corrections create new entries.
          </p>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Money requests" description="Every deposit and withdrawal is reviewed in the Cashier." />
          <div className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-gold/20 bg-gold/8 text-gold">
                <Landmark className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[12.5px] font-medium text-ink">Cashier-only review queue</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  Support tickets no longer accept or approve money requests. Historical ticket requests remain visible as
                  read-only records.
                </p>
              </div>
            </div>
            <Link to="/admin/cashier" className="shrink-0">
              <Button size="sm" variant="secondary" leftIcon={<Landmark className="h-3.5 w-3.5" />}>Open queue</Button>
            </Link>
          </div>
        </Card>

        <Card>
          <CardHeader title="Recent administrative adjustments" description="Signed corrections with actor and reason." />
          {(data?.recentAdjustments.length ?? 0) === 0 ? (
            <EmptyState icon={<Coins className="h-5 w-5" />} title="No adjustments" description="Manual balance corrections will appear here." />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Target</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Actor</Th>
                  <Th>Reason</Th>
                  <Th>Date</Th>
                </tr>
              </thead>
              <tbody>
                {data!.recentAdjustments.map((entry) => (
                  <Tr key={entry.id}>
                    <Td className="text-ink">{entry.target}</Td>
                    <Td className={cn('text-right font-semibold tnum', entry.amount < 0 ? 'text-danger' : 'text-success')}>
                      {entry.amount > 0 ? '+' : ''}{money(entry.amount)}
                    </Td>
                    <Td>{entry.actor ?? 'System'}</Td>
                    <Td className="max-w-[180px] truncate">{entry.reason ?? '—'}</Td>
                    <Td className="whitespace-nowrap text-[11px]">{dateTime(entry.createdAt)}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------ transactions ------------------------------ */

interface AdminTransactionsResponse extends Paginated<LedgerEntry> {
  totals: { inflow: number; outflow: number; net: number };
}

const LEDGER_TYPES = ['initial_grant', 'admin_adjustment', 'game_wager', 'game_payout', 'game_refund', 'credit_request', 'reversal'];

export function AdminTransactionsPage() {
  const [type, setType] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<LedgerEntry | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const params = useMemo(() => {
    const value = new URLSearchParams();
    value.set('page', String(page));
    value.set('pageSize', '25');
    if (type) value.set('type', type);
    if (search) value.set('q', search);
    if (from) value.set('from', `${from}T00:00:00.000Z`);
    if (to) value.set('to', `${to}T23:59:59.999Z`);
    return value.toString();
  }, [page, type, search, from, to]);

  const query = useApiQuery<AdminTransactionsResponse>(`/admin/transactions?${params}`);
  const hasFilters = Boolean(type || search || from || to);

  return (
    <div>
      <PageHeader
        title="Transaction ledger"
        description="The platform-wide, append-only record of every DonutSMP money movement."
        actions={
          <Link to="/admin/economy">
            <Button variant="secondary" leftIcon={<Coins className="h-4 w-4" />}>Economy overview</Button>
          </Link>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Inflow (filtered)', value: query.data?.totals.inflow, tone: 'text-success' },
          { label: 'Outflow (filtered)', value: query.data?.totals.outflow, tone: 'text-danger' },
          { label: 'Net (filtered)', value: query.data?.totals.net, tone: 'text-ink' },
        ].map((stat) => (
          <Card key={stat.label} className="p-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.09em] text-faint">{stat.label}</p>
            <p className={cn('mt-2 font-display text-[22px] font-semibold leading-none tnum', stat.tone)}>
              {stat.value === undefined ? '—' : money(stat.value)}
            </p>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end gap-2.5 border-b border-line p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search user, transaction, or reference" className="pl-9" />
          </div>
          <Field className="w-[170px]">
            <Select value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}>
              <option value="">All types</option>
              {LEDGER_TYPES.map((value) => (
                <option key={value} value={value}>{ledgerTypeLabels[value] ?? titleCase(value)}</option>
              ))}
            </Select>
          </Field>
          <Field className="w-[150px]">
            <Input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} aria-label="From date" />
          </Field>
          <Field className="w-[150px]">
            <Input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} aria-label="To date" />
          </Field>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => { setType(''); setSearchInput(''); setSearch(''); setFrom(''); setTo(''); setPage(1); }}>
              Reset
            </Button>
          )}
          <span className="ml-auto flex items-center gap-1 text-[10.5px] text-faint"><Filter className="h-3 w-3" /> {query.data?.total ?? 0} entries</span>
        </div>

        {query.error ? (
          <div className="p-4"><Alert tone="error">{query.error}</Alert></div>
        ) : query.loading ? (
          <LoadingBlock label="Loading ledger" />
        ) : (query.data?.items.length ?? 0) === 0 ? (
          <EmptyState icon={<Coins className="h-5 w-5" />} title="No matching ledger entries" description="Adjust the filters or search term." />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Transaction</Th>
                  <Th>User</Th>
                  <Th>Type</Th>
                  <Th className="text-right">Amount</Th>
                  <Th className="text-right">After</Th>
                  <Th>Actor</Th>
                  <Th>Reference</Th>
                  <Th>Date</Th>
                </tr>
              </thead>
              <tbody>
                {query.data!.items.map((entry) => (
                  <Tr key={entry.id} onClick={() => setSelected(entry)}>
                    <Td className="font-mono text-[10.5px]">{entry.id}</Td>
                    <Td className="text-[12px] text-ink">{entry.username ?? entry.userId}</Td>
                    <Td className="whitespace-nowrap text-[11.5px]">{ledgerTypeLabels[entry.type] ?? titleCase(entry.type)}</Td>
                    <Td className={cn('text-right font-semibold tnum', entry.amount < 0 ? 'text-danger' : 'text-success')}>
                      {entry.amount > 0 ? '+' : ''}{money(entry.amount)}
                    </Td>
                    <Td className="text-right tnum">{money(entry.balanceAfter)}</Td>
                    <Td className="text-[11px]">{entry.actorName ?? 'System'}</Td>
                    <Td className="font-mono text-[10px]">{entry.refType ?? '—'}</Td>
                    <Td className="whitespace-nowrap text-[10.5px]">{dateTime(entry.createdAt)}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination page={query.data!.page} totalPages={query.data!.totalPages} total={query.data!.total} onPage={setPage} unit="entries" />
          </>
        )}
      </Card>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Ledger entry"
        description={selected ? ledgerTypeLabels[selected.type] ?? titleCase(selected.type) : undefined}
        size="md"
        footer={<Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>}
      >
        {selected && (
          <dl className="space-y-2.5 text-[12px]">
            {[
              ['Transaction', selected.id],
              ['User', selected.username ?? selected.userId],
              ['Amount', `${selected.amount > 0 ? '+' : ''}${money(selected.amount)} money`],
              ['Balance before', `${money(selected.balanceBefore)} money`],
              ['Balance after', `${money(selected.balanceAfter)} money`],
              ['Actor', selected.actorName ?? 'System'],
              ['Reason', selected.reason ?? '—'],
              ['Reference type', selected.refType ?? '—'],
              ['Reference ID', selected.refId ?? '—'],
              ['Timestamp', dateTime(selected.createdAt)],
            ].map(([label, value], index) => (
              <div key={index} className="flex items-start justify-between gap-4 border-b border-line/60 pb-2 last:border-0">
                <dt className="text-muted">{label}</dt>
                <dd className="break-all text-right text-ink">{value}</dd>
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
    </div>
  );
}
