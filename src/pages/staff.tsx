import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Inbox,
  LifeBuoy,
  PauseCircle,
  Plus,
  Search,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';
import type { TicketCounts, TicketSummary } from '../../shared/types';
import { useApiQuery } from '../lib/useApi';
import { useToast } from '../context/ToastContext';
import { api, errorMessage } from '../lib/api';
import { money, dateTime, timeAgo, titleCase } from '../lib/format';
import { PageHeader } from '../components/layout';
import { TicketTable } from '../components/tickets';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  LoadingBlock,
  PriorityBadge,
  RoleBadge,
  Skeleton,
  StatusBadge,
  TableWrap,
  Td,
  Th,
  Tr,
  cn,
} from '../components/ui';

interface StaffOverview {
  counts: TicketCounts;
  assignedTickets: TicketSummary[];
  unassignedTickets: TicketSummary[];
  recentEvents: {
    id: string;
    type: string;
    from: string | null;
    to: string | null;
    note: string | null;
    createdAt: string;
    ticketReference: string;
    ticketSubject: string;
  }[];
  resolvedLast7Days: number;
  workload: {
    id: string;
    username: string;
    role: 'user' | 'support' | 'moderator' | 'admin' | 'owner';
    status: string;
    assignedOpen: number;
    assignedTotal: number;
    lastActivityAt: string | null;
  }[];
}

function MiniTicket({ ticket, onClaim }: { ticket: TicketSummary; onClaim?: (ticket: TicketSummary) => void }) {
  const navigate = useNavigate();
  return (
    <div
      className="flex cursor-pointer items-start gap-3 border-b border-line/70 px-4 py-3 transition-colors last:border-0 hover:bg-surface-2/60"
      onClick={() => navigate(`/staff/tickets/${ticket.reference}`)}
    >
      <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', ticket.unread ? 'bg-gold' : 'bg-line-strong')} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-[10.5px] font-medium tracking-wide text-gold">{ticket.reference}</span>
          <time className="text-[10px] text-faint">{timeAgo(ticket.lastActivityAt)}</time>
        </div>
        <p className="mt-0.5 truncate text-[12.5px] font-medium text-ink">{ticket.subject}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
          <span className="text-[10px] text-faint">{ticket.requester.username}</span>
        </div>
      </div>
      {onClaim && !ticket.assignee && (
        <Button
          size="sm"
          variant="ghost"
          onClick={(event) => {
            event.stopPropagation();
            onClaim(ticket);
          }}
        >
          Claim
        </Button>
      )}
    </div>
  );
}

