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

/**
 * Chat uses a tighter label set than the rest of the product so a message line
 * can show a role without pushing the username or timestamp out of view.
 * Roles are resolved from the server on every read, never from the client.
 */
export const CHAT_ROLE_LABELS: Record<Role, string> = {
  user: 'Member',
  support: 'Staff',
  moderator: 'Moderator',
  admin: 'Admin',
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
  closed: 'The conversation is finished and the ticket is permanently read-only.',
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
  closed: [],
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
  'accounts.review',
  'rain.manage',
  'giveaways.join',
  'giveaways.sponsor',
  'giveaways.manage',
  'codes.manage',
  'discord.manage',
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
  'giveaways.join',
  'giveaways.sponsor',
];

const SUPPORT_PERMISSIONS: Permission[] = [
  ...PLAYER_PERMISSIONS,
  'staff.access',
  'accounts.review',
  'tickets.read_all',
  'tickets.reply',
  'tickets.note',
  'tickets.assign',
  'tickets.status',
  'tickets.priority',
  'tickets.reject',
  'giveaways.manage',
  'codes.manage',
];

const MODERATOR_PERMISSIONS: Permission[] = [
  ...SUPPORT_PERMISSIONS,
  'admin.access',
  'tickets.manage',
  'users.read',
  'users.restrict',
  'rain.manage',
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
  'discord.manage',
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
  /** True while a multiple-account review holds the account. Never includes internal detection details. */
  accountHold: boolean;
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

/* ---------------------------- game statistics ---------------------------- */

/**
 * `outcome` games use the configured chance when a new round is created.
 * `target` games keep their native rules and use the chance as a monitoring
 * baseline, because a single win percentage would misrepresent their mechanics.
 */
export type GameWinChanceMode = 'outcome' | 'target';

export interface GameWinChanceInfo {
  mode: GameWinChanceMode;
  label: string;
  hint: string;
  defaultChance: number;
}

export const GAME_WIN_CHANCE_INFO: Record<string, GameWinChanceInfo> = {
  coinflip: {
    mode: 'outcome',
    label: 'Outcome control',
    hint: 'Sets the chance the coin matches the player pick when a round starts. Existing rounds keep their original chance.',
    defaultChance: 50,
  },
  roulette: {
    mode: 'target',
    label: 'Monitoring target',
    hint: 'The single-zero wheel and its payout table stay fixed. This is the target net-win rate used for monitoring.',
    defaultChance: 48.6,
  },
  plinko: {
    mode: 'target',
    label: 'Monitoring target',
    hint: 'The peg table and payout curve stay fixed. This target is compared with observed profitable drops.',
    defaultChance: 39,
  },
  mines: {
    mode: 'target',
    label: 'Monitoring target',
    hint: 'Mine layout, cash-out choices and the house edge decide outcomes. This target is used for monitoring.',
    defaultChance: 40,
  },
  towers: {
    mode: 'target',
    label: 'Monitoring target',
    hint: 'Trap placement, floors climbed and the house edge decide outcomes. This target is used for monitoring.',
    defaultChance: 40,
  },
  blackjack: {
    mode: 'target',
    label: 'Monitoring target',
    hint: 'Cards, dealer rules and player decisions decide outcomes. This target is used for monitoring.',
    defaultChance: 42,
  },
};

export type GameStatsRange = '24h' | '7d' | '30d' | '90d' | 'all';

export const GAME_STATS_RANGES: { value: GameStatsRange; label: string }[] = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'all', label: 'All time' },
];

export type GameStatsSort =
  | 'name'
  | 'bets'
  | 'winRate'
  | 'wagered'
  | 'houseProfit'
  | 'configuredWinChance';

export interface GameStatsDeviation {
  level: 'normal' | 'warning' | 'insufficient';
  sampleSize: number;
  minimumSample: number;
  /** Average configured chance over the rounds included in the comparison. */
  configuredWinChance: number | null;
  observedWinRate: number | null;
  /** Wilson 95% interval for the observed rate. */
  confidenceLow: number | null;
  confidenceHigh: number | null;
  zScore: number | null;
  deltaPercentagePoints: number | null;
  message: string | null;
}

