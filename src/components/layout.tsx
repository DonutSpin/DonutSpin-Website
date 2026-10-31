import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Archive,
  ArrowLeftRight,
  Bell,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  CloudRain,
  Coins,
  Gamepad2,
  Gauge,
  Gift,
  Headset,
  Home,
  Inbox,
  Mail,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Megaphone,
  Menu,
  PauseCircle,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  ShieldX,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  TrendingUp,
  UserCheck,
  Users,
  UserX,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { ROLE_LABELS, roleHasPermission, type NotificationItem, type Permission, type Role } from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, errorMessage } from '../lib/api';
import { exactMoney, money, timeAgo, titleCase } from '../lib/format';
import { MaintenanceBanner } from '../pages/maintenance';
import { MobileChatDock } from './chat';
import { LegalDisclaimer, LegalFooterLinks } from './legal';
import { BrandMark } from './BrandMark';
import { Avatar, Badge, Button, Modal, RoleBadge, Spinner, cn } from './ui';

/* ------------------------------- route guards ---------------------------- */

export function Splash({ message }: { message?: string }) {
  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="flex flex-col items-center gap-4">
        <div className="animate-reward grid h-16 w-16 place-items-center rounded-3xl border border-gold/30 bg-gradient-to-br from-gold/20 to-transparent shadow-[0_20px_50px_-24px_rgba(230,194,122,0.7)]">
          <BrandMark className="h-9 w-9" />
        </div>
        <div className="text-center">
          <p className="font-display text-xl font-semibold tracking-[0.2em] text-ink">DONUTCASH</p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.24em] text-faint">DonutSMP casino</p>
        </div>
        {message ? (
          <p className="text-[13px] text-danger">{message}</p>
        ) : (
          <div className="mt-2 flex items-center gap-2 text-[12px] text-muted">
            <Spinner className="h-4 w-4" /> Shuffling the deck…
          </div>
        )}
      </div>
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, bootError, refresh } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (bootError && !user) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface-0 px-6">
        <div className="max-w-sm text-center">
          <p className="font-display text-lg text-ink">The server is not answering</p>
          <p className="mt-2 text-[13px] text-muted">{bootError}</p>
          <Button className="mt-5" variant="primary" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <>{children}</>;
}

export function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!roleHasPermission(user.role, permission)) return <AccessDenied />;
  return <>{children}</>;
}

export function AccessDenied() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl border border-danger/25 bg-danger/8">
        <ShieldX className="h-7 w-7 text-danger" />
      </div>
      <h1 className="mt-5 font-display text-2xl font-semibold text-ink">Access restricted</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        Your role does not include permission to view this area. If you believe this is a mistake, contact an administrator.
      </p>
      <Button className="mt-6" variant="secondary" onClick={() => window.history.back()}>
        Go back
      </Button>
    </div>
  );
}

/* ---------------------------------- shell -------------------------------- */

interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
  permission?: Permission;
  badge?: 'notifications';
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

function playerNav(): NavGroup[] {
  return [
    {
      title: 'Play',
      items: [
        { label: 'Home', to: '/', icon: LayoutDashboard, end: true },
        { label: 'Games', to: '/games', icon: Gamepad2 },
        { label: 'Giveaways', to: '/giveaways', icon: Trophy },
        { label: 'Rains', to: '/rains', icon: CloudRain },
        { label: 'Rewards', to: '/rewards', icon: Gift },
        { label: 'Wallet', to: '/wallet', icon: Wallet },
        { label: 'Cashier', to: '/cashier', icon: Landmark },
        { label: 'Transactions', to: '/transactions', icon: ArrowLeftRight },
      ],
    },
    {
      title: 'Support',
      items: [
        { label: 'My tickets', to: '/tickets', icon: LifeBuoy },
        { label: 'Notifications', to: '/notifications', icon: Bell, badge: 'notifications' },
      ],
    },
    {
      title: 'Account',
      items: [{ label: 'Settings', to: '/settings', icon: Settings }],
    },
  ];
}

