/** Shared contracts between the API and the React client. */

export type Role = 'user' | 'support' | 'moderator' | 'admin' | 'owner';
export type AccountStatus = 'active' | 'restricted' | 'suspended';

export type TicketStatus =
  | 'new'
  | 'open'
  | 'in_progress'
  | 'on_hold'
  | 'waiting_user'
  | 'resolved'
  | 'closed'
  | 'rejected';

export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketMessageVisibility = 'public' | 'internal' | 'system';

export const ROLES: Role[] = ['user', 'support', 'moderator', 'admin', 'owner'];
export const STAFF_ROLES: Role[] = ['support', 'moderator', 'admin', 'owner'];

export const ROLE_LABELS: Record<Role, string> = {
  user: 'Player',
  support: 'Support',
  moderator: 'Moderator',
  admin: 'Administrator',
  owner: 'Owner',
};

export const TICKET_STATUSES: TicketStatus[] = [
  'new',
  'open',
  'in_progress',
  'on_hold',
  'waiting_user',
  'resolved',
  'closed',
  'rejected',
];

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  new: 'New',
  open: 'Open',
  in_progress: 'In progress',
  on_hold: 'On hold',
  waiting_user: 'Waiting for user',
  resolved: 'Resolved',
  closed: 'Closed',
  rejected: 'Rejected',
};

/** Status meaning, exposed in the UI so the workflow is unambiguous. */
export const TICKET_STATUS_HELP: Record<TicketStatus, string> = {
  new: 'Created and awaiting first handling.',
  open: 'Active and awaiting action.',
  in_progress: 'Actively being handled by an agent.',
  on_hold: 'Temporarily paused for a recorded reason.',
  waiting_user: 'The requester needs to provide more information.',
  resolved: 'Handled, pending final closure if required.',
  closed: 'The conversation is finished.',
  rejected: 'Declined with a recorded reason.',
};

/** Allowed server-side transitions. Anything not listed is rejected. */
export const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  new: ['open', 'in_progress', 'on_hold', 'waiting_user', 'resolved', 'closed', 'rejected'],
  open: ['in_progress', 'on_hold', 'waiting_user', 'resolved', 'closed', 'rejected'],
  in_progress: ['open', 'on_hold', 'waiting_user', 'resolved', 'closed', 'rejected'],
  on_hold: ['open', 'in_progress', 'waiting_user', 'resolved', 'closed', 'rejected'],
  waiting_user: ['open', 'in_progress', 'on_hold', 'resolved', 'closed', 'rejected'],
  resolved: ['closed', 'open', 'rejected'],
  closed: ['open'],
  rejected: ['open'],
};

/** Statuses considered "open work" in dashboards. */
export const ACTIVE_TICKET_STATUSES: TicketStatus[] = [
  'new',
  'open',
  'in_progress',
  'on_hold',
  'waiting_user',
];

export const TICKET_PRIORITIES: TicketPriority[] = ['low', 'normal', 'high', 'urgent'];

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