export interface GameStatsRow {
  slug: string;
  name: string;
  description: string;
  enabled: boolean;
  mode: GameWinChanceMode;
  modeLabel: string;
  configuredWinChance: number;
  bets: number;
  openRounds: number;
  wins: number;
  losses: number;
  pushes: number;
  actualWinRate: number | null;
  /** Settled non-push rounds that carry a configuration snapshot. */
  comparisonSample: number;
  comparisonWinRate: number | null;
  averageConfiguredWinChance: number | null;
  wagered: number;
  payouts: number;
  houseProfit: number;
  rtp: number | null;
  lastSettledAt: string | null;
  deviation: GameStatsDeviation;
}

export interface GameStatsTotals {
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  wagered: number;
  payouts: number;
  houseProfit: number;
  actualWinRate: number | null;
  warningCount: number;
  comparisonSample: number;
}

export interface GameStatsResponse {
  range: GameStatsRange;
  from: string | null;
  to: string;
  /** Statistics start after this reset; financial records are unaffected. */
  statsSince: string | null;
  generatedAt: string;
  minimumSample: number;
  warningCount: number;
  games: GameStatsRow[];
  totals: GameStatsTotals;
}

export interface GameStatsTrendPoint {
  bucket: string;
  label: string;
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  wagered: number;
  payouts: number;
  houseProfit: number;
  rtp: number | null;
  actualWinRate: number | null;
  averageConfiguredWinChance: number | null;
}

export interface GameConfigHistoryEntry {
  id: string;
  actorName: string | null;
  createdAt: string;
  previousWinChance: number | null;
  newWinChance: number | null;
  changedKeys: string[];
  previousConfig: Record<string, unknown>;
  newConfig: Record<string, unknown>;
}