export function StaffOverviewPage() {
  const query = useApiQuery<StaffOverview>('/staff/overview');
  const { success, error: toastError } = useToast();
  const [claiming, setClaiming] = useState<string | null>(null);

  const claim = async (ticket: TicketSummary) => {
    setClaiming(ticket.reference);
    try {
      await api.post(`/tickets/${ticket.reference}/claim`);
      success('Ticket claimed', `${ticket.reference} is now in your queue.`);
      query.refetch();
    } catch (err) {
      toastError('Could not claim ticket', errorMessage(err));
    } finally {
      setClaiming(null);
    }
  };

  if (query.loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-12 w-72" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-2xl" />
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (query.error || !query.data) {
    return (
      <div>
        <PageHeader title="Staff overview" />
        <Alert tone="error" title="Could not load the staff workspace">
          {query.error}
        </Alert>
        <Button className="mt-4" onClick={query.refetch}>
          Retry
        </Button>
      </div>
    );
  }

  const data = query.data;
  const counts = data.counts;
  const statCards = [
    { label: 'Assigned to me', value: counts.assignedToMe, note: 'Open ownership', icon: UserCheck, tone: 'text-gold' },
    { label: 'Unassigned', value: counts.unassigned, note: 'Waiting for an owner', icon: UserX, tone: 'text-warning' },
    { label: 'New', value: counts.new, note: 'Awaiting first handling', icon: Inbox, tone: 'text-info' },
    { label: 'Waiting for user', value: counts.waitingUser, note: 'Blocked on requester', icon: Clock, tone: 'text-violet' },
    { label: 'On hold', value: counts.onHold, note: 'Paused with reason', icon: PauseCircle, tone: 'text-warning' },
    { label: 'Resolved · 7d', value: data.resolvedLast7Days, note: 'By you', icon: CheckCircle2, tone: 'text-success' },
  ];

  return (
    <div>
      <PageHeader
        title="Staff overview"
        description="Your queue, the unassigned pool, and the health of the support desk."
        actions={
          <>
            <Link to="/staff/inbox">
              <Button variant="secondary" leftIcon={<Inbox className="h-4 w-4" />}>
                Open inbox
              </Button>
            </Link>
            <Link to="/staff/activity">
              <Button variant="ghost" leftIcon={<Activity className="h-4 w-4" />}>
                My activity
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {statCards.map((card) => (
          <Card key={card.label} className="p-4">
            <div className="flex items-start justify-between">
              <p className="text-[10px] font-medium uppercase tracking-[0.09em] text-faint">{card.label}</p>
              <card.icon className={cn('h-3.5 w-3.5', card.tone)} />
            </div>
            <p className="mt-2.5 font-display text-[24px] font-semibold leading-none tnum text-ink">{card.value}</p>
            <p className="mt-1.5 text-[10.5px] text-faint">{card.note}</p>
          </Card>
        ))}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Your queue"
            description={`${counts.assignedToMe} open ticket${counts.assignedToMe === 1 ? '' : 's'} assigned to you`}
            action={
              <Link to="/staff/assigned" className="flex items-center gap-1 text-[11px] font-medium text-gold">
                View all <ArrowUpRight className="h-3 w-3" />
              </Link>
            }
          />
          {data.assignedTickets.length > 0 ? (
            <div>
              {data.assignedTickets.map((ticket) => (
                <MiniTicket key={ticket.id} ticket={ticket} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<UserCheck className="h-5 w-5" />}
              title="Your queue is clear"
              description="Claim an unassigned ticket or check the inbox for new work."
              action={
                <Link to="/staff/unassigned">
                  <Button size="sm" variant="secondary">
                    Browse unassigned
                  </Button>
                </Link>
              }
            />
          )}
        </Card>

        <Card>
          <CardHeader
            title="Unassigned pool"
            description={`${counts.unassigned} ticket${counts.unassigned === 1 ? '' : 's'} without an owner`}
            action={
              <Link to="/staff/unassigned" className="flex items-center gap-1 text-[11px] font-medium text-gold">
                View all <ArrowUpRight className="h-3 w-3" />
              </Link>
            }
          />
          {data.unassignedTickets.length > 0 ? (
            <div>
              {data.unassignedTickets.map((ticket) => (
                <MiniTicket
                  key={ticket.id}
                  ticket={ticket}
                  onClaim={claiming === ticket.reference ? undefined : (entry) => void claim(entry)}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<UserX className="h-5 w-5" />}
              title="Nothing unassigned"
              description="Every permitted ticket currently has an owner."
            />
          )}
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader
            title="Your recent activity"
            description="Ticket events you performed."
            action={
              <Link to="/staff/activity" className="text-[11px] font-medium text-gold">
                Full timeline
              </Link>
            }
          />
          {data.recentEvents.length === 0 ? (
            <EmptyState icon={<Activity className="h-5 w-5" />} title="No activity yet" description="Actions you take on tickets will appear here." />
          ) : (
            <ol className="relative space-y-3 px-5 py-4">
              <span className="timeline-line absolute bottom-5 left-[26px] top-7 w-px" />
              {data.recentEvents.map((event) => (
                <li key={event.id} className="relative flex gap-3">
                  <span className="z-10 mt-1 grid h-3 w-3 shrink-0 place-items-center rounded-full border border-gold/40 bg-surface-1">
                    <span className="h-1 w-1 rounded-full bg-gold" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11.5px] text-ink">
                      <span className="font-medium">{titleCase(event.type)}</span>{' '}
                      <Link to={`/staff/tickets/${event.ticketReference}`} className="text-gold hover:text-gold-bright">
                        {event.ticketReference}
                      </Link>
                    </p>
                    <p className="truncate text-[10.5px] text-faint">{event.ticketSubject}</p>
                    <p className="mt-0.5 text-[10px] text-faint">
                      {event.from || event.to ? `${event.from ?? '—'} → ${event.to ?? '—'} · ` : ''}
                      {timeAgo(event.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card>
          <CardHeader title="Desk workload" description="Open ownership across every staff account." />
          <TableWrap minWidth={600}>
            <thead>
              <tr>
                <Th>Agent</Th>
                <Th>Role</Th>
                <Th className="text-right">Open</Th>
                <Th className="text-right">Total</Th>
                <Th>Last seen</Th>
              </tr>
            </thead>
            <tbody>
              {data.workload.map((member) => (
                <Tr key={member.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Avatar name={member.username} size={24} />
                      <span className="text-[12px] font-medium text-ink">{member.username}</span>
                    </div>
                  </Td>
                  <Td>
                    <RoleBadge role={member.role} />
                  </Td>
                  <Td className={cn('text-right tnum', member.assignedOpen > 5 ? 'text-warning' : 'text-ink')}>
                    {member.assignedOpen}
                  </Td>
                  <Td className="text-right tnum">{member.assignedTotal}</Td>
                  <Td className="text-[11px]">{timeAgo(member.lastActivityAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
          <div className="flex items-center gap-2 border-t border-line px-4 py-3 text-[10.5px] text-faint">
            <Users className="h-3.5 w-3.5" /> Team load is live from assigned, unresolved tickets.
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {[
          { title: 'Ticket inbox', text: 'All permitted tickets with counts by stage.', to: '/staff/inbox', icon: Inbox },
          { title: 'Search', text: 'Find by reference, subject, or requester.', to: '/staff/search', icon: Search },
          { title: 'On hold', text: 'Revisit paused conversations.', to: '/staff/on-hold', icon: PauseCircle },
        ].map((item) => (
          <Link key={item.to} to={item.to} className="group flex items-center gap-3 rounded-xl border border-line bg-surface-1 p-3.5 transition-colors hover:border-gold/25">
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface-2">
              <item.icon className="h-4 w-4 text-gold" />
            </span>
            <span>
              <span className="block text-[12px] font-medium text-ink">{item.title}</span>
              <span className="block text-[10.5px] text-muted">{item.text}</span>
            </span>
            <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-faint group-hover:text-gold" />
          </Link>
        ))}
      </div>
    </div>
  );
}

const INBOX_PRESETS: Record<
  string,
  { title: string; description: string; scope: string; search?: boolean }
> = {
  inbox: {
    title: 'Ticket inbox',
    description: 'Every ticket within your permission scope, with live counts for each workflow stage.',
    scope: 'all',
  },
  assigned: {
    title: 'Assigned to me',
    description: 'Tickets you own across every status. Keep them moving.',
    scope: 'mine',
  },
  unassigned: {
    title: 'Unassigned tickets',
    description: 'New and open work without an owner. Claim a ticket to take responsibility.',
    scope: 'unassigned',
  },
  'on-hold': {
    title: 'Tickets on hold',
    description: 'Paused conversations with a recorded reason.',
    scope: 'on_hold',
  },
  closed: {
    title: 'Closed tickets',
    description: 'Completed conversations. Reopen from the ticket detail if permitted.',
    scope: 'closed',
  },
  search: {
    title: 'Ticket search',
    description: 'Search every permitted ticket by reference, requester, or subject.',
    scope: 'all',
    search: true,
  },
};

export function StaffInboxPage({ preset = 'inbox' }: { preset?: keyof typeof INBOX_PRESETS }) {
  const config = INBOX_PRESETS[preset] ?? INBOX_PRESETS.inbox!;
  return (
    <div>
      <PageHeader
        title={config.title}
        description={config.description}
        actions={
          <>
            <Link to="/staff">
              <Button variant="ghost" leftIcon={<LifeBuoy className="h-4 w-4" />}>
                Overview
              </Button>
            </Link>
            <Link to="/staff/activity">
              <Button variant="secondary" leftIcon={<Activity className="h-4 w-4" />}>
                My activity
              </Button>
            </Link>
          </>
        }
      />
      <TicketTable
        mode="staff"
        initialScope={config.scope}
        initialSearch=""
        autoFocusSearch={Boolean(config.search)}
      />
    </div>
  );
}

interface ActivityResponse {
  items: {
    id: string;
    type: string;
    from: string | null;
    to: string | null;
    note: string | null;
    createdAt: string;
    ticketReference: string;
    ticketSubject: string;
  }[];
}

export function StaffActivityPage() {
  const query = useApiQuery<ActivityResponse>('/staff/activity');

  return (
    <div>
      <PageHeader
        title="My staff activity"
        description="A chronological record of ticket actions you performed, drawn from the ticket event log."
        actions={
          <Link to="/staff/inbox">
            <Button variant="secondary" leftIcon={<Inbox className="h-4 w-4" />}>
              Ticket inbox
            </Button>
          </Link>
        }
      />
      <Card>
        {query.loading ? (
          <LoadingBlock label="Loading activity" />
        ) : query.error ? (
          <div className="p-4">
            <Alert tone="error">{query.error}</Alert>
          </div>
        ) : (query.data?.items ?? []).length === 0 ? (
          <EmptyState
            icon={<Activity className="h-5 w-5" />}
            title="No recorded activity"
            description="Claim, reply, assign, or change a ticket status and your actions will appear here."
            action={
              <Link to="/staff/unassigned">
                <Button variant="secondary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />}>
                  Find work to claim
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="divide-y divide-line/70">
            {query.data!.items.map((event) => (
              <div key={event.id} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
                <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line bg-surface-2">
                  <Activity className="h-3.5 w-3.5 text-gold" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] text-ink">
                    <span className="font-medium">{titleCase(event.type)}</span> on{' '}
                    <Link to={`/staff/tickets/${event.ticketReference}`} className="font-medium text-gold hover:text-gold-bright">
                      {event.ticketReference}
                    </Link>
                  </p>
                  <p className="truncate text-[11px] text-muted">{event.ticketSubject}</p>
                  {(event.from || event.to) && (
                    <p className="mt-0.5 text-[10.5px] text-faint">
                      {event.from ?? '—'} → {event.to ?? '—'}
                    </p>
                  )}
                </div>
                <time className="text-[10.5px] text-faint">{dateTime(event.createdAt)}</time>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export function StaffTicketListHint() {
  return (
    <div className="flex items-center gap-2 text-[11px] text-faint">
      <Inbox className="h-3.5 w-3.5" /> Live ticket counts
    </div>
  );
}
