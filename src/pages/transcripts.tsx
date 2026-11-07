import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarDays,
  FileText,
  Landmark,
  LifeBuoy,
  Lock,
  MessageSquare,
  ScrollText,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import {
  ROLE_LABELS,
  roleHasPermission,
  type TranscriptDetail,
  type TranscriptKind,
  type TranscriptListResponse,
  type TranscriptSummary,
} from '../../shared/types';
import { useApiQuery } from '../lib/useApi';
import { useAuth } from '../context/AuthContext';
import { dateTime, money, timeAgo, titleCase } from '../lib/format';
import { PageHeader } from '../components/layout';
import { CashierStatusBadge } from '../components/cashier';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  LoadingBlock,
  Pagination,
  TableWrap,
  Tabs,
  Td,
  Th,
  Tr,
  cn,
} from '../components/ui';

type TranscriptMode = 'user' | 'admin';

const KIND_TABS = [
  { key: 'all', label: 'All transcripts' },
  { key: 'ticket', label: 'Tickets' },
  { key: 'cashier', label: 'Cashier requests' },
];

function isKind(value: string | null): value is TranscriptKind {
  return value === 'ticket' || value === 'cashier';
}

function statusTone(status: string): 'success' | 'danger' | 'warning' | 'neutral' {
  if (['closed', 'approved', 'resolved'].includes(status)) return 'success';
  if (['rejected', 'cancelled'].includes(status)) return 'danger';
  if (status === 'pending') return 'warning';
  return 'neutral';
}

function KindBadge({ kind }: { kind: TranscriptKind }) {
  return kind === 'ticket' ? (
    <Badge tone="gold">
      <LifeBuoy className="h-3 w-3" /> Ticket
    </Badge>
  ) : (
    <Badge tone="neutral">
      <Landmark className="h-3 w-3" /> Cashier
    </Badge>
  );
}

function TranscriptStatus({ item }: { item: TranscriptSummary }) {
  if (item.kind === 'cashier') {
    return <CashierStatusBadge status={item.status as 'pending' | 'approved' | 'rejected' | 'cancelled'} />;
  }
  return (
    <Badge tone={statusTone(item.status)} dot>
      {titleCase(item.status.replace(/_/g, ' '))}
    </Badge>
  );
}

function closedLabel(item: TranscriptSummary): string {
  return item.kind === 'ticket' ? 'Closed' : 'Decided';
}

function useTranscriptList(mode: TranscriptMode) {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawKind = searchParams.get('kind');
  const kind = isKind(rawKind) ? rawKind : null;
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', '15');
  params.set('scope', mode === 'admin' ? 'all' : 'own');
  if (kind) params.set('kind', kind);
  const query = useApiQuery<TranscriptListResponse>(`/transcripts?${params.toString()}`, { pollMs: 15_000 });

  const setKind = (next: string) => {
    const nextParams = new URLSearchParams(searchParams);
    if (next === 'all') nextParams.delete('kind');
    else nextParams.set('kind', next);
    nextParams.delete('page');
    setSearchParams(nextParams);
  };
  const setPage = (next: number) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('page', String(next));
    setSearchParams(nextParams);
  };
  return { query, kind, setKind, page, setPage };
}

