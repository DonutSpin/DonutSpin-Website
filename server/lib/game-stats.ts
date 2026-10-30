import type { DB } from '../db/index.ts';
import type {
  GameConfigHistoryEntry,
  GameStatsDeviation,
  GameStatsDetailResponse,
  GameStatsRange,
  GameStatsResponse,
  GameStatsRow,
  GameStatsSort,
  GameStatsTrendPoint,
  GameStatsTotals,
  GameWinChanceMode,
} from '../../shared/types.ts';
import { GAME_WIN_CHANCE_INFO } from '../../shared/types.ts';
import { newId, notFound, nowIso, parseJson } from './core.ts';
import { defaultWinChance } from '../games/config.ts';

/** A warning needs enough settled rounds to make a 3-sigma test meaningful. */
export const MIN_WARNING_SAMPLE = 50;
export const WARNING_Z_SCORE = 3;
export const WARNING_DELTA = 0.05;
export const HISTORY_LIMIT = 25;

type Bucket = 'hour' | 'day' | 'month';

interface RangeWindow {
  range: GameStatsRange;
  from: string | null;
  to: string;
  bucket: Bucket;
  buckets: { key: string; label: string }[];
}

interface AggregateRow {
  game_id: string;
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  comparison_wins: number;
  comparison_losses: number;
  expected_wins: number;
  variance: number;
  avg_configured: number | null;
  wagered: number;
  payouts: number;
  last_settled: string | null;
}

interface GameRow {
  id: string;
  name: string;
  description: string;
  enabled: number;
  config: string;
}

const RANGE_BUCKETS: Record<Exclude<GameStatsRange, 'all'>, { bucket: Bucket; days: number }> = {
  '24h': { bucket: 'hour', days: 1 },
  '7d': { bucket: 'day', days: 7 },
  '30d': { bucket: 'day', days: 30 },
  '90d': { bucket: 'day', days: 90 },
};

const pct = (value: number): number => Math.round(value * 100) / 100;

function dayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function hourStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()));
}

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function bucketKey(date: Date, bucket: Bucket): string {
  const iso = date.toISOString();
  if (bucket === 'hour') return `${iso.slice(0, 13)}:00`;
  if (bucket === 'month') return iso.slice(0, 7);
  return iso.slice(0, 10);
}