function staffNav(role: Role): NavGroup[] {
  return [
    {
      title: 'Workspace',
      items: [
        { label: 'Overview', to: '/staff', icon: Gauge, end: true },
        { label: 'Ticket inbox', to: '/staff/inbox', icon: Inbox },
        { label: 'Assigned to me', to: '/staff/assigned', icon: UserCheck },
        { label: 'Unassigned', to: '/staff/unassigned', icon: UserX },
        { label: 'On hold', to: '/staff/on-hold', icon: PauseCircle },
        { label: 'Account reviews', to: '/staff/reviews', icon: ClipboardList, permission: 'accounts.review' },
        { label: 'Closed', to: '/staff/closed', icon: Archive },
        { label: 'Ticket search', to: '/staff/search', icon: Search },
      ],
    },
    {
      title: 'Insights',
      items: [
        { label: 'Game statistics', to: '/staff/games', icon: ChartNoAxesCombined },
        { label: 'Giveaways', to: '/staff/giveaways', icon: Trophy, permission: 'giveaways.manage' },
        { label: 'My activity', to: '/staff/activity', icon: Activity },
      ],
    },
    {
      title: 'Switch workspace',
      items: [
        { label: 'Player area', to: '/', icon: Gamepad2 },
        ...(roleHasPermission(role, 'admin.access')
          ? [{ label: 'Admin panel', to: '/admin', icon: ShieldCheck }]
          : []),
      ],
    },
  ];
}

function adminNav(role: Role): NavGroup[] {
  const groups: NavGroup[] = [
    {
      title: 'Command',
      items: [
        { label: 'Overview', to: '/admin', icon: Gauge, end: true },
        { label: 'Users', to: '/admin/users', icon: Users, permission: 'users.read' },
        { label: 'Staff & roles', to: '/admin/staff', icon: Headset, permission: 'staff.manage' },
      ],
    },
    {
      title: 'Support & economy',
      items: [
        { label: 'Support desk', to: '/admin/tickets', icon: LifeBuoy },
        { label: 'Account reviews', to: '/admin/reviews', icon: ClipboardList, permission: 'accounts.review' },
        { label: 'Cashier requests', to: '/admin/cashier', icon: Landmark, permission: 'credits.adjust' },
        { label: 'Economy', to: '/admin/economy', icon: Coins, permission: 'economy.read' },
        { label: 'Ledger', to: '/admin/transactions', icon: ScrollText, permission: 'economy.read' },
      ],
    },
    {
      title: 'Platform',
      items: [
        { label: 'Game configuration', to: '/admin/games', icon: Gamepad2, permission: 'games.manage' },
        { label: 'Game statistics', to: '/admin/game-stats', icon: ChartNoAxesCombined, permission: 'staff.access' },
        { label: 'Giveaways', to: '/admin/giveaways', icon: Trophy, permission: 'giveaways.manage' },
        { label: 'Rain', to: '/admin/rain', icon: CloudRain, permission: 'rain.manage' },
        { label: 'Rewards', to: '/admin/rewards', icon: Gift, permission: 'settings.manage' },
        { label: 'Email', to: '/admin/email', icon: Mail, permission: 'settings.manage' },
        { label: 'Announcements', to: '/admin/announcements', icon: Megaphone, permission: 'notifications.broadcast' },
        { label: 'Audit log', to: '/admin/audit', icon: TrendingUp, permission: 'audit.read' },
        { label: 'Settings', to: '/admin/settings', icon: SlidersHorizontal, permission: 'settings.manage' },
      ],
    },
    {
      title: 'Switch workspace',
      items: [
        { label: 'Player area', to: '/', icon: Gamepad2 },
        { label: 'Staff workspace', to: '/staff', icon: Headset, permission: 'staff.access' },
      ],
    },
  ];
  return groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || roleHasPermission(role, item.permission)),
  }));
}

function navFor(pathname: string, role: Role): { groups: NavGroup[]; label: string; to: string } {
  if (pathname.startsWith('/admin')) {
    return { groups: adminNav(role), label: 'Admin control panel', to: '/admin' };
  }
  if (pathname.startsWith('/staff')) {
    return { groups: staffNav(role), label: 'Staff workspace', to: '/staff' };
  }
  return { groups: playerNav(), label: 'Player area', to: '/' };
}

