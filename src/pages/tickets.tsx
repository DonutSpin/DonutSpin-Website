import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Archive,
  ArrowLeft,
  ClipboardCopy,
  History,
  Landmark,
  LifeBuoy,
  Lock,
  MessageSquare,
  Plus,
  ScrollText,
  Send,
  ShieldCheck,
  Ticket,
  UserCheck,
} from 'lucide-react';
import {
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_HELP,
  TICKET_STATUS_LABELS,
  type CreditRequest,
  type SessionUser,
  type StaffMember,
  type SupportCategory,
  type TicketDetail,
  type TicketEvent,
  type TicketPriority,
  type TicketStatus,
} from '../../shared/types';
import { useApiQuery } from '../lib/useApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, ApiRequestError, errorMessage } from '../lib/api';
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
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PriorityBadge,
  RoleBadge,
  Select,
  StatusBadge,
  Textarea,
  cn,
} from '../components/ui';

export function TicketsPage() {
  return (
    <div>
      <PageHeader
        title="My tickets"
        description="Every support request, with a permanent reference and a complete public history."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/transcripts">
              <Button variant="secondary" leftIcon={<ScrollText className="h-4 w-4" />}>
                Transcripts
              </Button>
            </Link>
            <Link to="/tickets/new">
              <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />}>
                New ticket
              </Button>
            </Link>
          </div>
        }
      />
      <Alert tone="info" className="mb-4" title="Response times">
        Responding to a ticket can take up to 2 days. Include the reference and every relevant detail so the team can
        help in one reply.
      </Alert>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[
          { icon: Ticket, title: 'Permanent reference', text: 'Use TKT-YYYY-NNNNNN when talking to support.' },
          { icon: MessageSquare, title: 'Full conversation', text: 'Public replies and system updates stay in one timeline.' },
          { icon: ShieldCheck, title: 'Private notes stay private', text: 'Internal staff notes are never shown to players.' },
        ].map((item) => (
          <div key={item.title} className="flex gap-3 rounded-xl border border-line bg-surface-1 p-3.5">
            <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
            <div>
              <p className="text-[12px] font-medium text-ink">{item.title}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{item.text}</p>
            </div>
          </div>
        ))}
      </div>
      <TicketTable mode="user" />
    </div>
  );
}

const emptyCategory: SupportCategory = {
  key: '',
  label: '',
  description: '',
  enabled: true,
  defaultPriority: 'normal',
  sortOrder: 0,
};

