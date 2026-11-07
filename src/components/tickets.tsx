import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Archive,
  ArrowUpDown,
  Filter,
  Inbox,
  Search,
  SlidersHorizontal,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import type { Paginated, SessionUser, StaffMember, SupportCategory, TicketCounts, TicketSummary } from '../../shared/types';
import { TICKET_PRIORITY_LABELS, TICKET_STATUS_LABELS, roleHasPermission } from '../../shared/types';
import { useApiQuery } from '../lib/useApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, errorMessage } from '../lib/api';
import { dateTime, timeAgo } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Pagination,
  PriorityBadge,
  Select,
  Skeleton,
  StatusBadge,
  TableWrap,
  Tabs,
  Td,
  Th,
  Tr,
  cn,
} from './ui';

export type TicketMode = 'user' | 'staff' | 'admin';

interface TicketListResponse extends Paginated<TicketSummary> {
  counts: TicketCounts;
}

const STAFF_TABS = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'mine', label: 'Assigned to me' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'on_hold', label: 'On hold' },
  { key: 'waiting_user', label: 'Waiting for user' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'closed', label: 'Closed' },
  { key: 'rejected', label: 'Rejected' },
] as const;

const USER_TABS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'waiting_user', label: 'Waiting on you' },
  { key: 'on_hold', label: 'On hold' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'closed', label: 'Closed' },
] as const;

function countFor(tab: string, counts: TicketCounts | undefined): number | undefined {
  if (!counts) return undefined;
  switch (tab) {
    case 'all':
      return counts.all;
    case 'new':
      return counts.new;
    case 'unassigned':
      return counts.unassigned;
    case 'mine':
      return counts.assignedToMe;
    case 'open':
      return counts.open;
    case 'in_progress':
      return counts.inProgress;
    case 'on_hold':
      return counts.onHold;
    case 'waiting_user':
      return counts.waitingUser;
    case 'resolved':
      return counts.resolved;
    case 'closed':
      return counts.closed;
    case 'rejected':
      return counts.rejected;
    default:
      return undefined;
  }
}