function Brand() {
  return (
    <Link to="/" className="group flex items-center gap-3">
      <span className="relative grid h-10 w-10 place-items-center rounded-2xl border border-gold/30 bg-gradient-to-br from-gold/22 via-gold/10 to-transparent shadow-[0_8px_24px_-14px_rgba(230,194,122,0.8),inset_0_1px_0_rgba(255,255,255,0.1)] transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-[1.03]">
        <span className="absolute inset-0 rounded-2xl bg-gold/10 blur-lg opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <BrandMark className="relative h-[23px] w-[23px]" />
      </span>
      <span className="min-w-0">
        <span className="block font-display text-[15px] font-bold tracking-[0.17em] text-ink">DONUTCASH</span>
        <span className="block text-[8.5px] font-semibold uppercase tracking-[0.22em] text-gold-dim">DonutSMP casino</span>
      </span>
    </Link>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, unread, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { groups, label } = navFor(location.pathname, user?.role ?? 'user');

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[76px] items-center justify-between px-5">
        <Brand />
      </div>
      <div className="mx-4 mb-4 flex items-center gap-2.5 rounded-xl border border-gold/15 bg-gradient-to-r from-gold/[0.08] to-transparent px-3 py-2.5">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold/50" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-gold" />
        </span>
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-gold-dim">{label}</span>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-5">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="px-3 pb-2 text-[9px] font-bold uppercase tracking-[0.18em] text-faint/90">{group.title}</p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[12.5px] font-medium transition-all duration-200',
                        isActive
                          ? 'bg-gradient-to-r from-gold/[0.14] to-gold/[0.03] text-gold-bright shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                          : 'text-muted hover:bg-white/[0.04] hover:text-ink',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gold shadow-[0_0_12px_rgba(230,194,122,0.7)]" />
                        )}
                        <span
                          className={cn(
                            'grid h-7 w-7 place-items-center rounded-lg transition-colors',
                            isActive ? 'bg-gold/10 text-gold' : 'text-faint group-hover:text-muted',
                          )}
                        >
                          <Icon className="h-[16px] w-[16px]" strokeWidth={isActive ? 2.2 : 1.8} />
                        </span>
                        <span className="flex-1">{item.label}</span>
                        {item.badge === 'notifications' && unread > 0 && (
                          <span className="rounded-full bg-gold px-1.5 py-0.5 text-[9px] font-bold text-[#1a1408] tnum shadow-[0_0_10px_-2px_rgba(230,194,122,0.8)]">
                            {unread > 99 ? '99+' : unread}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-line/80 p-3.5">
        <div className="flex items-center gap-2.5 rounded-xl border border-line/80 bg-white/[0.025] p-2.5 transition-colors hover:border-line-strong/80 hover:bg-white/[0.04]">
          <Avatar name={user?.username ?? '?'} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold text-ink">{user?.username}</p>
            <p className="truncate text-[10px] text-faint">{user ? ROLE_LABELS[user.role] : ''}</p>
          </div>
          <button
            type="button"
            title="Sign out"
            onClick={() => {
              void logout().then(() => navigate('/login'));
            }}
            className="rounded-lg p-1.5 text-faint transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="mt-2.5 px-1 text-[9px] leading-relaxed text-faint/80">
          DonutSMP money · Deposit and withdraw through the cashier.
        </p>
      </div>
    </div>
  );
}