function bucketLabel(key: string, bucket: Bucket): string {
  if (bucket === 'hour') return `${key.slice(11, 16)} UTC`;
  if (bucket === 'month') {
    const date = new Date(`${key}-01T00:00:00.000Z`);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  const date = new Date(`${key}T00:00:00.000Z`);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function earliestSettledAt(db: DB): string | null {
  const row = db
    .prepare(
      `SELECT MIN(COALESCE(ended_at, created_at)) AS first
         FROM game_sessions
        WHERE status IN ('won','lost','push')`,
    )
    .get() as { first: string | null } | undefined;
  return row?.first ?? null;
}

export function buildRangeWindow(
  db: DB,
  range: GameStatsRange,
  now = new Date(),
): RangeWindow {
  if (range === 'all') {
    const earliest = earliestSettledAt(db);
    if (!earliest) {
      return { range, from: null, to: now.toISOString(), bucket: 'month', buckets: [] };
    }
    const first = monthStart(new Date(earliest));
    const last = monthStart(now);
    const buckets: { key: string; label: string }[] = [];
    let cursor = first;
    // A hard cap keeps a corrupt timestamp from generating an unbounded chart.
    for (let guard = 0; cursor.getTime() <= last.getTime() && guard < 600; guard += 1) {
      const key = bucketKey(cursor, 'month');
      buckets.push({ key, label: bucketLabel(key, 'month') });
      cursor = addMonths(cursor, 1);
    }
    return { range, from: null, to: now.toISOString(), bucket: 'month', buckets };
  }

  const { bucket, days } = RANGE_BUCKETS[range];
  if (bucket === 'hour') {
    const last = hourStart(now);
    const first = new Date(last.getTime() - (days * 24 - 1) * 60 * 60 * 1000);
    const buckets: { key: string; label: string }[] = [];
    for (let i = 0; i < days * 24; i += 1) {
      const cursor = new Date(first.getTime() + i * 60 * 60 * 1000);
      const key = bucketKey(cursor, bucket);
      buckets.push({ key, label: bucketLabel(key, bucket) });
    }
    return { range, from: first.toISOString(), to: now.toISOString(), bucket, buckets };
  }

  const last = dayStart(now);
  const first = addDays(last, -(days - 1));
  const buckets: { key: string; label: string }[] = [];
  for (let i = 0; i < days; i += 1) {
    const cursor = addDays(first, i);
    const key = bucketKey(cursor, bucket);
    buckets.push({ key, label: bucketLabel(key, bucket) });
  }
  return { range, from: first.toISOString(), to: now.toISOString(), bucket, buckets };
}

function aggregateRows(db: DB, from: string | null): AggregateRow[] {
  const where = ["status IN ('won','lost','push')"];
  const params: unknown[] = [];
  if (from) {
    where.push('COALESCE(ended_at, created_at) >= ?');
    params.push(from);
  }
  return db
    .prepare(
      `SELECT game_id,
              COUNT(*) AS bets,
              COALESCE(SUM(CASE WHEN payout > bet THEN 1 ELSE 0 END), 0) AS wins,
              COALESCE(SUM(CASE WHEN payout < bet THEN 1 ELSE 0 END), 0) AS losses,
              COALESCE(SUM(CASE WHEN payout = bet THEN 1 ELSE 0 END), 0) AS pushes,
              COALESCE(SUM(CASE WHEN configured_win_chance IS NOT NULL AND payout > bet THEN 1 ELSE 0 END), 0) AS comparison_wins,
              COALESCE(SUM(CASE WHEN configured_win_chance IS NOT NULL AND payout < bet THEN 1 ELSE 0 END), 0) AS comparison_losses,
              COALESCE(SUM(CASE WHEN configured_win_chance IS NOT NULL AND payout <> bet
                                THEN configured_win_chance / 100.0 ELSE 0 END), 0) AS expected_wins,
              COALESCE(SUM(CASE WHEN configured_win_chance IS NOT NULL AND payout <> bet
                                THEN (configured_win_chance / 100.0) * (1 - configured_win_chance / 100.0) ELSE 0 END), 0) AS variance,
              AVG(configured_win_chance) AS avg_configured,
              COALESCE(SUM(bet), 0) AS wagered,
              COALESCE(SUM(payout), 0) AS payouts,
              MAX(COALESCE(ended_at, created_at)) AS last_settled
         FROM game_sessions
        WHERE ${where.join(' AND ')}
        GROUP BY game_id`,
    )
    .all(...params) as AggregateRow[];
}

function activeRoundsByGame(db: DB): Record<string, number> {
  const rows = db
    .prepare("SELECT game_id, COUNT(*) AS count FROM game_sessions WHERE status = 'active' GROUP BY game_id")
    .all() as { game_id: string; count: number }[];
  return Object.fromEntries(rows.map((row) => [row.game_id, row.count]));
}

/** Wilson score interval, returned as percentages. */
export function wilsonInterval(wins: number, sample: number): { low: number; high: number } {
  if (sample <= 0) return { low: 0, high: 0 };
  const z = 1.96;
  const p = wins / sample;
  const denominator = 1 + (z * z) / sample;
  const centre = p + (z * z) / (2 * sample);
  const spread = z * Math.sqrt((p * (1 - p)) / sample + (z * z) / (4 * sample * sample));
  return {
    low: Math.max(0, ((centre - spread) / denominator) * 100),
    high: Math.min(100, ((centre + spread) / denominator) * 100),
  };
}

export function evaluateDeviation(input: {
  wins: number;
  losses: number;
  expectedWins: number;
  variance: number;
  averageConfigured: number | null;
  minimumSample?: number;
}): GameStatsDeviation {
  const sample = input.wins + input.losses;
  const minimumSample = input.minimumSample ?? MIN_WARNING_SAMPLE;
  const observed = sample > 0 ? (input.wins / sample) * 100 : null;
  const configured =
    sample > 0
      ? (input.expectedWins / sample) * 100
      : input.averageConfigured;
  const interval = sample > 0 ? wilsonInterval(input.wins, sample) : null;

  if (sample < minimumSample) {
    return {
      level: 'insufficient',
      sampleSize: sample,
      minimumSample,
      configuredWinChance: configured === null ? null : pct(configured),
      observedWinRate: observed === null ? null : pct(observed),
      confidenceLow: interval ? pct(interval.low) : null,
      confidenceHigh: interval ? pct(interval.high) : null,
      zScore: null,
      deltaPercentagePoints: null,
      message:
        sample === 0
          ? `No settled rounds with a configuration snapshot yet. ${minimumSample} are needed before a deviation warning is meaningful.`
          : `Only ${sample} settled round${sample === 1 ? '' : 's'} with a configuration snapshot. ${minimumSample} are needed before a deviation warning is meaningful.`,
    };
  }

  if (input.variance <= 0 || configured === null) {
    return {
      level: 'normal',
      sampleSize: sample,
      minimumSample,
      configuredWinChance: configured === null ? null : pct(configured),
      observedWinRate: observed === null ? null : pct(observed),
      confidenceLow: interval ? pct(interval.low) : null,
      confidenceHigh: interval ? pct(interval.high) : null,
      zScore: null,
      deltaPercentagePoints: null,
      message: null,
    };
  }

  const zScore = (input.wins - input.expectedWins) / Math.sqrt(input.variance);
  const delta = (observed ?? 0) - configured;
  const warning = Math.abs(zScore) >= WARNING_Z_SCORE && Math.abs(delta) >= WARNING_DELTA * 100;

  return {
    level: warning ? 'warning' : 'normal',
    sampleSize: sample,
    minimumSample,
    configuredWinChance: pct(configured),
    observedWinRate: observed === null ? null : pct(observed),
    confidenceLow: interval ? pct(interval.low) : null,
    confidenceHigh: interval ? pct(interval.high) : null,
    zScore: Math.round(zScore * 100) / 100,
    deltaPercentagePoints: pct(delta),
    message: warning
      ? `Observed ${pct(observed ?? 0)}% vs ${pct(configured)}% configured across ${sample} settled rounds (z = ${Math.round(zScore * 10) / 10}). This is outside the 3σ control band. Review the configuration and data; nothing was changed automatically.`
      : null,
  };
}

function gameChance(config: Record<string, unknown>, slug: string): number {
  const value = config.winChance;
  return typeof value === 'number' && Number.isFinite(value) ? pct(value) : defaultWinChance(slug);
}

function modeFor(slug: string): { mode: GameWinChanceMode; modeLabel: string } {
  const info = GAME_WIN_CHANCE_INFO[slug];
  if (!info) return { mode: 'target', modeLabel: 'Monitoring target' };
  return { mode: info.mode, modeLabel: info.label };
}

function buildRows(db: DB, from: string | null): GameStatsRow[] {
  const aggregates = new Map(aggregateRows(db, from).map((row) => [row.game_id, row]));
  const active = activeRoundsByGame(db);
  const games = db.prepare('SELECT id, name, description, enabled, config FROM games ORDER BY name').all() as GameRow[];

  return games.map((game) => {
    const row = aggregates.get(game.id);
    const config = parseJson<Record<string, unknown>>(game.config, {});
    const wins = row?.wins ?? 0;
    const losses = row?.losses ?? 0;
    const pushes = row?.pushes ?? 0;
    const decided = wins + losses;
    const comparisonWins = row?.comparison_wins ?? 0;
    const comparisonLosses = row?.comparison_losses ?? 0;
    const comparisonSample = comparisonWins + comparisonLosses;
    const wagered = row?.wagered ?? 0;
    const payouts = row?.payouts ?? 0;
    const info = modeFor(game.id);

    return {
      slug: game.id,
      name: game.name,
      description: game.description,
      enabled: Boolean(game.enabled),
      ...info,
      configuredWinChance: gameChance(config, game.id),
      bets: row?.bets ?? 0,
      openRounds: active[game.id] ?? 0,
      wins,
      losses,
      pushes,
      actualWinRate: decided > 0 ? pct((wins / decided) * 100) : null,
      comparisonSample,
      comparisonWinRate: comparisonSample > 0 ? pct((comparisonWins / comparisonSample) * 100) : null,
      averageConfiguredWinChance: row?.avg_configured === null || row?.avg_configured === undefined ? null : pct(row.avg_configured),
      wagered,
      payouts,
      houseProfit: wagered - payouts,
      rtp: wagered > 0 ? pct((payouts / wagered) * 100) : null,
      lastSettledAt: row?.last_settled ?? null,
      deviation: evaluateDeviation({
        wins: comparisonWins,
        losses: comparisonLosses,
        expectedWins: row?.expected_wins ?? 0,
        variance: row?.variance ?? 0,
        averageConfigured: row?.avg_configured ?? null,
      }),
    };
  });
}

function totalsFor(rows: GameStatsRow[]): GameStatsTotals {
  const totals = rows.reduce(
    (acc, row) => {
      acc.bets += row.bets;
      acc.wins += row.wins;
      acc.losses += row.losses;
      acc.pushes += row.pushes;
      acc.wagered += row.wagered;
      acc.payouts += row.payouts;
      acc.comparisonSample += row.comparisonSample;
      if (row.deviation.level === 'warning') acc.warningCount += 1;
      return acc;
    },
    { bets: 0, wins: 0, losses: 0, pushes: 0, wagered: 0, payouts: 0, comparisonSample: 0, warningCount: 0 },
  );
  const decided = totals.wins + totals.losses;
  return {
    ...totals,
    houseProfit: totals.wagered - totals.payouts,
    actualWinRate: decided > 0 ? pct((totals.wins / decided) * 100) : null,
  };
}

const SORT_FIELDS: Record<GameStatsSort, (row: GameStatsRow) => number | string> = {
  name: (row) => row.name.toLowerCase(),
  bets: (row) => row.bets,
  winRate: (row) => row.actualWinRate ?? -1,
  wagered: (row) => row.wagered,
  houseProfit: (row) => row.houseProfit,
  configuredWinChance: (row) => row.configuredWinChance,
};

export function getGameStats(
  db: DB,
  input: { range: GameStatsRange; search?: string; sort?: GameStatsSort; direction?: 'asc' | 'desc' },
  now = new Date(),
): GameStatsResponse {
  const window = buildRangeWindow(db, input.range, now);
  let rows = buildRows(db, window.from);
  const search = input.search?.trim().toLowerCase();
  if (search) {
    rows = rows.filter(
      (row) => row.name.toLowerCase().includes(search) || row.slug.toLowerCase().includes(search),
    );
  }
  const sort = input.sort ?? 'wagered';
  const direction = input.direction ?? (sort === 'name' ? 'asc' : 'desc');
  const selector = SORT_FIELDS[sort];
  rows.sort((a, b) => {
    const left = selector(a);
    const right = selector(b);
    const order = typeof left === 'string' || typeof right === 'string'
      ? String(left).localeCompare(String(right))
      : (left as number) - (right as number);
    return direction === 'asc' ? order : -order;
  });

  // Totals reflect the selected date range and search, but always every game
  // matching the search even when the table is sorted.
  const totals = totalsFor(rows);
  return {
    range: input.range,
    from: window.from,
    to: window.to,
    generatedAt: nowIso(),
    minimumSample: MIN_WARNING_SAMPLE,
    warningCount: totals.warningCount,
    games: rows,
    totals,
  };
}

function trendFor(db: DB, slug: string, window: RangeWindow): GameStatsTrendPoint[] {
  if (window.buckets.length === 0) return [];
  const format =
    window.bucket === 'hour' ? '%Y-%m-%dT%H:00' : window.bucket === 'month' ? '%Y-%m' : '%Y-%m-%d';
  const where = ["game_id = ?", "status IN ('won','lost','push')"];
  const params: unknown[] = [slug];
  if (window.from) {
    where.push('COALESCE(ended_at, created_at) >= ?');
    params.push(window.from);
  }
  const rows = db
    .prepare(
      `SELECT strftime('${format}', COALESCE(ended_at, created_at)) AS bucket,
              COUNT(*) AS bets,
              COALESCE(SUM(CASE WHEN payout > bet THEN 1 ELSE 0 END), 0) AS wins,
              COALESCE(SUM(CASE WHEN payout < bet THEN 1 ELSE 0 END), 0) AS losses,
              COALESCE(SUM(CASE WHEN payout = bet THEN 1 ELSE 0 END), 0) AS pushes,
              AVG(configured_win_chance) AS avg_configured,
              COALESCE(SUM(bet), 0) AS wagered,
              COALESCE(SUM(payout), 0) AS payouts
         FROM game_sessions
        WHERE ${where.join(' AND ')}
        GROUP BY bucket
        ORDER BY bucket ASC`,
    )
    .all(...params) as {
    bucket: string;
    bets: number;
    wins: number;
    losses: number;
    pushes: number;
    avg_configured: number | null;
    wagered: number;
    payouts: number;
  }[];
  const byBucket = new Map(rows.map((row) => [row.bucket, row]));
  return window.buckets.map((bucket) => {
    const row = byBucket.get(bucket.key);
    const wins = row?.wins ?? 0;
    const losses = row?.losses ?? 0;
    const decided = wins + losses;
    const wagered = row?.wagered ?? 0;
    const payouts = row?.payouts ?? 0;
    return {
      bucket: bucket.key,
      label: bucket.label,
      bets: row?.bets ?? 0,
      wins,
      losses,
      pushes: row?.pushes ?? 0,
      wagered,
      payouts,
      houseProfit: wagered - payouts,
      rtp: wagered > 0 ? pct((payouts / wagered) * 100) : null,
      actualWinRate: decided > 0 ? pct((wins / decided) * 100) : null,
      averageConfiguredWinChance:
        row?.avg_configured === null || row?.avg_configured === undefined ? null : pct(row.avg_configured),
    };
  });
}

export function getGameStatsDetail(
  db: DB,
  slug: string,
  range: GameStatsRange,
  now = new Date(),
): GameStatsDetailResponse {
  const window = buildRangeWindow(db, range, now);
  const rows = buildRows(db, window.from);
  const game = rows.find((row) => row.slug === slug);
  if (!game) throw notFound('Game not found.');
  return {
    range,
    from: window.from,
    to: window.to,
    generatedAt: nowIso(),
    minimumSample: MIN_WARNING_SAMPLE,
    game,
    trend: trendFor(db, slug, window),
    history: listGameConfigHistory(db, slug, HISTORY_LIMIT),
  };
}

export function listGameConfigHistory(db: DB, slug: string, limit = HISTORY_LIMIT): GameConfigHistoryEntry[] {
  const rows = db
    .prepare(
      `SELECT h.id, h.previous_config, h.new_config, h.previous_win_chance, h.new_win_chance,
              h.created_at, u.username AS actor_name
         FROM game_config_history h
         LEFT JOIN users u ON u.id = h.actor_id
        WHERE h.game_id = ?
        ORDER BY h.created_at DESC
        LIMIT ?`,
    )
    .all(slug, limit) as {
    id: string;
    previous_config: string;
    new_config: string;
    previous_win_chance: number | null;
    new_win_chance: number | null;
    created_at: string;
    actor_name: string | null;
  }[];
  return rows.map((row) => {
    const previous = parseJson<Record<string, unknown>>(row.previous_config, {});
    const next = parseJson<Record<string, unknown>>(row.new_config, {});
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    const changedKeys = [...keys]
      .filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]))
      .sort();
    return {
      id: row.id,
      actorName: row.actor_name,
      createdAt: row.created_at,
      previousWinChance: row.previous_win_chance,
      newWinChance: row.new_win_chance,
      changedKeys,
      previousConfig: previous,
      newConfig: next,
    };
  });
}

export function recordGameConfigChange(
  db: DB,
  input: {
    gameId: string;
    actorId: string;
    previous: Record<string, unknown>;
    next: Record<string, unknown>;
  },
): boolean {
  if (JSON.stringify(input.previous) === JSON.stringify(input.next)) return false;
  const previousChance = typeof input.previous.winChance === 'number' ? input.previous.winChance : null;
  const nextChance = typeof input.next.winChance === 'number' ? input.next.winChance : null;
  db.prepare(
    `INSERT INTO game_config_history
       (id, game_id, actor_id, previous_config, new_config, previous_win_chance, new_win_chance, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId('gch'),
    input.gameId,
    input.actorId,
    JSON.stringify(input.previous),
    JSON.stringify(input.next),
    previousChance,
    nextChance,
    nowIso(),
  );
  return true;
}
