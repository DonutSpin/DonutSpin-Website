import type { DB } from '../db/index.ts';
import { getSetting } from '../db/index.ts';
import type { RewardCalendarDay, RewardClaim, RewardMilestone, RewardsSummary } from '../../shared/types.ts';
import { applyLedger, balanceOf } from './wallet.ts';
import { inTransaction, newId, nowIso, parseJson } from './core.ts';
import { ApiError } from './core.ts';

export interface RewardsConfig {
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
  emailEnabled: boolean;
}

interface RewardClaimRow {
  id: string;
  user_id: string;
  claim_day: string;
  timezone: string;
  streak_day: number;
  base_amount: number;
  increment_amount: number;
  milestone_amount: number;
  amount: number;
  ledger_id: string | null;
  created_at: string;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const DAY_MS = 86_400_000;

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function getRewardsConfig(db: DB): RewardsConfig {
  const rawMilestones = getSetting<unknown>(db, 'rewards.milestones', []);
  const milestones = (Array.isArray(rawMilestones) ? rawMilestones : [])
    .map((entry) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({
      day: clampInt(Number(entry.day), 1, 3650, 1),
      amount: clampInt(Number(entry.amount), 0, 1_000_000_000_000, 0),
      label: typeof entry.label === 'string' ? entry.label.slice(0, 80) : `Day ${clampInt(Number(entry.day), 1, 3650, 1)} bonus`,
    }))
    .filter((entry) => entry.amount > 0)
    .sort((a, b) => a.day - b.day)
    .slice(0, 12);
  const timezone = getSetting(db, 'rewards.timezone', 'UTC');
  return {
    enabled: getSetting(db, 'rewards.enabled', true),
    timezone: isValidTimezone(timezone) ? timezone : 'UTC',
    resetHour: clampInt(getSetting(db, 'rewards.reset_hour', 0), 0, 23, 0),
    baseAmount: Math.max(0, getSetting(db, 'rewards.base_amount', 50_000)),
    incrementAmount: Math.max(0, getSetting(db, 'rewards.increment_amount', 10_000)),
    maxAmount: Math.max(1, getSetting(db, 'rewards.max_amount', 500_000)),
    maxStreakDays: clampInt(getSetting(db, 'rewards.max_streak_days', 365), 1, 3650, 365),
    missedPolicy: getSetting<string>(db, 'rewards.missed_policy', 'reset') === 'grace' ? 'grace' : 'reset',
    graceDays: clampInt(getSetting(db, 'rewards.grace_days', 1), 0, 14, 1),
    milestones,
    emailEnabled: getSetting(db, 'rewards.email_enabled', true),
  };
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function dayKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function rewardDayKey(now: Date, timezone: string, resetHour: number): string {
  const parts = zonedParts(now, timezone);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (parts.hour < resetHour) date.setUTCDate(date.getUTCDate() - 1);
  return dayKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function parseDayKey(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function calendarGap(from: string, to: string): number {
  return Math.round((parseDayKey(to).getTime() - parseDayKey(from).getTime()) / DAY_MS);
}

function nextResetIso(now: Date, timezone: string, resetHour: number): string {
  const parts = zonedParts(now, timezone);
  const secondsToday = parts.hour * 3600 + parts.minute * 60 + parts.second;
  let diff = resetHour * 3600 - secondsToday;
  if (diff <= 0) diff += 86_400;
  return new Date(now.getTime() + diff * 1000).toISOString();
}

function mapClaim(row: RewardClaimRow, milestoneLabel: string | null): RewardClaim {
  return {
    id: row.id,
    day: row.claim_day,
    streakDay: row.streak_day,
    baseAmount: row.base_amount,
    incrementAmount: row.increment_amount,
    milestoneAmount: row.milestone_amount,
    milestoneLabel,
    amount: row.amount,
    createdAt: row.created_at,
  };
}

function milestoneFor(config: RewardsConfig, streakDay: number): RewardMilestone | undefined {
  return config.milestones.find((milestone) => milestone.day === streakDay);
}

function rewardAmounts(config: RewardsConfig, streakDay: number): {
  base: number;
  milestone: number;
  total: number;
  milestoneLabel: string | null;
} {
  const base = Math.min(config.maxAmount, config.baseAmount + config.incrementAmount * Math.max(0, streakDay - 1));
  const milestone = milestoneFor(config, streakDay);
  return {
    base,
    milestone: milestone?.amount ?? 0,
    total: base + (milestone?.amount ?? 0),
    milestoneLabel: milestone?.label ?? null,
  };
}

function readEmailPreference(db: DB, userId: string): boolean {
  const row = db.prepare('SELECT email_notifications FROM users WHERE id = ?').get(userId) as
    | { email_notifications: number }
    | undefined;
  return Boolean(row?.email_notifications ?? 1);
}

interface BetState {
  streak: number;
  bestStreak: number;
  betToday: boolean;
  lastBetDay: string | null;
}

/**
 * Records one qualifying day for an accepted wager. This is called inside the
 * same transaction as the wager debit, so failed or rejected starts never
 * create a streak day.
 */
export function recordBetActivity(db: DB, userId: string, now = new Date()): void {
  const config = getRewardsConfig(db);
  const day = rewardDayKey(now, config.timezone, config.resetHour);
  db.prepare(
    `INSERT INTO bet_activity_days (user_id, activity_day, first_bet_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, activity_day) DO NOTHING`,
  ).run(userId, day, now.toISOString());
}

function previousDayKey(day: string): string {
  const date = parseDayKey(day);
  date.setUTCDate(date.getUTCDate() - 1);
  return dayKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Consecutive reward days with an accepted wager, including today when present. */
function currentBetState(db: DB, userId: string, config: RewardsConfig, today: string): BetState {
  const rows = db
    .prepare(
      `SELECT activity_day FROM bet_activity_days
        WHERE user_id = ? AND activity_day <= ?
        ORDER BY activity_day DESC LIMIT ?`,
    )
    .all(userId, today, Math.max(config.maxStreakDays + 2, 366)) as { activity_day: string }[];
  if (rows.length === 0) return { streak: 0, bestStreak: 0, betToday: false, lastBetDay: null };

  const latest = rows[0]!.activity_day;
  const latestGap = calendarGap(latest, today);
  let streak = 0;
  if (latestGap === 0 || latestGap === 1) {
    let expected = latestGap === 0 ? today : previousDayKey(today);
    for (const row of rows) {
      if (row.activity_day !== expected) break;
      streak += 1;
      expected = previousDayKey(expected);
    }
  }

  // Best streak is calculated over the same bounded window so the overview can
  // show a meaningful personal best without scanning the entire history.
  let bestStreak = 0;
  let run = 0;
  let previous: string | null = null;
  for (const row of [...rows].reverse()) {
    run = previous && calendarGap(previous, row.activity_day) === 1 ? run + 1 : 1;
    bestStreak = Math.max(bestStreak, run);
    previous = row.activity_day;
  }

  return {
    streak,
    bestStreak: Math.max(bestStreak, streak),
    betToday: latestGap === 0,
    lastBetDay: latest,
  };
}

function buildCalendar(
  rows: RewardClaimRow[],
  betDays: Set<string>,
  today: string,
  days = 14,
): RewardCalendarDay[] {
  const claims = new Map(rows.map((row) => [row.claim_day, row]));
  const todayDate = parseDayKey(today);
  const result: RewardCalendarDay[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(todayDate.getTime() - offset * DAY_MS);
    const key = dayKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    const claim = claims.get(key);
    result.push({
      day: key,
      label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      weekday: date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
      claimed: Boolean(claim),
      betPlaced: betDays.has(key),
      isToday: key === today,
      isPast: key < today,
      reward: claim?.amount ?? null,
    });
  }
  return result;
}

export function rewardsSummary(db: DB, userId: string, now = new Date()): RewardsSummary {
  const config = getRewardsConfig(db);
  const today = rewardDayKey(now, config.timezone, config.resetHour);
  const betState = currentBetState(db, userId, config, today);
  const lastClaim = db
    .prepare('SELECT * FROM reward_claims WHERE user_id = ? ORDER BY claim_day DESC LIMIT 1')
    .get(userId) as RewardClaimRow | undefined;
  const claimedToday = lastClaim?.claim_day === today;
  const currentClaimDay = claimedToday ? lastClaim.streak_day : null;
  const nextStreakDay = claimedToday
    ? Math.min(config.maxStreakDays, (currentClaimDay ?? betState.streak) + 1)
    : betState.betToday
      ? Math.min(config.maxStreakDays, Math.max(1, betState.streak))
      : Math.min(config.maxStreakDays, betState.streak + 1);
  const nextAmounts = rewardAmounts(config, nextStreakDay);
  const historyRows = db
    .prepare('SELECT * FROM reward_claims WHERE user_id = ? ORDER BY claim_day DESC LIMIT 20')
    .all(userId) as RewardClaimRow[];
  const todayRow = claimedToday ? lastClaim : null;
  const todayDate = parseDayKey(today);
  const calendarStart = new Date(todayDate.getTime() - 13 * DAY_MS);
  const calendarStartKey = dayKey(
    calendarStart.getUTCFullYear(),
    calendarStart.getUTCMonth() + 1,
    calendarStart.getUTCDate(),
  );
  const calendarRows = db
    .prepare('SELECT * FROM reward_claims WHERE user_id = ? AND claim_day >= ? ORDER BY claim_day')
    .all(userId, calendarStartKey) as RewardClaimRow[];
  const betRows = db
    .prepare('SELECT activity_day FROM bet_activity_days WHERE user_id = ? AND activity_day >= ? ORDER BY activity_day')
    .all(userId, calendarStartKey) as { activity_day: string }[];
  const betDays = new Set(betRows.map((row) => row.activity_day));

  return {
    enabled: config.enabled,
    timezone: config.timezone,
    resetHour: config.resetHour,
    baseAmount: config.baseAmount,
    incrementAmount: config.incrementAmount,
    maxAmount: config.maxAmount,
    maxStreakDays: config.maxStreakDays,
    missedPolicy: config.missedPolicy,
    graceDays: config.graceDays,
    milestones: config.milestones,
    streak: betState.streak,
    bestStreak: betState.bestStreak,
    betToday: betState.betToday,
    claimedToday,
    todayClaim: todayRow
      ? mapClaim(todayRow, milestoneFor(config, todayRow.streak_day)?.label ?? null)
      : null,
    nextReward: {
      streakDay: nextStreakDay,
      baseAmount: nextAmounts.base,
      milestoneAmount: nextAmounts.milestone,
      total: nextAmounts.total,
    },
    nextResetAt: nextResetIso(now, config.timezone, config.resetHour),
    calendar: buildCalendar(calendarRows, betDays, today),
    history: historyRows.map((row) => mapClaim(row, milestoneFor(config, row.streak_day)?.label ?? null)),
    emailNotifications: readEmailPreference(db, userId),
  };
}

export interface ClaimOutcome {
  claim: RewardClaim;
  summary: RewardsSummary;
  balance: number;
}

export function claimReward(db: DB, userId: string, now = new Date()): ClaimOutcome {
  const config = getRewardsConfig(db);
  if (!config.enabled) {
    throw new ApiError(403, 'REWARDS_DISABLED', 'Daily rewards are currently paused.');
  }
  const today = rewardDayKey(now, config.timezone, config.resetHour);
  const outcome = inTransaction(db, () => {
    const existingClaim = db
      .prepare('SELECT id FROM reward_claims WHERE user_id = ? AND claim_day = ?')
      .get(userId, today) as { id: string } | undefined;
    if (existingClaim) {
      throw new ApiError(409, 'ALREADY_CLAIMED', 'You already claimed today\'s reward.', {
        claimedToday: true,
        nextResetAt: nextResetIso(now, config.timezone, config.resetHour),
      });
    }
    const betState = currentBetState(db, userId, config, today);
    if (!betState.betToday) {
      throw new ApiError(
        403,
        'BET_REQUIRED_TODAY',
        'Place at least one valid bet today to claim your daily reward.',
        { betToday: false },
      );
    }
    const streakDay = Math.min(config.maxStreakDays, Math.max(1, betState.streak));
    const amounts = rewardAmounts(config, streakDay);
    const claimId = newId('rwd');
    const createdAt = nowIso();
    const insert = db
      .prepare(
        `INSERT INTO reward_claims
           (id, user_id, claim_day, timezone, streak_day, base_amount, increment_amount, milestone_amount, amount, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        claimId,
        userId,
        today,
        config.timezone,
        streakDay,
        amounts.base,
        config.incrementAmount,
        amounts.milestone,
        amounts.total,
        createdAt,
      );
    if (insert.changes !== 1) {
      throw new ApiError(409, 'ALREADY_CLAIMED', 'You already claimed today\'s reward.');
    }
    const ledger = applyLedger(db, {
      userId,
      amount: amounts.total,
      type: 'admin_adjustment',
      reason: `Daily reward · day ${streakDay}${amounts.milestoneLabel ? ` · ${amounts.milestoneLabel}` : ''}`,
      refType: 'reward',
      refId: claimId,
      idempotencyKey: `reward:${userId}:${today}`,
      metadata: {
        source: 'rewards',
        claimDay: today,
        streakDay,
        baseAmount: amounts.base,
        milestoneAmount: amounts.milestone,
      },
    });
    db.prepare('UPDATE reward_claims SET ledger_id = ? WHERE id = ?').run(ledger.id, claimId);
    const row = db.prepare('SELECT * FROM reward_claims WHERE id = ?').get(claimId) as RewardClaimRow;
    return {
      claim: mapClaim(row, amounts.milestoneLabel),
      balance: balanceOf(db, userId),
    };
  });

  return {
    claim: outcome.claim,
    balance: outcome.balance,
    summary: rewardsSummary(db, userId, now),
  };
}

/** Summary of active reward settings for the admin panel. */
export function rewardsAdminView(db: DB): RewardsConfig & { claimsToday: number; claimsAllTime: number; totalPaid: number } {
  const config = getRewardsConfig(db);
  const today = rewardDayKey(new Date(), config.timezone, config.resetHour);
  const todayCount = db
    .prepare('SELECT COUNT(*) AS count FROM reward_claims WHERE claim_day = ?')
    .get(today) as { count: number };
  const totals = db
    .prepare('SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total FROM reward_claims')
    .get() as { count: number; total: number };
  return {
    ...config,
    claimsToday: todayCount.count,
    claimsAllTime: totals.count,
    totalPaid: totals.total,
  };
}
