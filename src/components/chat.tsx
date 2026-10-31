import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CloudRain, Crown, MessageCircle, Send, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import type { ChatPostResponse, ChatResponse, Role } from '../../shared/types';
import { CHAT_MESSAGE_MAX_LENGTH, CHAT_ROLE_LABELS } from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, errorMessage } from '../lib/api';
import { timeAgo } from '../lib/format';
import { RainCard } from './rain';
import { Badge, Button, Card, Input, cn, type Tone } from './ui';

const POLL_MS = 4000;

const CHAT_ROLE_TONES: Record<Role, Tone> = {
  user: 'neutral',
  support: 'info',
  moderator: 'violet',
  admin: 'gold',
  owner: 'gold',
};

/** Compact role label; `Member` is shown for every normal player. */
export function ChatRoleBadge({ role }: { role: Role }) {
  return (
    <Badge tone={CHAT_ROLE_TONES[role]} className="gap-1 px-1.5 py-0.5 text-[9px] tracking-[0.02em]">
      {role === 'owner' && <Crown className="h-2.5 w-2.5" />}
      {role === 'admin' && <ShieldCheck className="h-2.5 w-2.5" />}
      {CHAT_ROLE_LABELS[role]}
    </Badge>
  );
}

export function MobileChatDock() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+9.5rem)] right-4 z-30 flex h-11 items-center gap-2 rounded-full border border-gold/30 bg-gradient-to-r from-gold/[0.18] via-surface-1 to-surface-1 px-3.5 text-[12px] font-semibold text-gold-bright shadow-[0_16px_38px_-16px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl transition-all hover:border-gold/50 active:scale-[0.98] lg:bottom-6 xl:hidden"
        aria-label="Open room chat"
      >
        <span className="relative grid h-7 w-7 place-items-center rounded-full bg-gold/12">
          <MessageCircle className="h-4 w-4" />
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-success shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
        </span>
        Chat
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] xl:hidden" role="dialog" aria-modal="true" aria-label="Room chat">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 right-0 w-full max-w-[420px] border-l border-line-strong/60 bg-surface-1 shadow-[-30px_0_80px_-30px_rgba(0,0,0,0.95)] animate-slide-in-right">
            <ChatPanel variant="drawer" onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}