export const PERMISSIONS = [
  'tickets.create',
  'tickets.read_own',
  'tickets.read_all',
  'tickets.reply',
  'tickets.note',
  'tickets.assign',
  'tickets.status',
  'tickets.priority',
  'tickets.reject',
  'tickets.manage',
  'cashier.request',
  'credits.adjust',
  'users.read',
  'users.manage',
  'users.restrict',
  'roles.manage',
  'staff.manage',
  'games.play',
  'games.manage',
  'settings.manage',
  'audit.read',
  'economy.read',
  'notifications.broadcast',
  'staff.access',
  'admin.access',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PLAYER_PERMISSIONS: Permission[] = [
  'tickets.create',
  'tickets.read_own',
  'cashier.request',
  'games.play',
];

const SUPPORT_PERMISSIONS: Permission[] = [
  ...PLAYER_PERMISSIONS,
  'staff.access',
  'tickets.read_all',
  'tickets.reply',
  'tickets.note',
  'tickets.assign',
  'tickets.status',
  'tickets.priority',
  'tickets.reject',
];

const MODERATOR_PERMISSIONS: Permission[] = [
  ...SUPPORT_PERMISSIONS,
  'admin.access',
  'tickets.manage',
  'users.read',
  'users.restrict',
];

const ADMIN_PERMISSIONS: Permission[] = [
  ...MODERATOR_PERMISSIONS,
  'admin.access',
  'users.manage',
  'roles.manage',
  'staff.manage',
  'games.manage',
  'settings.manage',
  'credits.adjust',
  'audit.read',
  'economy.read',
  'notifications.broadcast',
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  user: PLAYER_PERMISSIONS,
  support: SUPPORT_PERMISSIONS,
  moderator: MODERATOR_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  owner: [...PERMISSIONS],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** The set of roles an actor may assign. Never allow self-escalation. */
export const ROLE_RANK: Record<Role, number> = {
  user: 0,
  support: 1,
  moderator: 2,
  admin: 3,
  owner: 4,
};

export interface SessionUser {
  id: string;
  username: string;
  email: string;
  role: Role;
  status: AccountStatus;
  emailVerified: boolean;
  emailNotifications: boolean;
  balance: number;
  createdAt: string;
  lastLoginAt: string | null;
  legalAcceptanceRequired: boolean;
  legalAcceptedAt: string | null;
  selfExcludedUntil: string | null;
  permissions: Permission[];
}

export interface PublicConfig {
  name: string;
  tagline: string;
  registrationOpen: boolean;
  maintenance: boolean;
  maintenanceMessage: string;
  startingCredits: number;
  rewardsEnabled: boolean;
  emailEnabled: boolean;
  turnstile: {
    enabled: boolean;
    siteKey: string;
  };
  supportCategories: SupportCategory[];
}

export interface SupportCategory {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  defaultPriority: TicketPriority;
  sortOrder: number;
}

export interface GameConfig {
  slug: string;
  name: string;
  description: string;
  enabled: boolean;
  minBet: number;
  maxBet: number;
  config: Record<string, unknown>;
  updatedAt: string;
}

export type LedgerType =
  | 'initial_grant'
  | 'admin_adjustment'
  | 'game_wager'
  | 'game_payout'
  | 'game_refund'
  | 'credit_request'
  | 'reversal';

export interface LedgerEntry {
  id: string;
  userId: string;
  username?: string;
  type: LedgerType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  refType: string | null;
  refId: string | null;
  actorId: string | null;
  actorName?: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface WalletSummary {
  balance: number;
  lifetimeWagered: number;
  lifetimeWon: number;
  net: number;
  pendingCashier: number;
}

export interface TicketSummary {
  id: string;
  reference: string;
  subject: string;
  category: string;
  categoryLabel: string;
  status: TicketStatus;
  priority: TicketPriority;
  requester: { id: string; username: string };
  assignee: { id: string; username: string } | null;
  createdAt: string;
  lastActivityAt: string;
  unread: boolean;
  hasArchivedMoneyRequest: boolean;
}

export interface TicketMessage {
  id: string;
  authorId: string | null;
  authorName: string;
  authorRole: Role | 'system';
  visibility: TicketMessageVisibility;
  body: string;
  createdAt: string;
}

export interface TicketEvent {
  id: string;
  actorName: string;
  type: string;
  fromValue: string | null;
  toValue: string | null;
  note: string | null;
  createdAt: string;
}

export type CreditRequestKind = 'grant' | 'correction' | 'missing_transaction';
export type CreditRequestStatus = 'pending' | 'approved' | 'rejected';

export interface CreditRequest {
  id: string;
  kind: CreditRequestKind;
  amount: number;
  status: CreditRequestStatus;
  requesterId: string;
  requesterName: string;
  reviewerId: string | null;
  reviewerName: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
  ledgerId: string | null;
  createdAt: string;
}

export type CashierRequestKind = 'deposit' | 'withdrawal';
export type CashierRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface CashierMessage {
  id: string;
  authorId: string | null;
  authorName: string;
  authorRole: Role | 'system';
  visibility: 'public' | 'system';
  body: string;
  createdAt: string;
}

export interface CashierRequestSummary {
  id: string;
  reference: string;
  kind: CashierRequestKind;
  amount: number;
  status: CashierRequestStatus;
  requester: { id: string; username: string; balance?: number };
  reviewer: { id: string; username: string } | null;
  decisionReason: string | null;
  decidedAt: string | null;
  ledgerId: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface CashierRequestDetail extends Omit<CashierRequestSummary, 'requester'> {
  requester: {
    id: string;
    username: string;
    email?: string;
    status?: AccountStatus;
    balance?: number;
    createdAt?: string;
  };
  messages: CashierMessage[];
  canDecide: boolean;
  canCancel: boolean;
  canMessage: boolean;
}

export interface CashierCounts {
  all: number;
  pending: number;
  approved: number;
  rejected: number;
  cancelled: number;
  deposits: number;
  withdrawals: number;
}

export interface TicketDetail {
  id: string;
  reference: string;
  subject: string;
  description: string;
  category: string;
  categoryLabel: string;
  status: TicketStatus;
  priority: TicketPriority;
  requester: { id: string; username: string; email?: string; createdAt?: string; status?: AccountStatus; balance?: number };
  assignee: { id: string; username: string } | null;
  holdReason: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  closedAt: string | null;
  messages: TicketMessage[];
  events: TicketEvent[];
  creditRequest: CreditRequest | null;
  allowedTransitions: TicketStatus[];
  canReply: boolean;
  canNote: boolean;
  canAssign: boolean;
}

/* -------------------------------- rewards -------------------------------- */

export interface RewardMilestone {
  day: number;
  amount: number;
  label: string;
}

export interface RewardClaim {
  id: string;
  day: string;
  streakDay: number;
  baseAmount: number;
  incrementAmount: number;
  milestoneAmount: number;
  milestoneLabel: string | null;
  amount: number;
  createdAt: string;
}

export interface RewardCalendarDay {
  day: string;
  label: string;
  weekday: string;
  claimed: boolean;
  isToday: boolean;
  isPast: boolean;
  reward: number | null;
}

export interface RewardsSummary {
  enabled: boolean;
  timezone: string;
  resetHour: number;
  baseAmount: number;
  incrementAmount: number;
  maxAmount: number;
  maxStreakDays: number;
  missedPolicy: 'reset' | 'grace';
  graceDays: number;
  milestones: RewardMilestone[];
  streak: number;
  claimedToday: boolean;
  todayClaim: RewardClaim | null;
  nextReward: { streakDay: number; baseAmount: number; milestoneAmount: number; total: number };
  nextResetAt: string;
  calendar: RewardCalendarDay[];
  history: RewardClaim[];
  emailNotifications: boolean;
}

export interface RewardClaimResult extends RewardsSummary {
  claim: RewardClaim;
  balance: number;
}

/* --------------------------------- email --------------------------------- */

export type EmailJobStatus = 'pending' | 'sending' | 'sent' | 'failed';

export interface EmailJobSummary {
  id: string;
  recipient: string;
  template: string;
  status: EmailJobStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface EmailSettingsView {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  securityNotifications: boolean;
  rewardNotifications: boolean;
  smtpPassSet: boolean;
  smtpPassSource: 'database' | 'environment' | 'none';
  lastTestAt: string | null;
  lastError: string | null;
  queue: EmailJobSummary[];
  counts: { pending: number; sent: number; failed: number };
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface StaffMember {
  id: string;
  username: string;
  email: string;
  role: Role;
  status: AccountStatus;
  assignedOpen: number;
  assignedTotal: number;
  lastActivityAt: string | null;
  createdAt: string;
}

export interface GameSessionSummary {
  id: string;
  game: string;
  bet: number;
  payout: number;
  status: 'active' | 'won' | 'lost' | 'push';
  createdAt: string;
  endedAt: string | null;
}

export interface Card {
  rank: string;
  suit: '♠' | '♥' | '♦' | '♣';
  hidden?: boolean;
}

export interface BaseGameView {
  session: GameSessionSummary;
  balance: number;
}

/** The single round currently holding a player's active-bet slot. */
export interface ActiveRound {
  game: string;
  status: 'playing' | 'settled';
  view: BaseGameView;
}

export interface CoinflipView extends BaseGameView {
  pick: 'heads' | 'tails';
  outcome: 'heads' | 'tails';
  won: boolean;
  multiplier: number;
}

export interface MinesView extends BaseGameView {
  mines: number;
  revealed: number[];
  multiplier: number;
  nextMultiplier: number | null;
  potential: number;
  mineTiles: number[] | null;
  hitTile: number | null;
}

export interface BlackjackView extends BaseGameView {
  playerCards: Card[];
  dealerCards: Card[];
  playerScore: number;
  dealerScore: number;
  canHit: boolean;
  canStand: boolean;
  canDouble: boolean;
  result: string | null;
}

export type RouletteBetType =
  | 'red'
  | 'black'
  | 'odd'
  | 'even'
  | 'low'
  | 'high'
  | 'dozen1'
  | 'dozen2'
  | 'dozen3'
  | 'column1'
  | 'column2'
  | 'column3';

export interface RouletteBet {
  type: RouletteBetType | 'straight';
  number?: number;
  amount: number;
}

export interface RouletteView extends BaseGameView {
  bets: RouletteBet[];
  winningNumber: number;
  color: 'red' | 'black' | 'green';
  totalPayout: number;
  won: boolean;
}

export interface TowersView extends BaseGameView {
  level: number;
  revealed: number[];
  multiplier: number;
  nextMultiplier: number;
  potential: number;
  trapTile: number | null;
}

export interface PlinkoView extends BaseGameView {
  risk: 'low' | 'medium' | 'high';
  path: ('left' | 'right')[];
  slot: number;
  multiplier: number;
  won: boolean;
}

export interface TicketCounts {
  all: number;
  new: number;
  unassigned: number;
  assignedToMe: number;
  open: number;
  inProgress: number;
  onHold: number;
  waitingUser: number;
  resolved: number;
  closed: number;
  rejected: number;
}