function TranscriptListBody({
  mode,
  data,
  loading,
  error,
}: {
  mode: TranscriptMode;
  data: TranscriptListResponse | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) return <LoadingBlock label="Loading transcripts" />;
  if (error) {
    return (
      <div className="p-4">
        <Alert tone="error">{error}</Alert>
      </div>
    );
  }
  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        icon={<ScrollText className="h-5 w-5" />}
        title="No transcripts yet"
        description={
          mode === 'admin'
            ? 'Closed tickets and decided cashier requests will appear here automatically.'
            : 'Close a ticket or receive a cashier decision and the complete conversation will be kept here.'
        }
        action={
          <Link to={mode === 'admin' ? '/admin/tickets' : '/tickets'}>
            <Button variant="secondary" size="sm">
              {mode === 'admin' ? 'Open the support desk' : 'Open a ticket'}
            </Button>
          </Link>
        }
      />
    );
  }

  if (mode === 'admin') {
    return (
      <TableWrap>
        <thead>
          <tr>
            <Th>Reference</Th>
            <Th>Conversation</Th>
            <Th>Creator</Th>
            <Th>Type</Th>
            <Th>Status</Th>
            <Th>Closed</Th>
            <Th className="text-right">Transcript</Th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => (
            <Tr key={`${item.kind}-${item.id}`}>
              <Td>
                <Link
                  to={`/transcripts/${item.kind}/${item.reference}`}
                  className="font-mono text-[11px] text-gold hover:text-gold-bright"
                >
                  {item.reference}
                </Link>
              </Td>
              <Td>
                <p className="max-w-[260px] truncate text-[12px] font-medium text-ink">{item.title}</p>
                <p className="mt-0.5 text-[10.5px] text-faint">{item.categoryLabel}</p>
              </Td>
              <Td>{item.requester.username}</Td>
              <Td>
                <KindBadge kind={item.kind} />
              </Td>
              <Td>
                <TranscriptStatus item={item} />
              </Td>
              <Td>
                <span className="text-[11px] text-muted">{item.closedAt ? dateTime(item.closedAt) : '—'}</span>
                <p className="mt-0.5 text-[10px] text-faint">
                  {item.messageCount} message{item.messageCount === 1 ? '' : 's'}
                </p>
              </Td>
              <Td className="text-right">
                <Link to={`/transcripts/${item.kind}/${item.reference}`}>
                  <Button size="sm" variant="secondary" leftIcon={<FileText className="h-3 w-3" />}>
                    Open
                  </Button>
                </Link>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableWrap>
    );
  }

  return (
    <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
      {data.items.map((item) => (
        <Link key={`${item.kind}-${item.id}`} to={`/transcripts/${item.kind}/${item.reference}`} className="group block">
          <Card className="h-full p-4 transition-colors group-hover:border-gold/35 group-hover:bg-surface-2/50">
            <div className="flex items-start justify-between gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface-2">
                {item.kind === 'ticket' ? (
                  <LifeBuoy className="h-4 w-4 text-gold" />
                ) : (
                  <Landmark className="h-4 w-4 text-gold" />
                )}
              </span>
              <TranscriptStatus item={item} />
            </div>
            <p className="mt-3 font-mono text-[10.5px] text-faint">{item.reference}</p>
            <p className="mt-1 truncate text-[13px] font-medium text-ink">{item.title}</p>
            <p className="mt-0.5 text-[10.5px] text-faint">{item.categoryLabel}</p>
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-line/60 pt-2.5 text-[10.5px] text-faint">
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" /> {item.messageCount} messages
              </span>
              <span>{item.closedAt ? dateTime(item.closedAt) : '—'}</span>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

export function TranscriptsPage() {
  return <TranscriptListPage mode="user" />;
}

export function AdminTranscriptsPage() {
  return <TranscriptListPage mode="admin" />;
}

function TranscriptListPage({ mode }: { mode: TranscriptMode }) {
  const { query, kind, setKind, page, setPage } = useTranscriptList(mode);
  const { user } = useAuth();
  const data = query.data;
  // Cashier transcripts reuse the existing credits.adjust permission. Support
  // agents keep ticket access without seeing financial conversations.
  const showCashier = mode === 'user' || Boolean(user && roleHasPermission(user.role, 'credits.adjust'));
  const tabs = showCashier ? KIND_TABS : KIND_TABS.filter((tab) => tab.key !== 'cashier');

  return (
    <div>
      <PageHeader
        breadcrumbs={mode === 'admin' ? [{ label: 'Admin', to: '/admin' }, { label: 'Transcripts' }] : undefined}
        title={mode === 'admin' ? 'All transcripts' : 'My transcripts'}
        description={
          mode === 'admin'
            ? 'Every completed ticket and cashier conversation, readable on the website. Cashier transcripts follow existing cashier permissions.'
            : 'Permanent read-only copies of your closed support tickets and completed cashier requests.'
        }
        actions={
          <Link to={mode === 'admin' ? '/admin/tickets' : '/tickets'}>
            <Button variant="secondary" leftIcon={<ArrowLeft className="h-4 w-4" />}>
              {mode === 'admin' ? 'Support desk' : 'My tickets'}
            </Button>
          </Link>
        }
      />

      <Alert tone="info" className="mb-4" title="Permanent records">
        Transcripts are read-only. Closed tickets and decided cashier requests cannot be reopened or receive new
        messages, and every transcript stays available after closure.
      </Alert>

      <Card>
        <div className="border-b border-line p-4">
          <Tabs items={tabs} value={kind ?? 'all'} onChange={setKind} />
        </div>
        <TranscriptListBody mode={mode} data={data} loading={query.loading} error={query.error} />
        {data && data.total > 0 && (
          <Pagination
            page={page}
            totalPages={data.totalPages}
            total={data.total}
            onPage={setPage}
            unit="transcripts"
          />
        )}
      </Card>
    </div>
  );
}

function TranscriptEventRow({ event }: { event: TranscriptDetail['events'][number] }) {
  return (
    <div className="flex gap-3 border-b border-line/60 py-2.5 last:border-0">
      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gold/70" />
      <div className="min-w-0">
        <p className="text-[11.5px] text-ink">
          {titleCase(event.type.replace(/_/g, ' '))}
          <span className="text-faint"> · {event.actorName}</span>
        </p>
        <p className="mt-0.5 text-[10.5px] leading-relaxed text-faint">
          {event.fromValue || event.toValue ? `${event.fromValue ?? '—'} → ${event.toValue ?? '—'} · ` : ''}
          {event.note ? `${event.note} · ` : ''}
          {dateTime(event.createdAt)}
        </p>
      </div>
    </div>
  );
}

export function TranscriptDetailPage() {
  const { kind = '', reference = '' } = useParams();
  const { user } = useAuth();
  const validKind = isKind(kind) ? kind : null;
  const query = useApiQuery<{ transcript: TranscriptDetail }>(
    validKind && reference ? `/transcripts/${validKind}/${encodeURIComponent(reference)}` : null,
  );
  const transcript = query.data?.transcript;
  const backToList = user?.role === 'user' ? '/transcripts' : '/admin/transcripts';
  const staff = user?.role !== 'user';
  const canOpenSource =
    transcript &&
    (transcript.kind === 'ticket'
      ? true
      : transcript.requester.id === user?.id || Boolean(user && roleHasPermission(user.role, 'credits.adjust')));
  const sourcePath =
    transcript?.kind === 'ticket'
      ? staff
        ? `/staff/tickets/${transcript.reference}`
        : `/tickets/${transcript.reference}`
      : `/cashier/${transcript?.reference ?? ''}`;

  if (query.loading) return <LoadingBlock label="Opening transcript" />;
  if (!transcript) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[{ label: 'Transcripts', to: backToList }, { label: reference }]}
          title="Transcript unavailable"
        />
        <Card className="p-6">
          <EmptyState
            icon={<ScrollText className="h-5 w-5" />}
            title="We could not open this transcript"
            description={query.error ?? 'It may belong to another account, or the reference is incorrect.'}
            action={
              <Link to={backToList}>
                <Button variant="secondary">Back to transcripts</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Transcripts', to: backToList }, { label: transcript.reference }]}
        title={transcript.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11.5px] text-gold">{transcript.reference}</span>
            <span className="text-faint">·</span>
            <span>{transcript.categoryLabel}</span>
            <span className="text-faint">·</span>
            <span>{transcript.requester.username}</span>
          </span>
        }
        badge={<TranscriptStatus item={transcript} />}
        actions={
          <>
            {canOpenSource && (
              <Link to={sourcePath}>
                <Button variant="ghost" leftIcon={<ArrowLeft className="h-4 w-4" />}>
                  Open request
                </Button>
              </Link>
            )}
            <Link to={backToList}>
              <Button variant="secondary" leftIcon={<ArrowLeft className="h-4 w-4" />}>
                All transcripts
              </Button>
            </Link>
          </>
        }
      />

      <Alert
        tone="info"
        className="mb-5"
        title={
          transcript.kind === 'ticket' && transcript.status === 'closed'
            ? 'Permanently closed'
            : 'Read-only archive'
        }
      >
        {transcript.kind === 'ticket' && transcript.status === 'closed'
          ? 'This ticket is permanently closed. You can read the full message history, but no one can reply or reopen it.'
          : 'This is a permanent read-only snapshot of the conversation. It cannot receive new messages.'}
      </Alert>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          {transcript.description && (
            <Card className="p-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Original request</p>
              <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-ink/90">{transcript.description}</p>
              <p className="mt-3 text-[10.5px] text-faint">
                By {transcript.requester.username} · {dateTime(transcript.createdAt)}
              </p>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Conversation"
              description="Complete transcript in chronological order."
              action={<Badge tone="neutral">{transcript.messages.length}</Badge>}
            />
            <div className="space-y-4 px-5 py-5">
              {transcript.messages.length === 0 && (
                <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[12px] text-faint">
                  No messages were recorded for this conversation.
                </p>
              )}
              {transcript.messages.map((entry) => {
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
                    </div>
                  );
                }
                const fromRequester = entry.authorRole === 'user';
                return (
                  <div key={entry.id} className={cn('flex gap-2.5', fromRequester ? 'justify-start' : 'justify-end')}>
                    {fromRequester && <Avatar name={entry.authorName} size={30} />}
                    <div className={cn('max-w-[82%]', !fromRequester && 'text-right')}>
                      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-faint">
                        <span className="font-medium text-muted">{entry.authorName}</span>
                        <Badge tone={fromRequester ? 'neutral' : 'gold'}>
                          {fromRequester ? 'Requester' : entry.authorRole === 'system' ? 'System' : ROLE_LABELS[entry.authorRole]}
                        </Badge>
                        <span>{dateTime(entry.createdAt)}</span>
                      </div>
                      <div
                        className={cn(
                          'whitespace-pre-wrap rounded-xl border px-3.5 py-2.5 text-left text-[12.5px] leading-relaxed',
                          fromRequester
                            ? 'rounded-tl-sm border-line bg-surface-2 text-ink/90'
                            : 'rounded-tr-sm border-gold/20 bg-gold/6 text-ink/90',
                        )}
                      >
                        {entry.body}
                      </div>
                    </div>
                    {!fromRequester && <Avatar name={entry.authorName} size={30} />}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Transcript details" />
            <dl className="space-y-3 p-5 text-[12px]">
              {[
                ['Reference', <span className="font-mono text-[11px]">{transcript.reference}</span>],
                ['Type', <KindBadge kind={transcript.kind} />],
                ['Status', <TranscriptStatus item={transcript} />],
                ['Creator', transcript.requester.username],
                ['Assigned staff', transcript.assignee ?? 'Unassigned'],
                ['Created', dateTime(transcript.createdAt)],
                [
                  closedLabel(transcript),
                  transcript.closedAt ? dateTime(transcript.closedAt) : '—',
                ],
                ...(typeof transcript.amount === 'number' ? [['Amount', `${money(transcript.amount)} money`]] : []),
                ['Messages', String(transcript.messages.length)],
              ].map(([label, value], index) => (
                <div
                  key={index}
                  className="flex items-start justify-between gap-3 border-b border-line/60 pb-2.5 last:border-0 last:pb-0"
                >
                  <dt className="text-muted">{label as string}</dt>
                  <dd className="text-right text-ink">{value as React.ReactNode}</dd>
                </div>
              ))}
            </dl>
            {transcript.canSeeInternalNotes && (
              <div className="flex items-start gap-2 border-t border-line px-4 py-3 text-[10.5px] text-faint">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
                You can see internal staff notes because your role has support permissions.
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5" /> History
                </span>
              }
            />
            <div className="max-h-[420px] overflow-y-auto px-4 py-2">
              {transcript.events.length === 0 ? (
                <p className="py-2 text-[11.5px] text-faint">No status events were recorded.</p>
              ) : (
                transcript.events.map((event) => <TranscriptEventRow key={event.id} event={event} />)
              )}
            </div>
          </Card>

          <div className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-1 p-4">
            <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
            <p className="text-[10.5px] leading-relaxed text-faint">
              Access is checked on every request. A player can only open their own transcripts; staff see the scopes
              allowed by their existing role permissions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