export function ChatPanel({
  className,
  variant = 'inline',
  onClose,
}: {
  className?: string;
  variant?: 'inline' | 'drawer';
  onClose?: () => void;
}) {
  const drawer = variant === 'drawer';
  const { user } = useAuth();
  const { error: toastError } = useToast();
  const [data, setData] = useState<ChatResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  const load = useCallback(async () => {
    try {
      const response = await api.get<ChatResponse>('/chat');
      setData(response);
      setError(null);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const element = listRef.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior });
  }, []);

  const onScroll = () => {
    const element = listRef.current;
    if (!element) return;
    stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  };

  useEffect(() => {
    if (!stickToBottom.current) return;
    const frame = window.requestAnimationFrame(() => scrollToBottom());
    return () => window.cancelAnimationFrame(frame);
  }, [data?.messages.length, scrollToBottom]);

  const messages = data?.messages ?? [];
  const activeRains = data?.activeRains ?? [];
  const latestRain = data?.latestRain ?? null;
  const verified = data?.verified ?? false;

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = body.trim();
    if (!text || sending || !verified) return;
    setSending(true);
    setSendError(null);
    try {
      const response = await api.post<ChatPostResponse>('/chat/messages', { body: text });
      setBody('');
      stickToBottom.current = true;
      setData((current) =>
        current ? { ...current, messages: [...current.messages, response.message] } : current,
      );
      window.requestAnimationFrame(() => scrollToBottom('smooth'));
    } catch (error) {
      const message = errorMessage(error);
      setSendError(message);
      toastError('Message not sent', message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Card
      className={cn(
        drawer
          ? 'flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0 bg-surface-1'
          : 'flex h-[calc(100vh-8.5rem)] min-h-[540px] max-h-[820px] flex-col overflow-hidden border-line/90 bg-surface-1/80 xl:sticky xl:top-6',
        className,
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl border border-gold/25 bg-gold/10 text-gold">
            <MessageCircle className="h-4 w-4" />
          </span>
          <div>
            <p className="font-display text-[14px] font-semibold text-ink">Room chat</p>
            <p className="text-[9.5px] text-faint">Verified players only</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge tone={verified ? 'success' : 'neutral'} dot={verified}>
            {verified ? 'Live' : 'Locked'}
          </Badge>
          {drawer && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface-2 text-muted transition-colors hover:text-ink"
              aria-label="Close chat"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="shrink-0 border-b border-line/70 bg-gold/[0.03] p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-gold-dim">
            <CloudRain className="h-3 w-3" /> {activeRains.length > 0 ? 'Live rains' : 'Last rain'}
          </p>
          <Link to="/rains" className="text-[10px] font-medium text-gold hover:text-gold-bright">
            All rains
          </Link>
        </div>
        {activeRains.length > 0 ? (
          <div className="space-y-2">
            {activeRains.slice(0, 2).map((rain) => (
              <RainCard key={rain.id} rain={rain} now={now} compact onChange={() => void load()} />
            ))}
            {activeRains.length > 2 && (
              <Link to="/rains" className="block text-[10px] font-medium text-gold hover:text-gold-bright">
                +{activeRains.length - 2} more live {activeRains.length - 2 === 1 ? 'rain' : 'rains'}
              </Link>
            )}
          </div>
        ) : latestRain ? (
          <RainCard rain={latestRain} now={now} compact onChange={() => void load()} />
        ) : (
          <p className="rounded-lg border border-line/70 bg-surface-2/40 px-2.5 py-2 text-[10.5px] text-faint">
            No rain yet. Start the first one from the rains page.
          </p>
        )}
      </div>

      <div
        ref={listRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-12 animate-pulse rounded-xl bg-surface-2/60" />
            ))}
          </div>
        ) : !verified ? (
          <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 px-4 text-center">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-warning/30 bg-warning/10 text-warning">
              <ShieldAlert className="h-4 w-4" />
            </span>
            <p className="text-[12px] font-semibold text-ink">Verify your email to join the chat</p>
            <p className="max-w-[230px] text-[10.5px] leading-relaxed text-faint">
              Chat is open to verified accounts only. You can still join every live rain.
            </p>
            <Link to="/settings">
              <Button variant="secondary" size="sm">
                Verify email
              </Button>
            </Link>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-1 px-4 text-center">
            <MessageCircle className="h-5 w-5 text-gold/50" />
            <p className="text-[12px] font-medium text-ink">No messages yet</p>
            <p className="text-[10.5px] text-faint">Say hello to the room.</p>
          </div>
        ) : (
          messages.map((message) => {
            const own = Boolean(user && message.userId === user.id);
            return (
              <div
                key={message.id}
                className={cn(
                  'rounded-xl border px-3 py-2',
                  own ? 'border-gold/25 bg-gold/[0.06]' : 'border-line/70 bg-surface-2/40',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className={cn('truncate text-[10.5px] font-semibold', own ? 'text-gold-bright' : 'text-gold')}>
                      @{message.username}
                    </span>
                    <ChatRoleBadge role={message.role} />
                  </div>
                  <span className="shrink-0 text-[9px] text-faint">{timeAgo(message.createdAt)}</span>
                </div>
                <p className="mt-1 break-words text-[11.5px] leading-relaxed text-ink/90">{message.body}</p>
              </div>
            );
          })
        )}
      </div>

      {error && (
        <div className="shrink-0 border-t border-danger/20 bg-danger/5 px-3 py-2 text-[10px] text-danger">
          {error}
        </div>
      )}

      {verified ? (
        <form onSubmit={send} className="shrink-0 border-t border-line/70 bg-surface-1/95 p-3">
          <div className="flex gap-2">
            <Input
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={CHAT_MESSAGE_MAX_LENGTH}
              placeholder="Message the room…"
              className="h-9 min-w-0 flex-1 text-[12px]"
              aria-label="Chat message"
              disabled={sending}
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={sending}
              disabled={!body.trim() || sending}
              aria-label="Send message"
              className="shrink-0 px-3"
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[9px] text-faint">
            <span>{sendError ?? 'Messages are visible to every verified player.'}</span>
            <span className="tnum">
              {body.length}/{CHAT_MESSAGE_MAX_LENGTH}
            </span>
          </div>
        </form>
      ) : (
        <div className="shrink-0 border-t border-line/70 px-3 py-2 text-[9.5px] text-faint">
          Verify your email address in Settings to send messages.
        </div>
      )}
    </Card>
  );
}
