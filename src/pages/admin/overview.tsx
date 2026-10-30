import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Coins,
  Gamepad2,
  Inbox,
  LifeBuoy,
  ScrollText,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import type { TicketPriority } from '../../../shared/types';
import { useApiQuery } from '../../lib/useApi';
import { count, money, dateTime, niceDate, timeAgo } from '../../lib/format';
import { PageHeader } from '../../components/layout';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PriorityBadge,
  Select,
  Skeleton,
  StatusBadge,
  TableWrap,
  Td,
  Th,
  Tr,
  cn,
} from '../../components/ui';

interface Overview {
  rangeDays: number;
  generatedAt: string;
  users: { total: number; active: number; restricted: number; suspended: number; new: number };
  tickets: {
    total: number;
    new: number;
    open: number;
    inProgress: number;
    onHold: number;
    waitingUser: number;
    resolved: number;
    closed: number;
    rejected: number;
    unassigned: number;
    pendingCashier: number;
  };
  economy: {
    circulating: number;
    lifetimeWagered: number;
    lifetimePayouts: number;
    gameNet: number;
    creditGranted: number;
    adminAdjusted: number;
    initialGrants: number;
    pendingCashierAmount: number;
    mismatchedWallets: number;
  };
  games: {
    totalSessions: number;
    recentSessions: number;
    activeSessions: number;
    byGame: { id: string; name: string; enabled: number; sessions: number; wagers: number; payouts: number }[];
  };
  series: { date: string; registrations: number; wagers: number; payouts: number }[];
  recentAudit: {
    id: string;
    action: string;
    target_type: string | null;
    target_label: string | null;
    reason: string | null;
    created_at: string;
    actor_name: string | null;
  }[];
  pendingCashierRequests: {
    id: string;
    reference: string;
    amount: number;
    kind: string;
    created_at: string;
    username: string;
  }[];
  unassignedTickets: {
    reference: string;
    subject: string;
    priority: TicketPriority;
    status: 'new' | 'open' | 'in_progress' | 'on_hold' | 'waiting_user' | 'resolved' | 'closed' | 'rejected';
    created_at: string;
    category: string;
  }[];
}

