import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  BellOff,
  CheckCheck,
  Coins,
  Info,
  LifeBuoy,
  Lock,
  Megaphone,
  ShieldCheck,
  Ticket,
  UserCheck,
} from 'lucide-react';
import type { NotificationItem, Paginated } from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, errorMessage } from '../lib/api';
import { useApiQuery } from '../lib/useApi';
import { timeAgo } from '../lib/format';
import { PageHeader } from '../components/layout';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingBlock,
  Pagination,
  Tabs,
  cn,
} from '../components/ui';

const typeIcons: Record<string, typeof Bell> = {
  ticket: Ticket,
  ticket_reply: LifeBuoy,
  ticket_status: LifeBuoy,
  ticket_assignment: UserCheck,
  credit_decision: Coins,
  wallet_adjustment: Coins,
  account: ShieldCheck,
  account_status: Lock,
  account_role: UserCheck,
  security: ShieldCheck,
  announcement: Megaphone,
  info: Info,
};

export function NotificationsPage() {
  const { unread, setUnread } = useAuth();
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<NotificationItem[]>([]);

  const query = useApiQuery<Paginated<NotificationItem> & { unread: number }>(
    `/me/notifications?page=${page}&pageSize=20&filter=${filter}`,
  );

  useEffect(() => {
    if (query.data) {
      setItems(query.data.items);
      setUnread(query.data.unread);
    }
  }, [query.data, setUnread]);

  const markAll = async () => {
    try {
      await api.post('/me/notifications/read-all');
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
      setUnread(0);
      success('All notifications marked as read');
    } catch (err) {
      toastError('Could not mark notifications', errorMessage(err));
    }
  };

  const open = async (item: NotificationItem) => {
    try {
      if (!item.readAt) {
        await api.post(`/me/notifications/${item.id}/read`);
        setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry)));
        setUnread(Math.max(0, unread - 1));
      }
    } catch {
      /* navigation still allowed */
    }
    if (item.link) navigate(item.link);
  };

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Ticket updates, cashier decisions, account events, and announcements."
        actions={
          <Button
            variant="secondary"
            onClick={() => void markAll()}
            disabled={unread === 0}
            leftIcon={<CheckCheck className="h-4 w-4" />}
          >
            Mark all read
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <Tabs
          items={[
            { key: 'all', label: 'All', count: query.data?.total },
            { key: 'unread', label: 'Unread', count: unread },
          ]}
          value={filter}
          onChange={(value) => {
            setFilter(value as 'all' | 'unread');
            setPage(1);
          }}
          className="px-2"
        />
        {query.error ? (
          <div className="p-5">
            <Alert tone="error">{query.error}</Alert>
          </div>
        ) : query.loading ? (
          <LoadingBlock label="Loading notifications" />
        ) : items.length === 0 ? (
          <EmptyState
            icon={filter === 'unread' ? <BellOff className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
            title={filter === 'unread' ? 'No unread notifications' : 'Nothing here yet'}
            description={
              filter === 'unread'
                ? 'You have read everything. New ticket replies and decisions will appear here.'
                : 'Ticket replies, assignment changes, cashier decisions, and account events will be delivered here.'
            }
          />
        ) : (
          <div className="divide-y divide-line/70">
            {items.map((item) => {
              const Icon = typeIcons[item.type] ?? Bell;
              return (
                <button
                  key={item.id}
                  onClick={() => void open(item)}
                  className={cn(
                    'flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-2/60',
                    !item.readAt && 'bg-gold/3',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border',
                      item.readAt ? 'border-line bg-surface-2 text-faint' : 'border-gold/25 bg-gold/8 text-gold',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={cn('text-[13px]', item.readAt ? 'font-medium text-ink/80' : 'font-semibold text-ink')}>
                        {item.title}
                      </span>
                      {!item.readAt && <Badge tone="gold">New</Badge>}
                    </span>
                    <span className="mt-1 block whitespace-pre-wrap text-[12px] leading-relaxed text-muted">{item.body}</span>
                    <span className="mt-1.5 block text-[10.5px] text-faint">{timeAgo(item.createdAt)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {query.data && query.data.total > 0 && (
          <Pagination page={query.data.page} totalPages={query.data.totalPages} total={query.data.total} onPage={setPage} unit="notifications" />
        )}
      </Card>
    </div>
  );
}