export function NewTicketPage() {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const { config } = useAuth();
  const categoriesQuery = useApiQuery<{ categories: SupportCategory[] }>('/tickets/categories');
  // Giveaway claims and sponsorships have dedicated flows so the correct
  // giveaway and winner record are verified server-side.
  const categories = (categoriesQuery.data?.categories ?? []).filter(
    (entry) => entry.key !== 'giveaway_claim' && entry.key !== 'giveaway_sponsorship',
  );

  const [subject, setSubject] = useState('');
  const [categoryKey, setCategoryKey] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!categoryKey && categories.length > 0) {
      const first = categories.find((entry) => entry.key === 'question') ?? categories[0] ?? emptyCategory;
      setCategoryKey(first.key);
    }
  }, [categories, categoryKey]);

  const category = categories.find((entry) => entry.key === categoryKey) ?? null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setFields({});
    setBusy(true);
    try {
      const response = await api.post<{ ticket: TicketDetail }>('/tickets', {
        subject,
        category: categoryKey,
        description,
      });
      success('Ticket created', `Reference ${response.ticket.reference}.`);
      navigate(`/tickets/${response.ticket.reference}`);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fieldErrors);
      toastError('Could not create the ticket', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'My tickets', to: '/tickets' }, { label: 'New ticket' }]}
        title="Open a support ticket"
        description="Choose the right category so the request reaches someone who can help. A reference is issued immediately."
        actions={
          <Link to="/tickets">
            <Button variant="ghost" leftIcon={<ArrowLeft className="h-4 w-4" />}>
              Back to tickets
            </Button>
          </Link>
        }
      />

      {config?.maintenance && (
        <Alert tone="warning" className="mb-5" title="Platform maintenance">
          Ticket creation is paused while maintenance is underway.
        </Alert>
      )}

      <Alert tone="info" className="mb-5" title="Response times">
        Responding to a ticket can take up to 2 days. Add every relevant detail up front so support can help in one
        reply.
      </Alert>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="p-5 sm:p-6">
          {error && (
            <Alert tone="error" className="mb-5">
              {error}
            </Alert>
          )}
          <form onSubmit={(event) => void submit(event)} className="space-y-5">
            <Field label="Subject" htmlFor="subject" required error={fields.subject} hint="A short summary, at least 4 characters.">
              <Input
                id="subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="e.g. Missing payout from a Towers round"
                maxLength={140}
                invalid={Boolean(fields.subject)}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category" htmlFor="category" required error={fields.category}>
                <Select
                  id="category"
                  value={categoryKey}
                  onChange={(event) => setCategoryKey(event.target.value)}
                  invalid={Boolean(fields.category)}
                >
                  {categories.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.label}
                    </option>
                  ))}
                </Select>
                {category && <p className="mt-1 text-[11px] leading-relaxed text-faint">{category.description}</p>}
              </Field>
              <Field label="Priority" hint="Team DonutSpin sets priority automatically from the category.">
                <div className="flex h-9 items-center rounded-lg border border-line bg-surface-2/60 px-3 text-[12px] text-muted">
                  {category ? TICKET_PRIORITY_LABELS[category.defaultPriority] : '—'} · set by staff
                </div>
              </Field>
            </div>

            <Field
              label="Describe the issue"
              htmlFor="description"
              required
              error={fields.description}
              hint="Include game names, approximate times, and any reference IDs. Never include passwords."
            >
              <Textarea
                id="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={7}
                maxLength={8000}
                placeholder="Tell us what happened and what you expected to happen."
                invalid={Boolean(fields.description)}
              />
              <div className="text-right text-[10.5px] text-faint">{description.length} / 8000</div>
            </Field>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p className="flex items-center gap-1.5 text-[10.5px] text-faint">
                <Lock className="h-3 w-3" /> Never share your password in a ticket.
              </p>
              <div className="flex gap-2">
                <Link to="/tickets">
                  <Button variant="ghost" type="button">
                    Cancel
                  </Button>
                </Link>
                <Button
                  type="submit"
                  variant="primary"
                  loading={busy}
                  disabled={!categoryKey || config?.maintenance}
                >
                  Create ticket
                </Button>
              </div>
            </div>
          </form>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="font-display text-[14px] font-semibold text-ink">What happens next</h3>
            <ol className="mt-3 space-y-3">
              {[
                'Your ticket gets a permanent reference such as TKT-2026-000042.',
                'It enters the New queue and support claims or is assigned the request.',
                'You can reply in the same thread; staff internal notes remain hidden.',
                'Status changes and replies are recorded in the timeline.',
              ].map((step, index) => (
                <li key={step} className="flex gap-2.5 text-[11.5px] leading-relaxed text-muted">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-gold/25 bg-gold/8 text-[10px] font-semibold text-gold">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </Card>
          <Card className="p-5">
            <div className="flex items-start gap-2.5">
              <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
              <div>
                <p className="text-[12px] font-medium text-ink">Money requests live in the Cashier</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  Deposits, withdrawals, and every other DonutSMP money request are handled exclusively through the
                  Cashier. Support tickets cover account, game, wallet-ledger, and technical issues only.
                </p>
                <Link to="/cashier" className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-gold hover:text-gold-bright">
                  Open the Cashier →
                </Link>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

const eventLabels: Record<string, string> = {
  created: 'Ticket created',
  status: 'Status changed',
  priority: 'Priority changed',
  assignment: 'Assignment changed',
  hold: 'Placed on hold',
  rejected: 'Ticket rejected',
  reopened: 'Ticket reopened',
  internal_note: 'Internal note added',
  credit_approved: 'Legacy money request approved',
  credit_rejected: 'Legacy money request rejected',
};

function EventRow({ event }: { event: TicketEvent }) {
  return (
    <li className="relative border-l border-line pl-4">
      <span className="absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full border border-gold/40 bg-gold/30" />
      <p className="text-[11.5px] font-medium text-ink">{eventLabels[event.type] ?? titleCase(event.type)}</p>
      <p className="mt-0.5 text-[10.5px] text-faint">
        {event.actorName} · {dateTime(event.createdAt)}
      </p>
      {event.fromValue || event.toValue ? (
        <p className="mt-1 text-[10.5px] text-muted">
          {event.fromValue ? TICKET_STATUS_LABELS[event.fromValue as TicketStatus] ?? event.fromValue : '—'} →{' '}
          {event.toValue ? TICKET_STATUS_LABELS[event.toValue as TicketStatus] ?? event.toValue : '—'}
        </p>
      ) : null}
      {event.note && <p className="mt-1 rounded-md bg-surface-2 px-2 py-1 text-[10.5px] text-muted">{event.note}</p>}
    </li>
  );
}

function ArchivedMoneyRequestCard({ request }: { request: CreditRequest }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-1.5">
            <Archive className="h-3.5 w-3.5 text-faint" /> Archived money request
          </span>
        }
        action={
          <Badge tone={request.status === 'approved' ? 'success' : request.status === 'rejected' ? 'danger' : 'neutral'} dot>
            {request.status === 'pending' ? 'Archived pending' : titleCase(request.status)}
          </Badge>
        }
      />
      <div className="p-4">
        <div className="mb-4 rounded-xl border border-line bg-surface-2/60 p-3">
          <p className="text-[11.5px] font-medium text-ink">This record is read-only.</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            Money requests are now handled exclusively in the Cashier. This historical ticket request cannot be
            approved or rejected here; no balance change will be made from it.
          </p>
          <Link to="/cashier" className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-gold hover:text-gold-bright">
            <Landmark className="h-3 w-3" /> Open the Cashier
          </Link>
        </div>
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-[9.5px] uppercase tracking-[0.12em] text-faint">Requested amount</p>
            <p className="mt-1 font-display text-2xl font-semibold text-gold-bright tnum">{money(request.amount)}</p>
          </div>
          <span className="text-[10px] uppercase tracking-wider text-faint">money</span>
        </div>
        <dl className="mt-4 space-y-2 text-[11.5px]">
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Type</dt>
            <dd className="text-right text-ink">{titleCase(request.kind)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Requester</dt>
            <dd className="text-right text-ink">{request.requesterName}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Opened</dt>
            <dd className="text-right text-ink">{dateTime(request.createdAt)}</dd>
          </div>
          {request.reviewerName && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Reviewer</dt>
              <dd className="text-right text-ink">{request.reviewerName}</dd>
            </div>
          )}
          {request.decidedAt && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Decided</dt>
              <dd className="text-right text-ink">{dateTime(request.decidedAt)}</dd>
            </div>
          )}
        </dl>
        {request.decisionReason && (
          <div className="mt-3 rounded-lg border border-line bg-surface-2 p-2.5">
            <p className="text-[9.5px] uppercase tracking-wider text-faint">Decision reason</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{request.decisionReason}</p>
          </div>
        )}
        {request.ledgerId && (
          <p className="mt-2 font-mono text-[10px] text-success">Ledger {request.ledgerId}</p>
        )}
      </div>
    </Card>
  );
}