function NotificationMenu() {
  const { unread, setUnread } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .get<{ items: NotificationItem[]; unread: number }>('/me/notifications?pageSize=6')
      .then((data) => {
        setItems(data.items);
        setUnread(data.unread);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open, setUnread]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const markAllRead = async () => {
    try {
      await api.post('/me/notifications/read-all');
      setUnread(0);
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
    } catch {
      /* noop */
    }
  };

  const openItem = async (item: NotificationItem) => {
    try {
      if (!item.readAt) await api.post(`/me/notifications/${item.id}/read`);
      setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, readAt: entry.readAt ?? new Date().toISOString() } : entry)));
      setUnread(Math.max(0, unread - (item.readAt ? 0 : 1)));
    } finally {
      setOpen(false);
      if (item.link) navigate(item.link);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface-2 text-muted transition-colors hover:text-ink"
        aria-label="Notifications"
      >
        <Bell className="h-[17px] w-[17px]" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-gold px-1 text-[9px] font-bold text-[#1a1408]">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-[340px] overflow-hidden rounded-xl border border-line bg-surface-1 shadow-2xl animate-pop-in">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="font-display text-[13px] font-semibold">Notifications</p>
            {unread > 0 && (
              <button onClick={() => void markAllRead()} className="text-[11px] font-medium text-gold hover:text-gold-bright">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-[12.5px] text-faint">You're all caught up.</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => void openItem(item)}
                  className="flex w-full gap-2.5 border-b border-line/60 px-4 py-3 text-left transition-colors last:border-0 hover:bg-surface-2"
                >
                  <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', item.readAt ? 'bg-line-strong' : 'bg-gold')} />
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium text-ink">{item.title}</span>
                    <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-relaxed text-muted">{item.body}</span>
                    <span className="mt-1 block text-[10px] text-faint">{timeAgo(item.createdAt)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-line px-4 py-2.5 text-center text-[11.5px] font-medium text-gold hover:bg-surface-2"
          >
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}

function EmailVerifyBanner() {
  const { user } = useAuth();
  if (!user || user.emailVerified) return null;
  return (
    <div className="border-b border-gold/15 bg-gradient-to-r from-gold/[0.09] via-gold/[0.04] to-transparent">
      <div className="mx-auto flex max-w-[1460px] flex-wrap items-center gap-2 px-4 py-2.5 sm:px-6 lg:px-8">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-gold/25 bg-gold/10 text-gold">
          <Mail className="h-3.5 w-3.5" />
        </span>
        <p className="min-w-0 flex-1 text-[11.5px] text-muted">
          Verify your email before placing bets. Open Settings to resend the verification email.
        </p>
        <Link
          to="/settings#email"
          className="inline-flex items-center gap-1 rounded-lg border border-gold/30 bg-gold/10 px-2.5 py-1 text-[11px] font-semibold text-gold-bright transition-colors hover:bg-gold/15"
        >
          Verify email <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

function AccountHoldBanner() {
  const { user } = useAuth();
  if (!user?.accountHold) return null;
  return (
    <div className="border-b border-warning/20 bg-gradient-to-r from-warning/[0.1] via-warning/[0.04] to-transparent">
      <div className="mx-auto flex max-w-[1460px] flex-wrap items-center gap-2 px-4 py-2.5 sm:px-6 lg:px-8">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-warning/30 bg-warning/10 text-warning">
          <LifeBuoy className="h-3.5 w-3.5" />
        </span>
        <p className="min-w-0 flex-1 text-[11.5px] text-muted">
          Your account is under review. Betting, bonuses, and cashier requests are paused until support resolves the hold.
        </p>
        <Link
          to="/tickets/new"
          className="inline-flex items-center gap-1 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1 text-[11px] font-semibold text-warning transition-colors hover:bg-warning/15"
        >
          Contact support <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!user) return null;
  const area = location.pathname.startsWith('/admin') ? 'admin' : location.pathname.startsWith('/staff') ? 'staff' : 'player';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 py-1 pl-1 pr-2 transition-colors hover:bg-surface-3"
      >
        <Avatar name={user.username} size={27} />
        <span className="hidden text-[12px] font-medium text-ink sm:block">{user.username}</span>
        <ChevronDown className="h-3.5 w-3.5 text-faint" />
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-xl border border-line bg-surface-1 shadow-2xl animate-pop-in">
          <div className="border-b border-line px-3.5 py-3">
            <p className="truncate text-[13px] font-medium text-ink">{user.username}</p>
            <p className="truncate text-[11px] text-muted">{user.email}</p>
            <div className="mt-2">
              <RoleBadge role={user.role} />
            </div>
          </div>
          <div className="p-1">
            {[
              { label: 'Profile & security', to: '/settings' },
              { label: 'My tickets', to: '/tickets' },
              ...(user.permissions.includes('staff.access') && area !== 'staff'
                ? [{ label: 'Staff workspace', to: '/staff' }]
                : []),
              ...(user.permissions.includes('admin.access') && area !== 'admin'
                ? [{ label: 'Admin panel', to: '/admin' }]
                : []),
              ...(area !== 'player' ? [{ label: 'Player area', to: '/' }] : []),
            ].map((item) => (
              <button
                key={item.to}
                onClick={() => {
                  setOpen(false);
                  navigate(item.to);
                }}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[12.5px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                {item.label}
                <ChevronRight className="h-3.5 w-3.5 text-faint" />
              </button>
            ))}
            <button
              onClick={() => {
                setOpen(false);
                void logout().then(() => navigate('/login'));
              }}
              className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-line px-2.5 py-2 text-left text-[12.5px] text-danger transition-colors hover:bg-danger/8"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ActiveRoundConflict {
  game: string;
  sessionId: string;
  status: 'playing' | 'settled';
}

function ActiveRoundNotice() {
  const [conflict, setConflict] = useState<ActiveRoundConflict | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ActiveRoundConflict | null>).detail;
      if (detail?.game) setConflict(detail);
    };
    window.addEventListener('donutcash:active-round', handler);
    return () => window.removeEventListener('donutcash:active-round', handler);
  }, []);

  return (
    <Modal
      open={Boolean(conflict)}
      onClose={() => setConflict(null)}
      title="Finish your current game first."
      description="Only one bet can be active at a time."
      footer={
        <>
          <Button variant="ghost" onClick={() => setConflict(null)}>
            Not now
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              const game = conflict?.game;
              setConflict(null);
              if (game) navigate(`/games/${game}`);
            }}
          >
            Resume {conflict ? titleCase(conflict.game) : 'game'}
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-muted">
        You already have {conflict?.status === 'settled' ? 'a result waiting to be cleared' : 'a round in progress'} in{' '}
        {conflict ? titleCase(conflict.game) : 'another game'}. Finish or clear that round before starting a new bet.
      </p>
    </Modal>
  );
}

function MobileBottomNav({ onMenu }: { onMenu: () => void }) {
  const { unread } = useAuth();
  const items = [
    { label: 'Home', to: '/', icon: Home, end: true },
    { label: 'Games', to: '/games', icon: Gamepad2 },
    { label: 'Giveaways', to: '/giveaways', icon: Trophy },
    { label: 'Rewards', to: '/rewards', icon: Gift, badge: true },
    { label: 'Wallet', to: '/wallet', icon: Wallet },
  ];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line/80 bg-surface-1/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      aria-label="Primary"
    >
      <div className="mx-auto grid max-w-md grid-cols-5 px-2 py-1.5">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'relative flex flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-[9.5px] font-semibold transition-colors',
                  isActive ? 'text-gold-bright' : 'text-faint hover:text-muted',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cn('relative grid h-7 w-12 place-items-center rounded-full transition-colors', isActive && 'bg-gold/10')}>
                    <Icon className="h-[18px] w-[18px]" strokeWidth={isActive ? 2.3 : 1.8} />
                    {item.badge && unread > 0 && (
                      <span className="absolute right-2 top-0.5 h-1.5 w-1.5 rounded-full bg-gold shadow-[0_0_6px_rgba(230,194,122,0.8)]" />
                    )}
                  </span>
                  {item.label}
                </>
              )}
            </NavLink>
          );
        })}
        <button
          type="button"
          onClick={onMenu}
          className="relative flex flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-[9.5px] font-semibold text-faint transition-colors hover:text-muted"
        >
          <span className="grid h-7 w-12 place-items-center">
            <Menu className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </span>
          More
        </button>
      </div>
    </nav>
  );
}

