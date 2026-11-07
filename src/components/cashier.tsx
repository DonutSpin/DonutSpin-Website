import { useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Send } from 'lucide-react';
import {
  ROLE_LABELS,
  type CashierMessage,
  type CashierRequestKind,
  type CashierRequestStatus,
} from '../../shared/types';
import { timeAgo } from '../lib/format';
import { Avatar, Badge, Button, Textarea, cn } from './ui';

export const CASHIER_KIND_LABELS: Record<CashierRequestKind, string> = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
};

export const CASHIER_STATUS_LABELS: Record<CashierRequestStatus, string> = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

const kindTones: Record<CashierRequestKind, 'success' | 'warning'> = {
  deposit: 'success',
  withdrawal: 'warning',
};

const statusTones: Record<CashierRequestStatus, 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

export function CashierKindIcon({ kind, className }: { kind: CashierRequestKind; className?: string }) {
  const Icon = kind === 'deposit' ? ArrowDownToLine : ArrowUpFromLine;
  return <Icon className={className} />;
}

export function CashierKindBadge({ kind }: { kind: CashierRequestKind }) {
  return (
    <Badge tone={kindTones[kind]}>
      <CashierKindIcon kind={kind} className="h-3 w-3" />
      {CASHIER_KIND_LABELS[kind]}
    </Badge>
  );
}

export function CashierStatusBadge({ status }: { status: CashierRequestStatus }) {
  return (
    <Badge tone={statusTones[status]} dot>
      {CASHIER_STATUS_LABELS[status]}
    </Badge>
  );
}

export function CashierThread({
  messages,
  currentUserId,
  canMessage,
  status,
  onSend,
  emptyText = 'No messages yet. Start the conversation if you need to clarify the request.',
}: {
  messages: CashierMessage[];
  currentUserId: string;
  canMessage: boolean;
  status?: CashierRequestStatus;
  onSend: (body: string) => Promise<boolean>;
  emptyText?: string;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const sent = await onSend(trimmed);
      if (sent) setBody('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {messages.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface-2/60 px-3.5 py-4 text-[12px] text-faint">{emptyText}</p>
      ) : (
        <div className="space-y-4">
          {messages.map((message) => {
            if (message.visibility === 'system') {
              return (
                <div key={message.id} className="flex flex-col items-center gap-1 py-1 text-center">
                  <p className="max-w-[90%] rounded-full border border-line bg-surface-2/60 px-3 py-1 text-[10.5px] leading-relaxed text-faint">
                    {message.body}
                  </p>
                  <span className="text-[9.5px] text-faint/70">{timeAgo(message.createdAt)}</span>
                </div>
              );
            }
            const mine = message.authorId === currentUserId;
            return (
              <div key={message.id} className={cn('flex items-start gap-2.5', mine && 'flex-row-reverse')}>
                <Avatar name={message.authorName} size={28} />
                <div className={cn('min-w-0 max-w-[86%]', mine && 'text-right')}>
                  <div className={cn('mb-1 flex flex-wrap items-center gap-1.5 text-[10px]', mine && 'justify-end')}>
                    <span className="font-medium text-ink">{message.authorName}</span>
                    <span className="text-faint">
                      {message.authorRole === 'system' ? 'System' : ROLE_LABELS[message.authorRole]}
                    </span>
                    <span className="text-faint/70">· {timeAgo(message.createdAt)}</span>
                  </div>
                  <div
                    className={cn(
                      'whitespace-pre-wrap break-words rounded-xl border px-3.5 py-2.5 text-left text-[12.5px] leading-relaxed',
                      mine ? 'border-gold/20 bg-gold/8 text-ink' : 'border-line bg-surface-2/70 text-muted',
                    )}
                  >
                    {message.body}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canMessage ? (
        <form onSubmit={(event) => void submit(event)} className="mt-5 border-t border-line pt-4">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Write a message…"
            aria-label="Message"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[10px] text-faint">Visible to the requester and platform administrators.</span>
            <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!body.trim()} leftIcon={<Send className="h-3.5 w-3.5" />}>
              Send message
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-4 border-t border-line pt-4 text-[11px] text-faint">
          {status === 'approved'
            ? 'This request was approved. The conversation is now read-only.'
            : status === 'rejected'
              ? 'This request was rejected. The conversation is now read-only.'
              : status === 'cancelled'
                ? 'This request was cancelled. Open a new request if you need to continue.'
                : 'This conversation is closed and can no longer receive messages.'}
        </p>
      )}
    </div>
  );
}
