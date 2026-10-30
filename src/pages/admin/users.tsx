import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUpRight,
  Coins,
  Gamepad2,
  KeyRound,
  LifeBuoy,
  Lock,
  Mail,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCog,
  Users,
} from 'lucide-react';
import {
  ROLE_LABELS,
  ROLE_RANK,
  TICKET_STATUS_LABELS,
  roleHasPermission,
  type LedgerEntry,
  type Paginated,
  type Role,
  type TicketPriority,
  type TicketStatus,
  type SessionUser,
} from '../../../shared/types';
import { useApiQuery } from '../../lib/useApi';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { money, dateTime, timeAgo, titleCase } from '../../lib/format';
import { PageHeader } from '../../components/layout';
import { TransactionTable } from '../wallet';
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
  RoleBadge,
  Select,
  Skeleton,
  StatusBadge,
  TableWrap,
  Tabs,
  Td,
  Textarea,
  Th,
  Tr,
  cn,
} from '../../components/ui';

interface AdminUserRow {
  id: string;
  username: string;
  email: string;
  role: Role;
  status: string;
  balance: number;
  createdAt: string;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  openTickets: number;
}

interface UserDetailResponse {
  user: {
    id: string;
    username: string;
    email: string;
    role: Role;
    status: string;
    emailVerified: boolean;
    balance: number;
    createdAt: string;
    updatedAt: string;
    lastLoginAt: string | null;
    lastSeenAt: string | null;
    restrictionReason: string | null;
  };
  stats: { sessions: number; wagered: number; won: number };
  ledger: LedgerEntry[];
  tickets: {
    id: string;
    reference: string;
    subject: string;
    categoryLabel: string;
    status: TicketStatus;
    priority: TicketPriority;
    createdAt: string;
    lastActivityAt: string;
  }[];
  gameSessions: { id: string; game: string; bet: number; payout: number; status: string; createdAt: string }[];
  creditRequests: {
    id: string;
    amount: number;
    kind: string;
    status: string;
    createdAt: string;
    decidedAt: string | null;
    reference: string;
    reviewer: string | null;
  }[];
  audit: { id: string; action: string; target_label: string | null; reason: string | null; createdAt?: string; created_at: string; actor_name: string | null }[];
  activeSessions: number;
}