export function AppShell() {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { groups, label } = navFor(location.pathname, user?.role ?? 'user');
  const isPlayerArea = !location.pathname.startsWith('/admin') && !location.pathname.startsWith('/staff');

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  if (!user) return null;

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[272px] border-r border-line/80 bg-surface-1/85 backdrop-blur-xl lg:block">
        <SidebarContent />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm animate-fade-in" onClick={() => setMobileOpen(false)} />
          <aside className="relative h-full w-[292px] max-w-[86vw] border-r border-line-strong/60 bg-surface-1 shadow-[24px_0_60px_-20px_rgba(0,0,0,0.9)] animate-slide-in-left">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-5 z-10 rounded-lg p-1.5 text-faint hover:bg-surface-2 hover:text-ink"
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {isPlayerArea && <MobileBottomNav onMenu={() => setMobileOpen(true)} />}
      {isPlayerArea && <MobileChatDock />}

      <div className="lg:pl-[272px]">
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between gap-2 border-b border-line/70 bg-surface-0/72 px-3 backdrop-blur-xl sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              onClick={() => setMobileOpen(true)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-surface-2/80 text-muted transition-colors hover:border-line-strong hover:text-ink lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            <Link to="/" className="font-display text-[13px] font-bold tracking-[0.18em] text-ink lg:hidden">
              DONUTCASH
            </Link>
            <div className="hidden items-center gap-2.5 lg:flex">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">{label}</span>
              <span className="h-3 w-px bg-line" />
              <span className="text-[12px] text-muted">
                Welcome back, <span className="font-medium text-ink">{user.username}</span>
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <Link
              to="/wallet"
              className="group flex h-9 items-center gap-2 rounded-xl border border-gold/22 bg-gradient-to-r from-gold/[0.11] to-gold/[0.03] px-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-all hover:border-gold/35 hover:from-gold/[0.16]"
              title={`${exactMoney(user.balance)} money — open wallet`}
            >
              <Coins className="h-4 w-4 text-gold" />
              <span className="font-display text-[13px] font-semibold text-gold-bright tnum">{money(user.balance)}</span>
              <span className="hidden text-[8.5px] font-bold uppercase tracking-[0.12em] text-gold-dim sm:block">money</span>
            </Link>
            <NotificationMenu />
            <UserMenu />
          </div>
        </header>

        <MaintenanceBanner />
        <AccountHoldBanner />
        <EmailVerifyBanner />
        <ActiveRoundNotice />

        <main className={cn('mx-auto w-full max-w-[1460px] px-4 pt-6 sm:px-6 lg:px-8 lg:pt-8', isPlayerArea ? 'pb-28 lg:pb-14' : 'pb-14')}>
          <div key={location.pathname} className="animate-page">
            <Outlet />
          </div>
          <footer className="mt-14 flex flex-col gap-3 border-t border-line/70 pt-5 text-[10.5px] text-faint/90">
            <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
              <p>Donutcash · The casino for DonutSMP money.</p>
              <LegalFooterLinks className="text-faint" />
            </div>
            <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
              <LegalDisclaimer className="text-[10.5px]" />
              <p className="flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-gold/60" /> Made for the DonutSMP community.
              </p>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

/* -------------------------------- page header ---------------------------- */

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="mb-2.5 flex flex-wrap items-center gap-1.5 text-[10.5px] font-medium text-faint" aria-label="Breadcrumb">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex items-center gap-1.5">
          {index > 0 && <ChevronRight className="h-3 w-3" />}
          {item.to ? (
            <Link to={item.to} className="transition-colors hover:text-gold">
              {item.label}
            </Link>
          ) : (
            <span className="text-muted">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  badge,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
  badge?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.035em] text-ink sm:text-[32px]">{title}</h1>
          {badge}
        </div>
        {description && <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-muted sm:text-[13px]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <AccessDenied />;
  return <>{children}</>;
}

export function SupportLink() {
  return (
    <Badge tone="neutral" className="gap-1">
      <LifeBuoy className="h-3 w-3" /> Support desk
    </Badge>
  );
}

export function ShellError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { push } = useToast();
  useEffect(() => {
    push({ title: 'Something went wrong', description: message, variant: 'error' });
  }, [message, push]);
  return (
    <div className="rounded-xl border border-danger/25 bg-danger/5 px-4 py-3 text-[13px] text-danger">
      {message}
      {onRetry && (
        <button onClick={onRetry} className="ml-2 underline">
          Retry
        </button>
      )}
    </div>
  );
}

export { errorMessage };