export function TicketTable({
  mode,
  initialScope = 'all',
  initialSearch = '',
  autoFocusSearch = false,
  hideFilters = false,
  limit,
}: {
  mode: TicketMode;
  initialScope?: string;
  initialSearch?: string;
  autoFocusSearch?: boolean;
  hideFilters?: boolean;
  limit?: number;
}) {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();
  const [scope, setScope] = useState(initialScope);
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [sort, setSort] = useState<'activity' | 'created' | 'priority'>('activity');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [claiming, setClaiming] = useState<string | null>(null);

  const staff = mode !== 'user';

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const params = new URLSearchParams();
  if (mode === 'user') params.set('own', 'true');
  if (scope !== 'all') params.set('scope', scope);
  if (search) params.set('q', search);
  if (category) params.set('category', category);
  if (priority) params.set('priority', priority);
  if (assigneeId) params.set('assigneeId', assigneeId);
  params.set('sort', sort);
  params.set('direction', direction);
  params.set('page', String(page));
  params.set('pageSize', String(limit ?? 20));

  const query = useApiQuery<TicketListResponse>(`/tickets?${params.toString()}`, { pollMs: 10_000 });
  const categories = useApiQuery<{ categories: SupportCategory[] }>('/tickets/categories');
  const team = useApiQuery<{ staff: StaffMember[] }>(staff && !hideFilters ? '/staff/team' : null, {
    enabled: staff && !hideFilters,
  });

  const counts = query.data?.counts;
  const tabs = useMemo(
    () =>
      (staff ? STAFF_TABS : USER_TABS).map((tab) => ({
        key: tab.key,
        label: tab.label,
        count: countFor(tab.key, counts),
      })),
    [staff, counts],
  );

  const detailPath = (reference: string) =>
    mode === 'user' ? `/tickets/${reference}` : mode === 'staff' ? `/staff/tickets/${reference}` : `/admin/tickets/${reference}`;

  const canAssign = Boolean(user && roleHasPermission(user.role, 'tickets.assign'));

  const claim = async (ticket: TicketSummary) => {
    if (!user) return;
    setClaiming(ticket.reference);
    try {
      await api.post(`/tickets/${ticket.reference}/claim`);
      success('Ticket claimed', `${ticket.reference} is now assigned to you.`);
      query.refetch();
    } catch (err) {
      toastError('Could not claim ticket', errorMessage(err));
    } finally {
      setClaiming(null);
    }
  };

  const resetFilters = () => {
    setSearchInput('');
    setSearch('');
    setCategory('');
    setPriority('');
    setAssigneeId('');
    setSort('activity');
    setDirection('desc');
    setScope(initialScope);
    setPage(1);
  };

  const hasFilters = Boolean(search || category || priority || assigneeId || scope !== initialScope);

  return (
    <Card className="overflow-hidden">
      <Tabs
        items={tabs}
        value={scope}
        onChange={(value) => {
          setScope(value);
          setPage(1);
        }}
        className="px-2"
      />
      {!hideFilters && (
        <div className="flex flex-wrap items-end gap-2.5 border-b border-line px-4 py-3">
          <div className="relative min-w-[190px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search reference, subject, or username"
              className="pl-9"
              autoFocus={autoFocusSearch}
            />
          </div>
          <Field className="w-[160px]">
            <Select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All categories</option>
              {(categories.data?.categories ?? []).map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field className="w-[132px]">
            <Select
              value={priority}
              onChange={(event) => {
                setPriority(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Any priority</option>
              {(['low', 'normal', 'high', 'urgent'] as const).map((level) => (
                <option key={level} value={level}>
                  {TICKET_PRIORITY_LABELS[level]}
                </option>
              ))}
            </Select>
          </Field>
          {staff && (
            <Field className="w-[168px]">
              <Select
                value={assigneeId}
                onChange={(event) => {
                  setAssigneeId(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">Any assignee</option>
                {(team.data?.staff ?? []).map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.username}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field className="w-[148px]">
            <Select
              value={`${sort}:${direction}`}
              onChange={(event) => {
                const [nextSort, nextDirection] = event.target.value.split(':');
                setSort((nextSort as typeof sort) ?? 'activity');
                setDirection((nextDirection as typeof direction) ?? 'desc');
                setPage(1);
              }}
            >
              <option value="activity:desc">Latest activity</option>
              <option value="created:desc">Newest first</option>
              <option value="created:asc">Oldest first</option>
              <option value="priority:desc">Highest priority</option>
            </Select>
          </Field>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              Reset
            </Button>
          )}
        </div>
      )}

      {query.error ? (
        <div className="p-5">
          <p className="text-[13px] text-danger">{query.error}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={query.refetch}>
            Try again
          </Button>
        </div>
      ) : query.loading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : query.data && query.data.items.length > 0 ? (
        <>
          <div className="hidden md:block">
            <TableWrap>
              <thead>
                <tr>
                  <Th>Reference</Th>
                  <Th>Subject</Th>
                  {staff && <Th>Requester</Th>}
                  <Th>Category</Th>
                  <Th>Status</Th>
                  <Th>Priority</Th>
                  {staff && <Th>Assignee</Th>}
                  <Th>Updated</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((ticket) => (
                  <Tr key={ticket.id} onClick={() => navigate(detailPath(ticket.reference))}>
                    <Td>
                      <span className="font-display text-[11.5px] font-medium tracking-wide text-gold">{ticket.reference}</span>
                    </Td>
                    <Td className="max-w-[300px]">
                      <div className="flex items-center gap-2">
                        {ticket.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" title="Unread activity" />}
                        <span className="truncate font-medium text-ink">{ticket.subject}</span>
                        {ticket.hasArchivedMoneyRequest && (
                          <Archive className="h-3.5 w-3.5 shrink-0 text-faint" aria-label="Has an archived money request" />
                        )}
                      </div>
                      <p className="mt-0.5 text-[10.5px] text-faint">Created {dateTime(ticket.createdAt)}</p>
                    </Td>
                    {staff && <Td className="whitespace-nowrap text-[12px] text-ink/90">{ticket.requester.username}</Td>}
                    <Td className="whitespace-nowrap text-[11.5px]">{ticket.categoryLabel}</Td>
                    <Td>
                      <StatusBadge status={ticket.status} />
                    </Td>
                    <Td>
                      <PriorityBadge priority={ticket.priority} />
                    </Td>
                    {staff && (
                      <Td className="whitespace-nowrap text-[12px]">
                        {ticket.assignee ? (
                          <span className="text-ink/90">{ticket.assignee.username}</span>
                        ) : (
                          <span className="text-faint">Unassigned</span>
                        )}
                      </Td>
                    )}
                    <Td className="whitespace-nowrap text-[11.5px]">{timeAgo(ticket.lastActivityAt)}</Td>
                    <Td className="text-right">
                      {staff && canAssign && !ticket.assignee && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={claiming === ticket.reference}
                          onClick={(event) => {
                            event.stopPropagation();
                            void claim(ticket);
                          }}
                          leftIcon={<UserPlus className="h-3 w-3" />}
                        >
                          Claim
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          </div>

          <div className="divide-y divide-line/70 md:hidden">
            {query.data.items.map((ticket) => (
              <Link key={ticket.id} to={detailPath(ticket.reference)} className="block px-4 py-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-[11px] font-medium text-gold">{ticket.reference}</span>
                  <div className="flex items-center gap-1.5">
                    {ticket.unread && <span className="h-1.5 w-1.5 rounded-full bg-gold" />}
                    <StatusBadge status={ticket.status} />
                  </div>
                </div>
                <p className="mt-1.5 flex items-center gap-1.5 text-[13px] font-medium text-ink">
                  {ticket.subject}
                  {ticket.hasArchivedMoneyRequest && <Archive className="h-3.5 w-3.5 text-faint" aria-label="Has an archived money request" />}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-faint">
                  {staff && <span>{ticket.requester.username}</span>}
                  <span>·</span>
                  <span>{ticket.categoryLabel}</span>
                  <span>·</span>
                  <PriorityBadge priority={ticket.priority} />
                  {staff && (
                    <>
                      <span>·</span>
                      <span>{ticket.assignee ? ticket.assignee.username : 'Unassigned'}</span>
                    </>
                  )}
                </div>
                <p className="mt-1 text-[10px] text-faint">Updated {timeAgo(ticket.lastActivityAt)}</p>
              </Link>
            ))}
          </div>

          <Pagination
            page={query.data.page}
            totalPages={query.data.totalPages}
            total={query.data.total}
            onPage={setPage}
            unit="tickets"
          />
        </>
      ) : (
        <EmptyState
          icon={<Inbox className="h-5 w-5" />}
          title={hasFilters ? 'No tickets match these filters' : 'No tickets yet'}
          description={
            hasFilters
              ? 'Try a different status tab, clear the search, or reset the filters.'
              : mode === 'user'
                ? 'When you open a support ticket it appears here with a permanent reference, status, and full conversation.'
                : 'There are no tickets in this view right now. New tickets will appear here as they arrive.'
          }
          action={
            hasFilters ? (
              <Button variant="secondary" size="sm" onClick={resetFilters}>
                Reset filters
              </Button>
            ) : mode === 'user' ? (
              <Link to="/tickets/new">
                <Button variant="primary" size="sm">
                  Open a ticket
                </Button>
              </Link>
            ) : undefined
          }
        />
      )}
    </Card>
  );
}

export function TicketPageIntro({
  mode,
  scope,
}: {
  mode: TicketMode;
  scope?: string;
}) {
  const titles: Record<string, { title: string; description: string }> = {
    assigned: { title: 'Assigned to me', description: 'Tickets you own. Keep statuses current so the queue stays trustworthy.' },
    unassigned: { title: 'Unassigned', description: 'New work that no agent has claimed yet. Claim a ticket to take ownership.' },
    'on-hold': { title: 'On hold', description: 'Paused tickets with a recorded reason. Revisit when the blocker clears.' },
    closed: { title: 'Closed tickets', description: 'Finished conversations. Reopen only when the workflow allows it.' },
    search: { title: 'Ticket search', description: 'Find any ticket by reference, requester, or subject.' },
    inbox: { title: 'Ticket inbox', description: 'Every permitted ticket, with live counts for each stage of the workflow.' },
  };
  const key = scope ?? (mode === 'user' ? 'inbox' : 'inbox');
  const entry = titles[key] ?? {
    title: 'Support tickets',
    description: 'Track every request from creation to closure, with reference IDs and full history.',
  };
  return { ...entry, count: undefined };
}

export function TicketStatsStrip({ counts }: { counts?: TicketCounts }) {
  const data = [
    { label: 'Open', value: counts?.open ?? 0, tone: 'text-success' },
    { label: 'New', value: counts?.new ?? 0, tone: 'text-info' },
    { label: 'Unassigned', value: counts?.unassigned ?? 0, tone: 'text-warning' },
    { label: 'Mine', value: counts?.assignedToMe ?? 0, tone: 'text-gold' },
    { label: 'Waiting', value: counts?.waitingUser ?? 0, tone: 'text-violet' },
    { label: 'On hold', value: counts?.onHold ?? 0, tone: 'text-warning' },
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {data.map((item) => (
        <div key={item.label} className="rounded-xl border border-line bg-surface-1 px-3.5 py-2.5">
          <p className="text-[9.5px] font-medium uppercase tracking-[0.1em] text-faint">{item.label}</p>
          <p className={cn('mt-1 font-display text-xl font-semibold tnum', item.tone)}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}

export function TicketQuickFilters() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
      <span className="flex items-center gap-1">
        <Filter className="h-3 w-3" /> Filters
      </span>
      <span className="flex items-center gap-1">
        <ArrowUpDown className="h-3 w-3" /> Sort
      </span>
      <span className="flex items-center gap-1">
        <SlidersHorizontal className="h-3 w-3" /> Pagination
      </span>
      <span className="flex items-center gap-1">
        <UserCheck className="h-3 w-3" /> Claim
      </span>
    </div>
  );
}