function BarPairChart({ series }: { series: Overview['series'] }) {
  const max = Math.max(1, ...series.map((day) => Math.max(day.wagers, day.payouts)));
  return (
    <div>
      <div className="flex h-36 items-end gap-1.5">
        {series.map((day) => (
          <div key={day.date} className="group flex h-full min-w-0 flex-1 flex-col justify-end">
            <div className="flex h-full items-end justify-center gap-[2px]">
              <div
                className="w-1/3 max-w-[7px] rounded-t-sm bg-gold/70 transition-colors group-hover:bg-gold"
                style={{ height: `${Math.max(2, (day.wagers / max) * 100)}%` }}
                title={`${day.date} · ${money(day.wagers)} money wagered`}
              />
              <div
                className="w-1/3 max-w-[7px] rounded-t-sm bg-info/55 transition-colors group-hover:bg-info"
                style={{ height: `${Math.max(2, (day.payouts / max) * 100)}%` }}
                title={`${day.date} · ${money(day.payouts)} money paid out`}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[9.5px] text-faint">
        <span>{series[0] ? niceDate(`${series[0].date}T12:00:00Z`) : ''}</span>
        <span>{series[series.length - 1] ? niceDate(`${series[series.length - 1]!.date}T12:00:00Z`) : ''}</span>
      </div>
      <div className="mt-2 flex gap-4 text-[10px] text-muted">
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-gold" /> Wagers</span>
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-info" /> Payouts</span>
      </div>
    </div>
  );
}

function RegistrationChart({ series }: { series: Overview['series'] }) {
  const max = Math.max(1, ...series.map((day) => day.registrations));
  return (
    <div>
      <div className="flex h-28 items-end gap-1">
        {series.map((day) => (
          <div
            key={day.date}
            className="min-h-[2px] flex-1 rounded-t-sm bg-violet/45 transition-colors hover:bg-violet"
            style={{ height: `${Math.max(2, (day.registrations / max) * 100)}%` }}
            title={`${day.date} · ${day.registrations} registration${day.registrations === 1 ? '' : 's'}`}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-faint">
        <span>New accounts per day</span>
        <span>{series.reduce((sum, day) => sum + day.registrations, 0)} total</span>
      </div>
    </div>
  );
}

const statusRows = [
  { key: 'new', label: 'New', tone: 'bg-info', field: 'new' },
  { key: 'inProgress', label: 'In progress', tone: 'bg-gold', field: 'inProgress' },
  { key: 'onHold', label: 'On hold', tone: 'bg-warning', field: 'onHold' },
  { key: 'waitingUser', label: 'Waiting for user', tone: 'bg-violet', field: 'waitingUser' },
  { key: 'resolved', label: 'Resolved', tone: 'bg-success', field: 'resolved' },
  { key: 'closed', label: 'Closed', tone: 'bg-line-strong', field: 'closed' },
  { key: 'rejected', label: 'Rejected', tone: 'bg-danger', field: 'rejected' },
] as const;

export function AdminOverviewPage() {
  const [days, setDays] = useState('14');
  const query = useApiQuery<Overview>(`/admin/overview?days=${days}`);

  if (query.loading) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  if (query.error || !query.data) {
    return (
      <div>
        <PageHeader title="Admin overview" />
        <Alert tone="error" title="Could not load administration data">
          {query.error}
        </Alert>
        <Button className="mt-4" onClick={query.refetch}>
          Retry
        </Button>
      </div>
    );
  }

  const data = query.data;
  const totalTickets = Math.max(1, data.tickets.total);
  const metrics = [
    { label: 'Total users', value: count(data.users.total), hint: `${data.users.new} new in ${data.rangeDays} days`, icon: Users, tone: 'text-gold' },
    { label: 'Active users', value: count(data.users.active), hint: `${data.users.restricted} restricted · ${data.users.suspended} suspended`, icon: ShieldCheck, tone: 'text-success' },
    { label: 'Open tickets', value: count(data.tickets.open), hint: `${data.tickets.new} new · ${data.tickets.waitingUser} waiting`, icon: LifeBuoy, tone: 'text-info' },
    { label: 'Unassigned tickets', value: count(data.tickets.unassigned), hint: 'Awaiting an owner', icon: Inbox, tone: 'text-warning' },
    { label: 'Money in circulation', value: money(data.economy.circulating), hint: 'Sum of all DonutSMP wallets', icon: Wallet, tone: 'text-gold' },
    { label: 'Cashier queue', value: count(data.tickets.pendingCashier), hint: `${money(data.economy.pendingCashierAmount)} money requested`, icon: Coins, tone: 'text-violet' },
    { label: 'Game wagers', value: money(data.economy.lifetimeWagered), hint: `${count(data.games.totalSessions)} rounds all time`, icon: Gamepad2, tone: 'text-info' },
    { label: 'House hold', value: money(data.economy.gameNet), hint: 'Wagers retained after payouts', icon: data.economy.gameNet >= 0 ? TrendingUp : TrendingDown, tone: data.economy.gameNet >= 0 ? 'text-success' : 'text-danger' },
  ];

  return (
    <div>
      <PageHeader
        title="Admin overview"
        description="Platform health across accounts, support, the economy, and game operations."
        actions={
          <>
            <Select value={days} onChange={(event) => setDays(event.target.value)} className="w-[132px]">
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </Select>
            <Link to="/admin/users">
              <Button variant="secondary" leftIcon={<Users className="h-4 w-4" />}>
                Users
              </Button>
            </Link>
            <Link to="/staff/inbox">
              <Button variant="primary" leftIcon={<Inbox className="h-4 w-4" />}>
                Support desk
              </Button>
            </Link>
          </>
        }
      />

      {data.economy.mismatchedWallets > 0 && (
        <Alert tone="error" className="mb-5" title="Ledger reconciliation warning">
          {data.economy.mismatchedWallets} wallet{data.economy.mismatchedWallets === 1 ? '' : 's'} do not match the ledger.
          Review the economy page before making adjustments.
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label} className="p-4">
            <div className="flex items-start justify-between">
              <p className="text-[10px] font-medium uppercase tracking-[0.09em] text-faint">{metric.label}</p>
              <metric.icon className={cn('h-3.5 w-3.5', metric.tone)} />
            </div>
            <p className="mt-2.5 font-display text-[24px] font-semibold leading-none tracking-tight tnum text-ink">
              {metric.value}
            </p>
            <p className="mt-1.5 text-[10.5px] text-muted">{metric.hint}</p>
          </Card>
        ))}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Game economy"
            description={`Wager and payout volume over the last ${data.rangeDays} days, in DonutSMP money.`}
            action={<Badge tone="neutral">{data.games.recentSessions} rounds in range</Badge>}
          />
          <div className="p-5">
            <BarPairChart series={data.series} />
            <div className="mt-5 grid gap-3 border-t border-line pt-4 sm:grid-cols-3">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-faint">All-time wagers</p>
                <p className="mt-1 font-display text-[17px] font-semibold tnum">{money(data.economy.lifetimeWagered)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-faint">All-time payouts</p>
                <p className="mt-1 font-display text-[17px] font-semibold tnum">{money(data.economy.lifetimePayouts)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-faint">Active sessions</p>
                <p className="mt-1 font-display text-[17px] font-semibold tnum">{data.games.activeSessions}</p>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Support pipeline" description="Every ticket by current status." />
          <div className="space-y-3 p-5">
            {statusRows.map((row) => {
              const value = data.tickets[row.field];
              return (
                <div key={row.key}>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="text-muted">{row.label}</span>
                    <span className="font-medium text-ink tnum">{value}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div className={cn('h-full rounded-full', row.tone)} style={{ width: `${(value / totalTickets) * 100}%` }} />
                  </div>
                </div>
              );
            })}
            <div className="mt-1 flex items-center justify-between border-t border-line pt-3 text-[11px]">
              <span className="text-muted">Unassigned active tickets</span>
              <Badge tone={data.tickets.unassigned > 0 ? 'warning' : 'success'}>{data.tickets.unassigned}</Badge>
            </div>
            <Link
              to="/admin/tickets"
              className="flex items-center justify-between text-[11.5px] font-medium text-gold hover:text-gold-bright"
            >
              Open support desk <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Game performance" description={`Rounds played in the last ${data.rangeDays} days.`} />
          <TableWrap minWidth={560}>
            <thead>
              <tr>
                <Th>Game</Th>
                <Th className="text-right">Rounds</Th>
                <Th className="text-right">Wagers</Th>
                <Th className="text-right">Payouts</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {data.games.byGame.map((game) => (
                <Tr key={game.id}>
                  <Td className="font-medium capitalize text-ink">{game.name}</Td>
                  <Td className="text-right tnum">{game.sessions}</Td>
                  <Td className="text-right tnum">{money(game.wagers)}</Td>
                  <Td className="text-right tnum">{money(game.payouts)}</Td>
                  <Td>{game.enabled ? <Badge tone="success" dot>Live</Badge> : <Badge tone="warning">Offline</Badge>}</Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>

        <Card>
          <CardHeader
            title="Cashier queue"
            description="Oldest pending deposits and withdrawals."
            action={
              <Link to="/admin/cashier" className="text-[11px] font-medium text-gold">
                Open queue
              </Link>
            }
          />
          {data.pendingCashierRequests.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="h-5 w-5" />}
              title="Cashier queue clear"
              description="New deposit and withdrawal requests will appear in the Cashier review queue."
            />
          ) : (
            <div className="divide-y divide-line/70">
              {data.pendingCashierRequests.map((request) => (
                <Link
                  key={request.id}
                  to={`/admin/cashier/${request.reference}`}
                  className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2/60"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-lg border border-gold/20 bg-gold/8 text-gold">
                    <Coins className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium text-ink">
                      {money(request.amount)} money · {request.username}
                    </p>
                    <p className="text-[10.5px] text-faint">
                      {request.reference} · {timeAgo(request.created_at)}
                    </p>
                  </div>
                  <ArrowUpRight className="h-3.5 w-3.5 text-faint" />
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card>
          <CardHeader title="Registrations" description={`Accounts created in the last ${data.rangeDays} days.`} />
          <div className="p-5">
            <RegistrationChart series={data.series} />
            <div className="mt-4 flex items-center gap-3 border-t border-line pt-3">
              <span className="grid h-8 w-8 place-items-center rounded-lg border border-violet/20 bg-violet/8">
                <UserPlus className="h-3.5 w-3.5 text-violet" />
              </span>
              <div>
                <p className="text-[12px] font-medium text-ink">{data.users.new} new accounts</p>
                <p className="text-[10.5px] text-faint">of {data.users.total} total</p>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Unassigned queue"
            description="Oldest high-priority tickets first."
            action={
              <Link to="/staff/unassigned" className="text-[11px] font-medium text-gold">
                Open queue
              </Link>
            }
          />
          {data.unassignedTickets.length === 0 ? (
            <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="Queue clear" description="Every active ticket has an owner." />
          ) : (
            <div className="divide-y divide-line/70">
              {data.unassignedTickets.map((ticket) => (
                <Link
                  key={ticket.reference}
                  to={`/admin/tickets/${ticket.reference}`}
                  className="block px-5 py-3 transition-colors hover:bg-surface-2/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-[10.5px] font-medium text-gold">{ticket.reference}</span>
                    <PriorityBadge priority={ticket.priority} />
                  </div>
                  <p className="mt-1 truncate text-[12px] text-ink">{ticket.subject}</p>
                  <p className="mt-0.5 text-[10.5px] text-faint">{ticket.category} · {timeAgo(ticket.created_at)}</p>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Recent admin actions"
            description="From the append-only audit log."
            action={
              <Link to="/admin/audit" className="text-[11px] font-medium text-gold">
                Full log
              </Link>
            }
          />
          {data.recentAudit.length === 0 ? (
            <EmptyState icon={<ScrollText className="h-5 w-5" />} title="No audit entries" />
          ) : (
            <div className="divide-y divide-line/70">
              {data.recentAudit.map((entry) => (
                <div key={entry.id} className="px-5 py-2.5">
                  <p className="text-[11.5px] text-ink">{entry.action.replaceAll('.', ' · ').replaceAll('_', ' ')}</p>
                  <p className="mt-0.5 text-[10px] text-faint">
                    {entry.actor_name ?? 'System'} · {entry.target_label ?? entry.target_type ?? '—'} · {timeAgo(entry.created_at)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-[10px] text-faint">
        <AlertTriangle className="h-3 w-3" /> Definitions: circulation is the sum of stored wallets; wager/payout volume
        comes from ledger entries; ticket counts are current-state queries. Generated {dateTime(data.generatedAt)}.
      </p>
    </div>
  );
}