export interface GameStatsDetailResponse {
  range: GameStatsRange;
  from: string | null;
  to: string;
  statsSince: string | null;
  generatedAt: string;
  minimumSample: number;
  game: GameStatsRow;
  trend: GameStatsTrendPoint[];
  history: GameConfigHistoryEntry[];
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

export type TranscriptKind = 'ticket' | 'cashier';

/** A completed ticket or cashier conversation shown in the transcript library. */
export interface TranscriptSummary {
  kind: TranscriptKind;
  id: string;
  reference: string;
  title: string;
  categoryLabel: string;
  status: string;
  priority: TicketPriority | null;
  amount: number | null;
  requester: { id: string; username: string };
  assignee: string | null;
  createdAt: string;
  closedAt: string | null;
  messageCount: number;
}

export interface TranscriptDetail extends TranscriptSummary {
  description: string | null;
  messages: TicketMessage[];
  events: TicketEvent[];
  canSeeInternalNotes: boolean;
}

export interface TranscriptListResponse extends Paginated<TranscriptSummary> {
  canViewAll: boolean;
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
  onHold: boolean;
  holdReason: string | null;
  heldAt: string | null;
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
  canEdit: boolean;
  canHold: boolean;
}

export interface CashierCounts {
  all: number;
  pending: number;
  onHold: number;
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
  canTranscript: boolean;
}

/* --------------------------------- rain ---------------------------------- */

export const RAIN_COUNTDOWN_MIN_SECONDS = 10;
export const RAIN_COUNTDOWN_MAX_SECONDS = 300;

export interface RainParticipantView {
  id: string;
  username: string;
  joinedAt: string;
  payout: number | null;
}

export interface RainView {
  id: string;
  status: 'countdown' | 'settled';
  creator: { id: string; username: string };
  totalAmount: number;
  participantCount: number;
  countdownEndsAt: string;
  /** Seconds left, computed server-side; the widget also ticks locally. */
  secondsRemaining: number;
  joined: boolean;
  isCreator: boolean;
  /** Estimated during the countdown, actual once settled. */
  payoutPerParticipant: number | null;
  /** This viewer's settled payout; null when they did not participate. */
  yourPayout: number | null;
  /** Units distributed on top of the base payout to make the split exact. */
  remainder: number;
  participants: RainParticipantView[];
  createdAt: string;
  settledAt: string | null;
  minAmount: number;
  maxAmount: number;
  countdownMinSeconds: number;
  countdownMaxSeconds: number;
}

export interface RainStateResponse {
  /** The soonest-ending active rain, otherwise the most recent settled rain. */
  rain: RainView | null;
  active: RainView[];
  latest: RainView | null;
  limits: RainLimits;
}

/** Creation returns the debited wallet balance so the client can update instantly. */
export interface RainCreateResponse {
  rain: RainView;
  balance: number;
}

export interface RainLimits {
  minAmount: number;
  maxAmount: number;
  countdownMinSeconds: number;
  countdownMaxSeconds: number;
}

/* --------------------------------- chat ---------------------------------- */

export const CHAT_MESSAGE_MAX_LENGTH = 500;

export interface ChatMessage {
  id: string;
  userId: string | null;
  username: string;
  /** Current server-side role; changes are reflected on the next poll. */
  role: Role;
  body: string;
  createdAt: string;
}

export interface ChatResponse {
  /** Chat is readable and writable only after the account email is verified. */
  verified: boolean;
  messages: ChatMessage[];
  activeRains: RainView[];
  latestRain: RainView | null;
}

export interface ChatPostResponse {
  message: ChatMessage;
}

/* ------------------------------- giveaways ------------------------------- */

export type GiveawayStatus = 'scheduled' | 'active' | 'completed' | 'cancelled';
export type GiveawayFundingKind = 'staff' | 'sponsor';
/**
 * unclaimed → the winner has no claim ticket yet.
 * pending   → a Giveaway Claim ticket is open and staff must review it.
 * approved  → staff verified the claim and credited the prize exactly once.
 * rejected  → staff declined the claim; no payout was made.
 */
export type GiveawayClaimStatus = 'unclaimed' | 'pending' | 'approved' | 'rejected';

export const GIVEAWAY_MIN_AMOUNT = 10_000;
export const GIVEAWAY_MAX_AMOUNT = 1_000_000_000_000;
export const GIVEAWAY_MIN_WINNERS = 1;
export const GIVEAWAY_MAX_WINNERS = 50;
export const GIVEAWAY_MIN_DURATION_SECONDS = 300;
export const GIVEAWAY_MAX_DURATION_SECONDS = 30 * 24 * 60 * 60;
export const GIVEAWAY_MIN_SCHEDULE_LEAD_SECONDS = 60;

export const GIVEAWAY_STATUS_LABELS: Record<GiveawayStatus, string> = {
  scheduled: 'Upcoming',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const GIVEAWAY_CLAIM_STATUS_LABELS: Record<GiveawayClaimStatus, string> = {
  unclaimed: 'Awaiting claim',
  pending: 'Pending review',
  approved: 'Approved & paid',
  rejected: 'Claim rejected',
};

export interface GiveawayLimits {
  minAmount: number;
  maxAmount: number;
  minWinners: number;
  maxWinners: number;
  minDurationSeconds: number;
  maxDurationSeconds: number;
  minScheduleLeadSeconds: number;
}

export interface GiveawayWinnerView {
  id: string;
  userId: string;
  username: string;
  position: number;
  payoutAmount: number;
  claimStatus: GiveawayClaimStatus;
  claimTicketId: string | null;
  selectedAt: string;
  approvedAt: string | null;
}

export interface GiveawayParticipantView {
  userId: string;
  username: string;
  joinedAt: string;
}

export interface GiveawayView {
  id: string;
  reference: string;
  title: string;
  description: string;
  status: GiveawayStatus;
  fundingKind: GiveawayFundingKind;
  creator: { id: string; username: string } | null;
  sponsor: { id: string; username: string } | null;
  prizeAmount: number;
  winnerCount: number;
  participantCount: number;
  joined: boolean;
  isCreator: boolean;
  /** True for the wallet that paid the prize; funders cannot enter their own draw. */
  isFunder: boolean;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  secondsRemaining: number;
  secondsUntilStart: number;
  participants: GiveawayParticipantView[];
  winners: GiveawayWinnerView[];
  /** Hash published while the giveaway is open; the seed is revealed after the draw. */
  drawCommitment: string;
  drawSeed: string | null;
  drawAlgorithm: string;
  yourWin: GiveawayWinnerView | null;
  /** Optional banner shown on the website and in the Discord announcement. */
  bannerUrl: string | null;
}

export interface GiveawayClaimView {
  id: string;
  giveawayId: string;
  giveawayReference: string;
  giveawayTitle: string;
  userId: string;
  username: string;
  payoutAmount: number;
  claimStatus: GiveawayClaimStatus;
  ticketReference: string | null;
  ticketId: string | null;
  selectedAt: string;
  approvedAt: string | null;
  rejectionReason: string | null;
}

export interface GiveawaySponsorshipView {
  id: string;
  ticketId: string;
  ticketReference: string;
  sponsor: { id: string; username: string };
  prizeAmount: number;
  winnerCount: number;
  durationSeconds: number;
  title: string | null;
  description: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'published' | 'cancelled';
  reviewer: { id: string; username: string } | null;
  reviewReason: string | null;
  reviewedAt: string | null;
  giveawayId: string | null;
  giveawayReference: string | null;
  createdAt: string;
}

export interface GiveawayOverviewResponse {
  serverTime: string;
  active: GiveawayView[];
  upcoming: GiveawayView[];
  completed: GiveawayView[];
  myClaims: GiveawayClaimView[];
  canManage: boolean;
  limits: GiveawayLimits;
}

export interface GiveawayFeaturedResponse {
  serverTime: string;
  active: GiveawayView[];
  upcoming: GiveawayView | null;
  latest: GiveawayView | null;
}

export interface GiveawayJoinResponse {
  giveaway: GiveawayView;
}

export interface GiveawayClaimTicketResponse {
  ticketReference: string;
  claim: GiveawayClaimView;
}

export interface GiveawayManageResponse {
  serverTime: string;
  giveaways: GiveawayView[];
  claims: GiveawayClaimView[];
  sponsorships: GiveawaySponsorshipView[];
  limits: GiveawayLimits;
}

/* --------------------------- Discord integration ------------------------- */

/**
 * The Discord bot runs as its own process on a separate host and talks to the
 * website through the authenticated `/api/bot` API. All persistent state stays
 * in this database, so the website and bot can never hold separate balances.
 */
export type DiscordAnnouncementKind = 'news' | 'changelog';
export type DiscordVouchType = 'positive' | 'scam';
export type RewardCodeStatus = 'active' | 'scheduled' | 'expired' | 'disabled' | 'exhausted';

export interface DiscordChannelConfig {
  welcome: string | null;
  vouches: string | null;
  scamVouches: string | null;
  invites: string | null;
  codes: string | null;
  giveaways: string | null;
  news: string | null;
  changelog: string | null;
  logs: string | null;
  tickets: string | null;
  ticketTranscripts: string | null;
  cashierRequests: string | null;
  cashierTranscripts: string | null;
}

export interface DiscordRoleConfig {
  owner: string[];
  admin: string[];
  staff: string[];
  moderator: string[];
}

export interface DiscordGuildConfig {
  guildId: string;
  channels: DiscordChannelConfig;
  roles: DiscordRoleConfig;
  inviteRewardsEnabled: boolean;
  inviteRewardEvery: number;
  inviteRewardAmount: number;
  invitePanelTitle: string;
  invitePanelBody: string;
  inviteCopyMessage: string;
  invitePanelMessageId: string | null;
  invitePanelChannelId: string | null;
  announcementEveryone: boolean;
  updatedAt: string | null;
  updatedBy: { id: string; username: string } | null;
}

export interface DiscordInvitePanelSettings {
  guildId: string;
  channelId: string | null;
  title: string;
  body: string;
  copyMessage: string;
  rewardEvery: number;
  rewardAmount: number;
  enabled: boolean;
  messageId: string | null;
  messageChannelId: string | null;
}

export interface DiscordInviteLink {
  discordUserId: string;
  inviteCode: string;
  inviteUrl: string;
  createdAt: string;
}

export interface DiscordGuildSummary {
  id: string;
  name: string;
  iconUrl: string | null;
  memberCount: number;
  ownerDiscordId: string | null;
  primary: boolean;
  lastSeenAt: string | null;
  botVersion: string | null;
  latencyMs: number | null;
}

export interface DiscordBotStatus {
  connected: boolean;
  guild: DiscordGuildSummary | null;
  guildCount: number;
  lastSeenAt: string | null;
}

export interface DiscordLinkStatus {
  linked: boolean;
  discordUserId: string | null;
  discordUsername: string | null;
  linkedAt: string | null;
}

export interface DiscordLinkCodeResponse {
  code: string;
  expiresAt: string;
  command: string;
}

export interface DiscordActivityView {
  id: string;
  action: string;
  summary: string;
  actor: { userId: string | null; username: string | null; discordUserId: string | null } | null;
  createdAt: string;
}

export interface DiscordInviteStats {
  discordUserId: string;
  username: string | null;
  websiteUsername: string | null;
  linked: boolean;
  totalInvites: number;
  rewardsEarned: number;
  rewardsPending: number;
  rewardEvery: number;
  rewardAmount: number;
  nextRewardIn: number;
  progress: number;
  leaderboardPosition: number | null;
  totalTrackedInvites: number;
}

export interface DiscordInviteLeaderboardEntry {
  rank: number;
  discordUserId: string;
  username: string;
  websiteUsername: string | null;
  invites: number;
  rewards: number;
}

export interface DiscordVouchView {
  id: string;
  type: DiscordVouchType;
  voucherDiscordId: string;
  voucherUsername: string;
  targetDiscordId: string;
  targetUsername: string;
  targetWebsiteUsername: string | null;
  reason: string;
  messageId: string | null;
  createdAt: string;
}

export interface DiscordVouchStats {
  discordUserId: string;
  username: string | null;
  websiteUsername: string | null;
  positive: number;
  scam: number;
  reputation: 'positive' | 'neutral' | 'negative';
  recent: DiscordVouchView[];
}

export interface DiscordChangelogSections {
  features: string[];
  improvements: string[];
  fixes: string[];
  removed: string[];
  other: string[];
}

export interface DiscordAnnouncementView {
  id: string;
  kind: DiscordAnnouncementKind;
  title: string;
  body: string | null;
  sections: DiscordChangelogSections | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  footer: string | null;
  author: string | null;
  color: string | null;
  emoji: string | null;
  mentionEveryone: boolean;
  channelId: string | null;
  messageId: string | null;
  status: 'published' | 'deleted';
  createdAt: string;
  updatedAt: string;
}

export interface RewardCodeView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  amount: number;
  maxRedemptions: number;
  redeemedCount: number;
  remaining: number;
  expiresAt: string | null;
  disabledAt: string | null;
  createdAt: string;
  createdVia: 'web' | 'discord';
  createdBy: string | null;
  status: RewardCodeStatus;
  announcementMessageId: string | null;
}

export interface RewardCodeRedemptionResponse {
  code: RewardCodeView;
  amount: number;
  balance: number;
  redeemedAt: string;
}

export interface DiscordGiveawaySyncItem {
  id: string;
  reference: string;
  title: string;
  description: string;
  bannerUrl: string | null;
  status: GiveawayStatus;
  prizeAmount: number;
  winnerCount: number;
  participantCount: number;
  startsAt: string;
  endsAt: string;
  secondsRemaining: number;
  winners: { username: string; payoutAmount: number; claimStatus: GiveawayClaimStatus }[];
  discordMessageId: string | null;
  discordChannelId: string | null;
}

export interface DiscordInfoChannelView {
  id: string;
  guildId: string;
  name: string;
  category: string;
  channelId: string;
  description: string | null;
  panelCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DiscordPanelLink {
  label: string;
  url: string;
}

export interface DiscordPanelView {
  id: string;
  guildId: string;
  infoChannelId: string;
  channelName: string;
  category: string;
  channelId: string;
  title: string;
  body: string;
  color: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  footer: string | null;
  links: DiscordPanelLink[];
  mentionEveryone: boolean;
  messageId: string | null;
  status: 'published' | 'deleted';
  createdAt: string;
  updatedAt: string;
}

export interface DiscordOverviewResponse {
  status: DiscordBotStatus;
  config: DiscordGuildConfig | null;
  guilds: DiscordGuildSummary[];
  stats: {
    linkedAccounts: number;
    trackedInvites: number;
    inviteRewardsPaid: number;
    inviteRewardsPending: number;
    inviteRewardsAmount: number;
    positiveVouches: number;
    scamVouches: number;
    activeGiveaways: number;
    activeCodes: number;
    codeRedemptions: number;
    announcements: number;
    infoChannels: number;
    panels: number;
    pendingOutbox: number;
    failedOutbox: number;
  };
  recentActivity: DiscordActivityView[];
  announcements: DiscordAnnouncementView[];
  infoChannels: DiscordInfoChannelView[];
  panels: DiscordPanelView[];
  codes: RewardCodeView[];
  inviteLeaderboard: DiscordInviteLeaderboardEntry[];
  recentVouches: DiscordVouchView[];
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
  betPlaced: boolean;
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
  /** Consecutive reward days with at least one accepted wager. */
  streak: number;
  bestStreak: number;
  /** True when an accepted wager has already been recorded for today's reward day. */
  betToday: boolean;
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
  /** Number of chips stacked on this position. */
  chips: number;
  /** Actual money value of those chips at the round's chip value. */
  amount: number;
}

export interface RouletteView extends BaseGameView {
  bets: RouletteBet[];
  winningNumber: number;
  color: 'red' | 'black' | 'green';
  totalPayout: number;
  /** Money value of one chip for this spin. */
  chipValue: number;
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

/* ------------------------------ account reviews --------------------------- */

export type AccountReviewStatus = 'open' | 'cleared' | 'alt_confirmed' | 'resolved';

export const ACCOUNT_REVIEW_STATUS_LABELS: Record<AccountReviewStatus, string> = {
  open: 'Open review',
  cleared: 'Verified separate users',
  alt_confirmed: 'Confirmed alt account',
  resolved: 'Resolved',
};

export interface AccountReviewSummary {
  id: string;
  userId: string;
  username: string;
  email: string;
  role: Role;
  status: AccountReviewStatus;
  reason: string;
  triggerIp: string | null;
  relatedCount: number;
  accountHold: boolean;
  flaggedAt: string;
  updatedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  decisionReason: string | null;
}

export interface AccountReviewCounts {
  open: number;
  onHold: number;
  cleared: number;
  altConfirmed: number;
  resolved: number;
  total: number;
}

export interface AccountReviewRelatedAccount {
  id: string;
  username: string;
  email: string;
  role: Role;
  status: AccountStatus;
  accountHold: boolean;
  registrationIp: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  reviewStatus: AccountReviewStatus | null;
  sharedIps: string[];
}

export interface AccountReviewIpHistory {
  ip: string;
  accounts: number;
  registrations: number;
  sessions: number;
  firstSeen: string;
  lastSeen: string;
}

export interface AccountReviewEvent {
  id: string;
  action: string;
  actorName: string | null;
  fromStatus: AccountReviewStatus | null;
  toStatus: AccountReviewStatus | null;
  reason: string | null;
  createdAt: string;
}

export interface AccountReviewDetail extends AccountReviewSummary {
  reviewNote: string;
  user: {
    id: string;
    username: string;
    email: string;
    role: Role;
    status: AccountStatus;
    accountHold: boolean;
    accountHoldReason: string | null;
    accountHoldAt: string | null;
    registrationIp: string | null;
    emailVerified: boolean;
    createdAt: string;
    lastLoginAt: string | null;
    balance: number;
  };
  relatedAccounts: AccountReviewRelatedAccount[];
  ipHistory: AccountReviewIpHistory[];
  events: AccountReviewEvent[];
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