export function TicketDetailPage({ mode = 'user' }: { mode?: 'user' | 'staff' | 'admin' }) {
  const { reference = '' } = useParams();
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();
  const [override, setOverride] = useState<TicketDetail | null>(null);
  const [message, setMessage] = useState('');
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<TicketStatus | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [closeConfirm, setCloseConfirm] = useState(false);

  const query = useApiQuery<{ ticket: TicketDetail }>(
    reference ? `/tickets/${encodeURIComponent(reference)}` : null,
    { pollMs: 5_000 },
  );
  const ticket = override ?? query.data?.ticket ?? null;
  const staff = mode !== 'user';
  const team = useApiQuery<{ staff: StaffMember[] }>(staff && ticket?.canAssign ? '/staff/team' : null, {
    enabled: Boolean(staff && ticket?.canAssign),
  });

  useEffect(() => {
    setOverride(null);
    setMessage('');
    setInternal(false);
    setActionError(null);
    setStatusTarget(null);
  }, [reference]);

  // An action response is shown immediately, then replaced by the next server
  // snapshot. This matters for the visible-tab poller, which must not stay
  // pinned to the state captured when the user last sent a message.
  useEffect(() => {
    if (query.data?.ticket) setOverride(null);
  }, [query.data]);

  const apply = (updated: TicketDetail) => setOverride(updated);

  if (!reference) return null;

  if (query.loading && !ticket) return <LoadingBlock label="Opening ticket" />;
  if (!ticket) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[
            { label: mode === 'user' ? 'My tickets' : 'Support desk', to: mode === 'user' ? '/tickets' : mode === 'staff' ? '/staff/inbox' : '/admin/tickets' },
            { label: reference },
          ]}
          title="Ticket unavailable"
        />
        <Card className="p-6">
          <EmptyState
            icon={<LifeBuoy className="h-5 w-5" />}
            title="We could not open this ticket"
            description={query.error ?? 'It may belong to another account, or the reference is incorrect.'}
            action={
              <Link to={mode === 'user' ? '/tickets' : mode === 'staff' ? '/staff/inbox' : '/admin/tickets'}>
                <Button variant="secondary">Back to tickets</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const backToList = mode === 'user' ? '/tickets' : mode === 'staff' ? '/staff/inbox' : '/admin/tickets';
  const staffPath = mode === 'staff' || mode === 'admin';

  const runAction = async (key: string, action: () => Promise<{ ticket: TicketDetail }>, successMessage: string) => {
    setActionError(null);
    setActionBusy(key);
    try {
      const result = await action();
      apply(result.ticket);
      query.refetch();
      success(successMessage);
      return true;
    } catch (err) {
      setActionError(errorMessage(err));
      toastError('Action failed', errorMessage(err));
      return false;
    } finally {
      setActionBusy(null);
    }
  };

  const sendMessage = async () => {
    if (!message.trim()) return;
    setSending(true);
    setActionError(null);
    try {
      const result = await api.post<{ ticket: TicketDetail }>(`/tickets/${ticket.reference}/messages`, {
        body: message,
        visibility: internal ? 'internal' : 'public',
      });
      apply(result.ticket);
      query.refetch();
      setMessage('');
      setInternal(false);
      success(internal ? 'Internal note saved' : 'Reply sent');
    } catch (err) {
      setActionError(errorMessage(err));
      toastError('Message not sent', errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const changeStatus = async () => {
    if (!statusTarget) return;
    if (['on_hold', 'rejected'].includes(statusTarget) && statusReason.trim().length < 3) {
      setActionError('A reason of at least 3 characters is required for this status.');
      return;
    }
    const ok = await runAction(
      'status',
      () =>
        api.post<{ ticket: TicketDetail }>(`/tickets/${ticket.reference}/status`, {
          status: statusTarget,
          reason: statusReason.trim() || undefined,
        }),
      `Ticket moved to ${TICKET_STATUS_LABELS[statusTarget]}`,
    );
    if (ok) {
      setStatusTarget(null);
      setStatusReason('');
    }
  };

  const changePriority = async (priority: TicketPriority) => {
    if (priority === ticket.priority) return;
    await runAction(
      'priority',
      () => api.post<{ ticket: TicketDetail }>(`/tickets/${ticket.reference}/priority`, { priority }),
      'Priority updated',
    );
  };

  const assign = async (assigneeId: string) => {
    await runAction(
      'assign',
      () => api.post<{ ticket: TicketDetail }>(`/tickets/${ticket.reference}/assign`, { assigneeId: assigneeId || null }),
      assigneeId ? 'Ticket assigned' : 'Ticket unassigned',
    );
  };

  const copyReference = () => {
    void navigator.clipboard?.writeText(ticket.reference).then(
      () => success('Reference copied', ticket.reference),
      () => undefined,
    );
  };

  const archivedRequest = ticket.creditRequest;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: mode === 'user' ? 'My tickets' : 'Support desk', to: backToList }, { label: ticket.reference }]}
        title={ticket.subject}
        badge={<StatusBadge status={ticket.status} />}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <button onClick={copyReference} className="inline-flex items-center gap-1 font-mono text-[11.5px] text-gold hover:text-gold-bright">
              {ticket.reference} <ClipboardCopy className="h-3 w-3" />
            </button>
            <span className="text-faint">·</span>
            <span>{ticket.categoryLabel}</span>
            <span className="text-faint">·</span>
            <span>Opened {dateTime(ticket.createdAt)}</span>
          </span>
        }
        actions={
          <>
            {['closed', 'rejected'].includes(ticket.status) && (
              <Link to={`/transcripts/ticket/${ticket.reference}`}>
                <Button variant="secondary" leftIcon={<ScrollText className="h-4 w-4" />}>
                  Transcript
                </Button>
              </Link>
            )}
            <Link to={backToList}>
              <Button variant="ghost" leftIcon={<ArrowLeft className="h-4 w-4" />}>
                Back
              </Button>
            </Link>
            {ticket.assignee?.id === user?.id && <Badge tone="gold">Assigned to you</Badge>}
          </>
        }
      />

      {actionError && (
        <Alert tone="error" className="mb-4">
          {actionError}
        </Alert>
      )}

      {mode === 'user' && ticket.canReply && (
        <Alert tone="info" className="mb-4" title="Response times">
          Responding to a ticket can take up to 2 days. Replies and status changes appear in this thread; check back later if you are waiting on support.
        </Alert>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_348px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <div className="border-b border-line px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">Request</Badge>
                <Badge tone="gold">{ticket.categoryLabel}</Badge>
                <PriorityBadge priority={ticket.priority} />
                {archivedRequest && (
                  <Badge tone={archivedRequest.status === 'approved' ? 'success' : archivedRequest.status === 'rejected' ? 'danger' : 'neutral'}>
                    <Archive className="h-3 w-3" /> {money(archivedRequest.amount)} archived money request
                  </Badge>
                )}
              </div>
            </div>
            <div className="px-5 py-5">
              <p className="whitespace-pre-wrap text-[13.5px] leading-7 text-ink/90">{ticket.description}</p>
              <p className="mt-4 text-[10.5px] text-faint">By {ticket.requester.username} · {dateTime(ticket.createdAt)}</p>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Conversation"
              description={`${ticket.messages.filter((entry) => entry.visibility !== 'system').length} messages · chronological order`}
              action={
                ticket.status === 'waiting_user' ? <Badge tone="violet" dot>Support is waiting on you</Badge> : undefined
              }
            />
            <div className="space-y-4 px-5 py-5">
              {ticket.messages.length === 0 && (
                <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[12px] text-faint">
                  No replies yet. The request above is the opening message.
                </p>
              )}
              {ticket.messages.map((entry) => {
                if (entry.visibility === 'system') {
                  return (
                    <div key={entry.id} className="flex items-center gap-3">
                      <span className="h-px flex-1 bg-line" />
                      <span className="rounded-full border border-line bg-surface-2 px-3 py-1 text-center text-[10.5px] text-faint">
                        {entry.body} · {timeAgo(entry.createdAt)}
                      </span>
                      <span className="h-px flex-1 bg-line" />
                    </div>
                  );
                }
                if (entry.visibility === 'internal') {
                  return (
                    <div key={entry.id} className="rounded-xl border border-warning/25 bg-warning/5 p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-warning">
                          <Lock className="h-3 w-3" /> Internal note
                        </span>
                        <span className="text-[10px] text-faint">
                          {entry.authorName} · {dateTime(entry.createdAt)}
                        </span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink/90">{entry.body}</p>
                      <p className="mt-2 text-[9.5px] uppercase tracking-wider text-warning/70">Never visible to the requester</p>
                    </div>
                  );
                }
                const isRequester = entry.authorRole === 'user';
                return (
                  <div key={entry.id} className={cn('flex gap-2.5', isRequester ? 'justify-start' : 'justify-end')}>
                    {isRequester && <Avatar name={entry.authorName} size={30} />}
                    <div className={cn('max-w-[82%]', !isRequester && 'text-right')}>
                      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-faint">
                        <span className="font-medium text-muted">{entry.authorName}</span>
                        <Badge tone={isRequester ? 'neutral' : 'gold'}>{isRequester ? 'Requester' : 'Support'}</Badge>
                        <span>{dateTime(entry.createdAt)}</span>
                      </div>
                      <div
                        className={cn(
                          'rounded-xl border px-3.5 py-2.5 text-left text-[12.5px] leading-relaxed whitespace-pre-wrap',
                          isRequester
                            ? 'rounded-tl-sm border-line bg-surface-2 text-ink/90'
                            : 'rounded-tr-sm border-gold/20 bg-gold/6 text-ink/90',
                        )}
                      >
                        {entry.body}
                      </div>
                    </div>
                    {!isRequester && <Avatar name={entry.authorName} size={30} />}
                  </div>
                );
              })}
            </div>

            <div className="border-t border-line bg-surface-2/30 px-5 py-4">
              {ticket.canReply ? (
                <>
                  {ticket.canNote && (
                    <div className="mb-2.5 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setInternal(false)}
                        className={cn(
                          'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors',
                          !internal ? 'border-gold/35 bg-gold/8 text-gold' : 'border-line bg-surface-2 text-muted hover:text-ink',
                        )}
                      >
                        <Send className="h-3 w-3" /> Reply to requester
                      </button>
                      <button
                        type="button"
                        onClick={() => setInternal(true)}
                        className={cn(
                          'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors',
                          internal ? 'border-warning/35 bg-warning/8 text-warning' : 'border-line bg-surface-2 text-muted hover:text-ink',
                        )}
                      >
                        <Lock className="h-3 w-3" /> Internal note
                      </button>
                    </div>
                  )}
                  <Textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        void sendMessage();
                      }
                    }}
                    rows={3}
                    maxLength={5000}
                    placeholder={internal ? 'Write a note only staff can read…' : 'Write a reply to the requester…'}
                    className={internal ? 'border-warning/30 focus:border-warning/50 focus:ring-warning/10' : undefined}
                  />
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[10px] text-faint">
                      {internal
                        ? 'Internal notes are excluded from every player-facing API response.'
                        : 'Attachments are not supported in this release. Avoid sharing passwords or secrets.'}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-faint">{message.length} / 5000</span>
                      <Button
                        variant={internal ? 'secondary' : 'primary'}
                        size="sm"
                        loading={sending}
                        disabled={!message.trim()}
                        onClick={() => void sendMessage()}
                        leftIcon={internal ? <Lock className="h-3 w-3" /> : <Send className="h-3 w-3" />}
                      >
                        {internal ? 'Save note' : 'Send reply'}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2/60 px-4 py-3">
                  <p className="text-[12px] text-muted">
                    This ticket is {TICKET_STATUS_LABELS[ticket.status].toLowerCase()} and cannot receive replies.
                  </p>
                  {mode === 'user' && (
                    <Link to="/tickets/new">
                      <Button size="sm" variant="secondary">
                        Open a new ticket
                      </Button>
                    </Link>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {staff && (ticket.canAssign || ticket.canNote) && (
            <Card>
              <CardHeader title="Staff actions" description="Permission-checked and audit logged." />
              <div className="space-y-3.5 p-4">
                {!ticket.assignee && ticket.canAssign && (
                  <Button
                    variant="primary"
                    className="w-full"
                    size="sm"
                    loading={actionBusy === 'claim'}
                    leftIcon={<UserCheck className="h-3.5 w-3.5" />}
                    onClick={() =>
                      void runAction('claim', () => api.post(`/tickets/${ticket.reference}/claim`), 'Ticket claimed')
                    }
                  >
                    Claim this ticket
                  </Button>
                )}
                {ticket.allowedTransitions.length > 0 && (
                  <Field label="Move status">
                    <Select
                      value=""
                      disabled={Boolean(actionBusy)}
                      onChange={(event) => {
                        const next = event.target.value as TicketStatus;
                        if (!next) return;
                        if (next === 'closed') {
                          setStatusTarget(next);
                          setCloseConfirm(true);
                          return;
                        }
                        setStatusTarget(next);
                        setStatusReason('');
                      }}
                    >
                      <option value="">Choose a status…</option>
                      {ticket.allowedTransitions.map((status) => (
                        <option key={status} value={status}>
                          {TICKET_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {ticket.canReply && ticket.canNote && (
                  <p className="text-[10.5px] leading-relaxed text-faint">{TICKET_STATUS_HELP[ticket.status]}</p>
                )}
                {ticket.assignee === null && !ticket.canAssign && (
                  <p className="text-[10.5px] text-faint">This ticket is unassigned.</p>
                )}
                {ticket.canAssign && (
                  <Field label="Assignee">
                    <Select
                      value={ticket.assignee?.id ?? ''}
                      disabled={Boolean(actionBusy)}
                      onChange={(event) => void assign(event.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {(team.data?.staff ?? []).map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.username} · {member.role}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {ticket.allowedTransitions.includes('rejected') && (
                  <Button
                    variant="danger"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setStatusTarget('rejected');
                      setStatusReason('');
                    }}
                  >
                    Reject with reason
                  </Button>
                )}
              </div>
            </Card>
          )}

          {archivedRequest && <ArchivedMoneyRequestCard request={archivedRequest} />}

          <Card>
            <CardHeader title="Details" />
            <dl className="divide-y divide-line/60 px-4">
              {[
                ['Status', <StatusBadge status={ticket.status} />],
                [
                  'Priority',
                  staff && ticket.canReply ? (
                    <Select
                      className="h-8 w-32 text-[11.5px]"
                      value={ticket.priority}
                      disabled={actionBusy === 'priority'}
                      onChange={(event) => void changePriority(event.target.value as TicketPriority)}
                    >
                      {(['low', 'normal', 'high', 'urgent'] as const).map((level) => (
                        <option key={level} value={level}>
                          {TICKET_PRIORITY_LABELS[level]}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <PriorityBadge priority={ticket.priority} />
                  ),
                ],
                ['Category', ticket.categoryLabel],
                [
                  'Requester',
                  <span className="flex items-center justify-end gap-1.5">
                    {staff && <Avatar name={ticket.requester.username} size={20} />}
                    {ticket.requester.username}
                  </span>,
                ],
                [
                  'Assignee',
                  ticket.assignee ? (
                    <span className="flex items-center justify-end gap-1.5">
                      <Avatar name={ticket.assignee.username} size={20} /> {ticket.assignee.username}
                    </span>
                  ) : (
                    'Unassigned'
                  ),
                ],
                ['Created', dateTime(ticket.createdAt)],
                ['Last activity', dateTime(ticket.lastActivityAt)],
                ...(ticket.closedAt ? [['Closed', dateTime(ticket.closedAt)]] : []),
              ].map(([label, value], index) => (
                <div key={index} className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="text-[11px] text-muted">{label as string}</dt>
                  <dd className="text-right text-[11.5px] text-ink">{value as React.ReactNode}</dd>
                </div>
              ))}
            </dl>
            {staff && (
              <div className="border-t border-line px-4 py-3">
                <div className="flex items-center gap-2">
                  <Avatar name={ticket.requester.username} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11.5px] font-medium text-ink">{ticket.requester.username}</p>
                    <p className="truncate text-[10px] text-faint">{ticket.requester.email}</p>
                  </div>
                  {ticket.requester.status && <Badge tone={ticket.requester.status === 'active' ? 'success' : 'warning'}>{ticket.requester.status}</Badge>}
                </div>
                <div className="mt-2 flex items-center justify-between text-[10.5px] text-faint">
                  <span>Balance {money(ticket.requester.balance ?? 0)} money</span>
                  <span>Joined {timeAgo(ticket.requester.createdAt)}</span>
                </div>
                {mode === 'admin' && (
                  <Link
                    to={`/admin/users/${ticket.requester.id}`}
                    className="mt-2 inline-block text-[10.5px] font-medium text-gold hover:text-gold-bright"
                  >
                    Open player record →
                  </Link>
                )}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" /> Ticket history
                </span>
              }
            />
            <div className="max-h-[360px] overflow-y-auto p-4">
              {ticket.events.length === 0 ? (
                <p className="text-[11.5px] text-faint">No recorded events yet.</p>
              ) : (
                <ol className="space-y-3">
                  {ticket.events.map((event) => (
                    <EventRow key={event.id} event={event} />
                  ))}
                </ol>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={Boolean(statusTarget) && !closeConfirm}
        onClose={() => setStatusTarget(null)}
        title={statusTarget ? `Move ticket to ${TICKET_STATUS_LABELS[statusTarget]}` : 'Change status'}
        description={
          statusTarget
            ? `${TICKET_STATUS_HELP[statusTarget]} The requester will be notified and the change appears in the history.`
            : undefined
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setStatusTarget(null)} disabled={actionBusy === 'status'}>
              Cancel
            </Button>
            <Button variant={statusTarget === 'rejected' ? 'danger' : 'primary'} loading={actionBusy === 'status'} onClick={() => void changeStatus()}>
              Confirm transition
            </Button>
          </>
        }
      >
        <Field
          label="Reason"
          hint="Required for On hold and Rejected. Visible to the requester in the timeline."
          error={['on_hold', 'rejected'].includes(statusTarget ?? '') && statusReason.trim().length < 3 ? 'Enter at least 3 characters.' : undefined}
        >
          <Textarea
            value={statusReason}
            onChange={(event) => setStatusReason(event.target.value)}
            placeholder="Explain the decision or what is blocking progress."
            rows={3}
            maxLength={500}
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={closeConfirm}
        onClose={() => {
          setCloseConfirm(false);
          setStatusTarget(null);
        }}
        onConfirm={() => {
          void changeStatus().then((ok) => {
            setCloseConfirm(false);
            setStatusTarget(null);
          });
        }}
        title="Close this ticket?"
        description="Closing locks this ticket permanently for everyone. The requester can read the transcript but cannot reply or reopen it. This is recorded in the ticket history."
        confirmLabel="Close ticket"
        tone="danger"
        loading={actionBusy === 'status'}
      />

    </div>
  );
}