export function AdminUsersPage() {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('created');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const params = new URLSearchParams();
  if (search) params.set('q', search);
  if (role) params.set('role', role);
  if (status) params.set('status', status);
  params.set('sort', sort);
  params.set('page', String(page));
  params.set('pageSize', '20');

  const query = useApiQuery<Paginated<AdminUserRow>>(`/admin/users?${params.toString()}`);

  return (
    <div>
      <PageHeader
        title="Users"
        description="Search every account, inspect wallets and tickets, and apply permission-checked actions."
        actions={
          <Link to="/admin/staff">
            <Button variant="secondary" leftIcon={<Users className="h-4 w-4" />}>
              Staff & roles
            </Button>
          </Link>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end gap-2.5 border-b border-line p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search username, email, or user ID"
              className="pl-9"
            />
          </div>
          <Field className="w-[140px]">
            <Select value={role} onChange={(event) => { setRole(event.target.value); setPage(1); }}>
              <option value="">All roles</option>
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field className="w-[140px]">
            <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="restricted">Restricted</option>
              <option value="suspended">Suspended</option>
            </Select>
          </Field>
          <Field className="w-[168px]">
            <Select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>
              <option value="created">Newest accounts</option>
              <option value="balance">Highest balance</option>
              <option value="activity">Recent activity</option>
              <option value="username">Username A–Z</option>
            </Select>
          </Field>
          {(search || role || status) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchInput('');
                setSearch('');
                setRole('');
                setStatus('');
                setPage(1);
              }}
            >
              Reset
            </Button>
          )}
        </div>

        {query.error ? (
          <div className="p-4">
            <Alert tone="error">{query.error}</Alert>
          </div>
        ) : query.loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : (query.data?.items ?? []).length === 0 ? (
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title="No users match"
            description="Try a different search term or clear the role and status filters."
          />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>User</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Balance</Th>
                  <Th className="text-right">Open tickets</Th>
                  <Th>Joined</Th>
                  <Th>Last activity</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {query.data!.items.map((row) => (
                  <Tr key={row.id} onClick={() => navigate(`/admin/users/${row.id}`)}>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={row.username} size={30} />
                        <div className="min-w-0">
                          <p className="truncate text-[12.5px] font-medium text-ink">{row.username}</p>
                          <p className="truncate text-[10.5px] text-faint">{row.email}</p>
                        </div>
                      </div>
                    </Td>
                    <Td><RoleBadge role={row.role} /></Td>
                    <Td><AccountStatusBadge status={row.status as SessionUser['status']} /></Td>
                    <Td className="text-right font-display text-[12.5px] font-semibold text-ink tnum">{money(row.balance)}</Td>
                    <Td className="text-right tnum text-[12px]">{row.openTickets}</Td>
                    <Td className="whitespace-nowrap text-[11px]">{dateTime(row.createdAt)}</Td>
                    <Td className="whitespace-nowrap text-[11px]">{timeAgo(row.lastSeenAt ?? row.lastLoginAt)}</Td>
                    <Td className="text-right">
                      <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-faint" />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-[11px] text-faint tnum">{query.data!.total.toLocaleString()} accounts</p>
              <div className="flex gap-1.5">
                <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                  Previous
                </Button>
                <Button size="sm" variant="ghost" disabled={page >= query.data!.totalPages} onClick={() => setPage((value) => value + 1)}>
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

export function AdminUserDetailPage() {
  const { id = '' } = useParams();
  const { user: me } = useAuth();
  const { success, error: toastError } = useToast();
  const query = useApiQuery<UserDetailResponse>(`/admin/users/${id}`);
  const [tab, setTab] = useState('ledger');
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState<number | ''>('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustRequestId, setAdjustRequestId] = useState('');
  const [roleOpen, setRoleOpen] = useState(false);
  const [nextRole, setNextRole] = useState<Role>('user');
  const [roleReason, setRoleReason] = useState('');
  const [statusOpen, setStatusOpen] = useState(false);
  const [nextStatus, setNextStatus] = useState<'active' | 'restricted' | 'suspended'>('active');
  const [statusReason, setStatusReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const target = query.data?.user;
  const data = query.data;

  useEffect(() => {
    if (target) {
      setNextRole(target.role);
      setNextStatus(target.status as 'active' | 'restricted' | 'suspended');
    }
  }, [target]);

  const allowedRoles = useMemo<Role[]>(() => {
    if (!me) return [];
    if (me.role === 'owner') return ['user', 'support', 'moderator', 'admin', 'owner'];
    return (['user', 'support', 'moderator'] as Role[]).filter((role) => ROLE_RANK[role] < ROLE_RANK[me.role]);
  }, [me]);

  if (query.loading) return <LoadingBlock label="Loading user record" />;
  if (query.error || !target || !data) {
    return (
      <div>
        <PageHeader title="User record" breadcrumbs={[{ label: 'Users', to: '/admin/users' }]} />
        <Alert tone="error" title="Could not load this account">
          {query.error ?? 'The user does not exist.'}
        </Alert>
        <Link to="/admin/users" className="mt-4 inline-block">
          <Button variant="secondary">Back to users</Button>
        </Link>
      </div>
    );
  }

  const canModerate =
    me &&
    me.id !== target.id &&
    (target.role !== 'owner' || me.role === 'owner') &&
    (me.role === 'owner' || ROLE_RANK[target.role] < ROLE_RANK[me.role]);
  const canAdjust = Boolean(canModerate && me && roleHasPermission(me.role, 'credits.adjust'));
  const canRole = Boolean(canModerate && me && roleHasPermission(me.role, 'roles.manage'));
  const canStatus = Boolean(canModerate && me && roleHasPermission(me.role, 'users.restrict'));
  const projectedBalance = target.balance + (typeof adjustAmount === 'number' ? adjustAmount : 0);

  const refetchAfter = (message: string) => {
    success(message);
    query.refetch();
  };

  const openAdjust = () => {
    setAdjustAmount('');
    setAdjustReason('');
    setAdjustRequestId(`adj_${crypto.randomUUID()}`);
    setFields({});
    setActionError(null);
    setAdjustOpen(true);
  };

  const submitAdjust = async () => {
    setBusy('adjust');
    setFields({});
    setActionError(null);
    try {
      const result = await api.post<{ duplicate: boolean; transaction: { id: string } }>(
        `/admin/users/${target.id}/adjust`,
        { amount: adjustAmount === '' ? 0 : adjustAmount, reason: adjustReason, requestId: adjustRequestId },
      );
      success(result.duplicate ? 'Adjustment already processed' : 'Balance adjusted', `Transaction ${result.transaction.id}.`);
      setAdjustOpen(false);
      query.refetch();
    } catch (err) {
      setActionError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fieldErrors);
    } finally {
      setBusy(null);
    }
  };

  const submitRole = async () => {
    setBusy('role');
    setActionError(null);
    try {
      await api.patch(`/admin/users/${target.id}/role`, { role: nextRole, reason: roleReason || undefined });
      success('Role updated', `${target.username} is now ${ROLE_LABELS[nextRole]}.`);
      setRoleOpen(false);
      query.refetch();
    } catch (err) {
      setActionError(errorMessage(err));
      toastError('Role change failed', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const submitStatus = async () => {
    setBusy('status');
    setActionError(null);
    try {
      await api.patch(`/admin/users/${target.id}/status`, {
        status: nextStatus,
        reason: statusReason || undefined,
      });
      success('Account status updated', `${target.username} is now ${nextStatus}.`);
      setStatusOpen(false);
      query.refetch();
    } catch (err) {
      setActionError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fieldErrors);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Users', to: '/admin/users' }, { label: target.username }]}
        title={
          <span className="flex items-center gap-2.5">
            {target.username}
            <RoleBadge role={target.role} strict />
            <AccountStatusBadge status={target.status as SessionUser['status']} />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {target.email}</span>
            <span className="text-faint">·</span>
            <span>ID <span className="font-mono text-[10.5px]">{target.id}</span></span>
            <span className="text-faint">·</span>
            <span>Joined {dateTime(target.createdAt)}</span>
          </span>
        }
        actions={
          <>
            <Link to="/admin/users">
              <Button variant="ghost" leftIcon={<ArrowLeft className="h-4 w-4" />}>
                Users
              </Button>
            </Link>
            {canStatus && (
              <Button variant="secondary" onClick={() => { setFields({}); setActionError(null); setStatusOpen(true); }}>
                {target.status === 'active' ? <ShieldAlert className="mr-2 h-4 w-4" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                {target.status === 'active' ? 'Restrict account' : 'Manage access'}
              </Button>
            )}
            {canRole && (
              <Button variant="secondary" onClick={() => { setFields({}); setActionError(null); setRoleOpen(true); }} leftIcon={<UserCog className="h-4 w-4" />}>
                Change role
              </Button>
            )}
            {canAdjust && (
              <Button variant="primary" onClick={openAdjust} leftIcon={<Coins className="h-4 w-4" />}>
                Adjust money
              </Button>
            )}
          </>
        }
      />

      {target.restrictionReason && target.status !== 'active' && (
        <Alert tone="warning" className="mb-5" title={`${titleCase(target.status)} account`}>
          {target.restrictionReason}
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Wallet balance', value: `${money(target.balance)} money`, note: 'Reconciled against ledger', icon: Coins },
          { label: 'Game rounds', value: String(data.stats.sessions), note: `${money(data.stats.wagered)} wagered`, icon: Gamepad2 },
          { label: 'Payouts', value: `${money(data.stats.won)} money`, note: 'Lifetime game payouts', icon: Coins },
          { label: 'Open tickets', value: String(data.tickets.filter((ticket) => !['closed', 'rejected'].includes(ticket.status)).length), note: `${data.activeSessions} active session(s)`, icon: LifeBuoy },
        ].map((stat) => (
          <Card key={stat.label} className="p-4">
            <div className="flex items-start justify-between">
              <p className="text-[10px] font-medium uppercase tracking-[0.09em] text-faint">{stat.label}</p>
              <stat.icon className="h-3.5 w-3.5 text-gold" />
            </div>
            <p className="mt-2.5 font-display text-[22px] font-semibold leading-none tnum text-ink">{stat.value}</p>
            <p className="mt-1.5 text-[10.5px] text-faint">{stat.note}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-5 overflow-hidden">
        <Tabs
          items={[
            { key: 'ledger', label: 'Ledger', count: data.ledger.length },
            { key: 'tickets', label: 'Tickets', count: data.tickets.length },
            { key: 'games', label: 'Game sessions', count: data.gameSessions.length },
            { key: 'requests', label: 'Archived requests', count: data.creditRequests.length },
            { key: 'audit', label: 'Audit events', count: data.audit.length },
          ]}
          value={tab}
          onChange={setTab}
          className="px-2"
        />
        <div>
          {tab === 'ledger' && <TransactionTable entries={data.ledger} />}
          {tab === 'tickets' && (
            data.tickets.length === 0 ? (
              <EmptyState icon={<LifeBuoy className="h-5 w-5" />} title="No tickets" description="This account has not contacted support." />
            ) : (
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Reference</Th>
                    <Th>Subject</Th>
                    <Th>Category</Th>
                    <Th>Status</Th>
                    <Th>Priority</Th>
                    <Th>Updated</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.tickets.map((ticket) => (
                    <Tr key={ticket.id}>
                      <Td>
                        <Link to={`/admin/tickets/${ticket.reference}`} className="font-medium text-gold hover:text-gold-bright">
                          {ticket.reference}
                        </Link>
                      </Td>
                      <Td className="max-w-[280px] truncate text-ink">{ticket.subject}</Td>
                      <Td>{ticket.categoryLabel}</Td>
                      <Td><StatusBadge status={ticket.status} /></Td>
                      <Td className="capitalize">{ticket.priority}</Td>
                      <Td className="whitespace-nowrap text-[11px]">{dateTime(ticket.lastActivityAt)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
            )
          )}
          {tab === 'games' && (
            data.gameSessions.length === 0 ? (
              <EmptyState icon={<Gamepad2 className="h-5 w-5" />} title="No game sessions" description="This account has not placed a wager yet." />
            ) : (
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Game</Th>
                    <Th className="text-right">Wager</Th>
                    <Th className="text-right">Payout</Th>
                    <Th>Result</Th>
                    <Th>Played</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.gameSessions.map((session) => (
                    <Tr key={session.id}>
                      <Td className="font-medium capitalize text-ink">{session.game}</Td>
                      <Td className="text-right tnum">{money(session.bet)}</Td>
                      <Td className="text-right tnum">{money(session.payout)}</Td>
                      <Td>
                        <Badge tone={session.status === 'won' ? 'success' : session.status === 'push' ? 'neutral' : session.status === 'lost' ? 'danger' : 'info'}>
                          {titleCase(session.status)}
                        </Badge>
                      </Td>
                      <Td className="whitespace-nowrap text-[11px]">{dateTime(session.createdAt)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
            )
          )}
          {tab === 'requests' && (
            data.creditRequests.length === 0 ? (
              <EmptyState icon={<Coins className="h-5 w-5" />} title="No archived requests" description="No historical ticket money requests from this account. New money requests are handled in the Cashier." />
            ) : (
              <>
                <div className="border-b border-line bg-surface-2/40 px-4 py-2.5 text-[11px] leading-relaxed text-muted">
                  Read-only history. Money requests are now handled exclusively in the Cashier.
                </div>
                <TableWrap>
                <thead>
                  <tr>
                    <Th>Ticket</Th>
                    <Th>Type</Th>
                    <Th className="text-right">Amount</Th>
                    <Th>Status</Th>
                    <Th>Reviewer</Th>
                    <Th>Created</Th>
                    <Th>Decided</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.creditRequests.map((request) => (
                    <Tr key={request.id}>
                      <Td>
                        <Link to={`/admin/tickets/${request.reference}`} className="font-medium text-gold">
                          {request.reference}
                        </Link>
                      </Td>
                      <Td>{titleCase(request.kind)}</Td>
                      <Td className="text-right tnum">{money(request.amount)}</Td>
                      <Td>
                        <Badge tone={request.status === 'approved' ? 'success' : request.status === 'rejected' ? 'danger' : 'warning'}>
                          {titleCase(request.status)}
                        </Badge>
                      </Td>
                      <Td>{request.reviewer ?? '—'}</Td>
                      <Td className="whitespace-nowrap text-[11px]">{dateTime(request.createdAt)}</Td>
                      <Td className="whitespace-nowrap text-[11px]">{dateTime(request.decidedAt)}</Td>
                    </Tr>
                  ))}
                  </tbody>
                </TableWrap>
              </>
            )
          )}
          {tab === 'audit' && (
            data.audit.length === 0 ? (
              <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No audit events" description="Account actions will appear here." />
            ) : (
              <div className="divide-y divide-line/70">
                {data.audit.map((entry) => (
                  <div key={entry.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                    <div>
                      <p className="text-[12px] text-ink">{entry.action.replaceAll('.', ' · ').replaceAll('_', ' ')}</p>
                      <p className="mt-0.5 text-[10.5px] text-faint">
                        {entry.actor_name ?? 'System'} · {entry.target_label ?? '—'}
                        {entry.reason ? ` · ${entry.reason}` : ''}
                      </p>
                    </div>
                    <time className="text-[10.5px] text-faint">{dateTime(entry.created_at ?? entry.createdAt ?? null)}</time>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </Card>

      <p className="mt-4 flex items-center gap-1.5 text-[10px] text-faint">
        <Lock className="h-3 w-3" /> Sensitive actions require a reason and are recorded in the audit log. Emails are only
        shown to authorized staff.
      </p>

      <Modal
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        title="Adjust DonutSMP money balance"
        description={`Apply a signed adjustment to ${target.username}. The change is atomic and ledgered.`}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdjustOpen(false)} disabled={busy === 'adjust'}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy === 'adjust'} onClick={() => void submitAdjust()} disabled={adjustAmount === '' || adjustAmount === 0 || adjustReason.trim().length < 5}>
              Apply adjustment
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {actionError && <Alert tone="error">{actionError}</Alert>}
          <Field label="Amount" hint="Positive adds money, negative removes it. Use K, M, B, or T — for example 100k or -250k." error={fields.amount}>
            <AmountInput
              value={adjustAmount}
              onChange={setAdjustAmount}
              allowNegative
              placeholder="e.g. 100k or -250k"
              invalid={Boolean(fields.amount)}
            />
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11.5px]">
            <span className="text-muted">Projected balance</span>
            <span className={cn('font-display font-semibold tnum', projectedBalance < 0 ? 'text-danger' : 'text-ink')}>
              {money(projectedBalance)} money
            </span>
          </div>
          {projectedBalance < 0 && <Alert tone="error">The wallet cannot go below zero.</Alert>}
          <Field label="Reason" hint="Required (5+ characters). Shown to the user and stored in the audit log." error={fields.reason}>
            <Textarea
              value={adjustReason}
              onChange={(event) => setAdjustReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Reference the ticket or correction this adjustment resolves."
              invalid={Boolean(fields.reason)}
            />
          </Field>
          <p className="text-[10.5px] text-faint">
            Request key: <span className="font-mono">{adjustRequestId}</span> — retries with this key cannot double-apply.
          </p>
        </div>
      </Modal>

      <Modal
        open={roleOpen}
        onClose={() => setRoleOpen(false)}
        title="Change account role"
        description={`Current role: ${ROLE_LABELS[target.role]}. Role changes take effect on the next request.`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRoleOpen(false)} disabled={busy === 'role'}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy === 'role'} onClick={() => void submitRole()} disabled={nextRole === target.role}>
              Change role
            </Button>
          </>
        }
      >
        {actionError && <Alert tone="error" className="mb-3">{actionError}</Alert>}
        <div className="space-y-4">
          <Field label="New role">
            <Select value={nextRole} onChange={(event) => setNextRole(event.target.value as Role)}>
              {allowedRoles.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason (optional)" hint="Stored in the audit log.">
            <Textarea value={roleReason} onChange={(event) => setRoleReason(event.target.value)} rows={2} maxLength={500} />
          </Field>
          <Alert tone="info">
            You cannot promote above your own role, modify your own role, or remove the last active owner. These rules are
            enforced on the server.
          </Alert>
        </div>
      </Modal>

      <Modal
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        title="Manage account access"
        description="Restricted accounts can sign in but cannot wager or request money. Suspended accounts are signed out."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setStatusOpen(false)} disabled={busy === 'status'}>
              Cancel
            </Button>
            <Button
              variant={nextStatus === 'active' ? 'success' : 'danger'}
              loading={busy === 'status'}
              onClick={() => void submitStatus()}
              disabled={nextStatus === target.status || (nextStatus !== 'active' && statusReason.trim().length < 5)}
            >
              Update access
            </Button>
          </>
        }
      >
        {actionError && <Alert tone="error" className="mb-3">{actionError}</Alert>}
        <div className="space-y-4">
          <Field label="Account status">
            <Select value={nextStatus} onChange={(event) => setNextStatus(event.target.value as typeof nextStatus)}>
              <option value="active">Active</option>
              <option value="restricted">Restricted — can sign in, cannot wager or request</option>
              <option value="suspended">Suspended — sessions revoked</option>
            </Select>
          </Field>
          {nextStatus !== 'active' && (
            <Field label="Reason" hint="Required. Recorded in the audit log and shared with the account." error={fields.reason}>
              <Textarea
                value={statusReason}
                onChange={(event) => setStatusReason(event.target.value)}
                rows={3}
                placeholder="Explain the restriction."
                invalid={Boolean(fields.reason)}
              />
            </Field>
          )}
        </div>
      </Modal>
    </div>
  );
}
