import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  ChartNoAxesCombined,
  ChevronRight,
  Coins,
  Gamepad2,
  Landmark,
  Percent,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import {
  GAME_STATS_RANGES,
  roleHasPermission,
  type GameConfigHistoryEntry,
  type GameStatsDetailResponse,
  type GameStatsDeviation,
  type GameStatsRange,
  type GameStatsResponse,
  type GameStatsRow,
  type GameStatsSort,
  type GameStatsTrendPoint,
} from '../../shared/types';
import { useApiQuery } from '../lib/useApi';
import { useAuth } from '../context/AuthContext';
import { count, dateTime, money, timeAgo, titleCase } from '../lib/format';
import { PageHeader } from '../components/layout';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  StatCard,
  TableWrap,
  Tabs,
  Td,
  Th,
  Tr,
  cn,
} from '../components/ui';

const percent = (value: number | null, digits = 1): string =>
  value === null ? '—' : `${value.toFixed(digits)}%`;

const signedMoney = (value: number): string => `${value > 0 ? '+' : ''}${money(value)}`;

const profitTone = (value: number): string =>
  value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-muted';

const SORT_OPTIONS: { value: GameStatsSort; label: string }[] = [
  { value: 'wagered', label: 'Total wagered' },
  { value: 'bets', label: 'Total bets' },
  { value: 'winRate', label: 'Actual win rate' },
  { value: 'houseProfit', label: 'House profit' },
  { value: 'configuredWinChance', label: 'Configured chance' },
  { value: 'name', label: 'Game name' },
];

function rangeTabs(value: GameStatsRange, onChange: (range: GameStatsRange) => void) {
  return (
    <Tabs
      items={GAME_STATS_RANGES.map((range) => ({ key: range.value, label: range.label }))}
      value={value}
      onChange={(key) => onChange(key as GameStatsRange)}
    />
  );
}

function DeviationBadge({ deviation }: { deviation: GameStatsDeviation }) {
  if (deviation.level === 'warning') {
    return (
      <Badge tone="danger" dot>
        Deviation
      </Badge>
    );
  }
  if (deviation.level === 'insufficient') {
    return <Badge tone="neutral">Need data</Badge>;
  }
  return (
    <Badge tone="success" dot>
      Within range
    </Badge>
  );
}

function DeviationAlert({ row }: { row: GameStatsRow }) {
  const deviation = row.deviation;
  if (deviation.level === 'warning') {
    return (
      <Alert tone="warning" title={`${row.name} is outside its control band`}>
        <p>{deviation.message}</p>
        <p className="mt-1.5 text-[11px] text-warning/80">
          A warning is informational only. Probabilities are never adjusted automatically from short-term results.
        </p>
      </Alert>
    );
  }
  if (deviation.level === 'insufficient') {
    return (
      <Alert tone="info" title="Deviation monitoring needs more settled rounds">
        <p>{deviation.message}</p>
        <p className="mt-1.5 text-[11px] text-info/80">
          The configured chance is still recorded on every new bet, so the sample grows automatically.
        </p>
      </Alert>
    );
  }
  return (
    <Alert tone="success" title="Actual results are within the expected range">
      <p>
        Observed {percent(deviation.observedWinRate)} vs {percent(deviation.configuredWinChance)} configured across{' '}
        {count(deviation.sampleSize)} settled rounds
        {deviation.zScore === null ? '' : ` (z = ${deviation.zScore.toFixed(1)})`}. No action is needed.
      </p>
    </Alert>
  );
}

/* --------------------------------- charts -------------------------------- */

function chartX(index: number, length: number, left: number, width: number): number {
  if (length <= 1) return left + width / 2;
  return left + (index / (length - 1)) * width;
}

function linePath(
  points: GameStatsTrendPoint[],
  getter: (point: GameStatsTrendPoint) => number | null,
  x: (index: number) => number,
  y: (value: number) => number,
): string {
  let path = '';
  let drawing = false;
  points.forEach((point, index) => {
    const value = getter(point);
    if (value === null) {
      drawing = false;
      return;
    }
    path += `${drawing ? 'L' : 'M'}${x(index).toFixed(2)},${y(value).toFixed(2)} `;
    drawing = true;
  });
  return path.trim();
}

function WinRateTrendChart({
  points,
  currentChance,
}: {
  points: GameStatsTrendPoint[];
  currentChance: number;
}) {
  const width = 720;
  const height = 230;
  const left = 42;
  const right = 14;
  const top = 14;
  const bottom = 30;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (index: number) => chartX(index, points.length, left, plotWidth);
  const y = (value: number) => top + (1 - Math.min(100, Math.max(0, value)) / 100) * plotHeight;
  const actual = linePath(points, (point) => point.actualWinRate, x, y);
  const configured = linePath(points, (point) => point.averageConfiguredWinChance, x, y);
  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 4), Math.floor((points.length - 1) / 2), Math.floor(((points.length - 1) * 3) / 4), points.length - 1])];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-[10.5px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-gold" /> Actual win rate
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-info" /> Period average configured
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0 w-4 border-t border-dashed border-warning" /> Current {currentChance}%
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Win rate trend chart">
        {[0, 25, 50, 75, 100].map((value) => (
          <g key={value}>
            <line
              x1={left}
              x2={left + plotWidth}
              y1={y(value)}
              y2={y(value)}
              stroke="rgba(255,255,255,0.075)"
              strokeWidth="1"
            />
            <text x={left - 8} y={y(value) + 3} textAnchor="end" fill="rgba(155,162,176,0.8)" fontSize="9">
              {value}%
            </text>
          </g>
        ))}
        <line
          x1={left}
          x2={left + plotWidth}
          y1={y(currentChance)}
          y2={y(currentChance)}
          stroke="rgba(240,180,80,0.55)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        {configured && (
          <path d={configured} fill="none" stroke="rgba(122,167,230,0.85)" strokeWidth="1.8" strokeLinejoin="round" />
        )}
        {actual && (
          <path
            d={actual}
            fill="none"
            stroke="#e6c27a"
            strokeWidth="2.2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {points.length <= 31 &&
          points.map((point, index) =>
            point.actualWinRate === null ? null : (
              <circle key={point.bucket} cx={x(index)} cy={y(point.actualWinRate)} r="2.6" fill="#e6c27a">
                <title>
                  {point.label}: {percent(point.actualWinRate)} actual, {percent(point.averageConfiguredWinChance)}{' '}
                  configured
                </title>
              </circle>
            ),
          )}
        {labelIndexes.map((index) => {
          const point = points[index];
          if (!point) return null;
          return (
            <text
              key={`${point.bucket}-${index}`}
              x={x(index)}
              y={height - 8}
              textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
              fill="rgba(155,162,176,0.8)"
              fontSize="9"
            >
              {point.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function HouseProfitChart({ points }: { points: GameStatsTrendPoint[] }) {
  const width = 720;
  const height = 190;
  const left = 54;
  const right = 14;
  const top = 14;
  const bottom = 30;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxAbs = Math.max(1, ...points.map((point) => Math.abs(point.houseProfit)));
  const zero = top + plotHeight / 2;
  const scale = plotHeight / 2 / maxAbs;
  const x = (index: number) => chartX(index, points.length, left, plotWidth);
  const barWidth = points.length > 0 ? Math.max(1, (plotWidth / points.length) * 0.62) : 1;
  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 4), Math.floor((points.length - 1) / 2), Math.floor(((points.length - 1) * 3) / 4), points.length - 1])];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-[10.5px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-success" /> House profit
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-danger" /> House loss
        </span>
        <span className="text-faint">Wagered minus payouts per period</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="House profit trend chart">
        {[maxAbs, 0, -maxAbs].map((value) => (
          <g key={value}>
            <line
              x1={left}
              x2={left + plotWidth}
              y1={top + (1 - (value + maxAbs) / (2 * maxAbs)) * plotHeight}
              y2={top + (1 - (value + maxAbs) / (2 * maxAbs)) * plotHeight}
              stroke={value === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.075)'}
              strokeWidth="1"
            />
            <text
              x={left - 8}
              y={top + (1 - (value + maxAbs) / (2 * maxAbs)) * plotHeight + 3}
              textAnchor="end"
              fill="rgba(155,162,176,0.8)"
              fontSize="9"
            >
              {signedMoney(value)}
            </text>
          </g>
        ))}
        {points.map((point, index) => {
          const valueY = top + (1 - (point.houseProfit + maxAbs) / (2 * maxAbs)) * plotHeight;
          const barY = Math.min(valueY, zero);
          const barHeight = Math.max(1, Math.abs(valueY - zero));
          return (
            <rect
              key={point.bucket}
              x={x(index) - barWidth / 2}
              y={barY}
              width={barWidth}
              height={barHeight}
              rx={Math.min(2, barWidth / 2)}
              fill={point.houseProfit >= 0 ? '#4ecb9a' : '#e06c75'}
              opacity={point.bets === 0 ? 0.18 : 0.9}
            >
              <title>
                {point.label}: {signedMoney(point.houseProfit)} house P/L · {money(point.wagered)} wagered ·{' '}
                {money(point.payouts)} paid
              </title>
            </rect>
          );
        })}
        {labelIndexes.map((index) => {
          const point = points[index];
          if (!point) return null;
          return (
            <text
              key={`${point.bucket}-${index}`}
              x={x(index)}
              y={height - 8}
              textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
              fill="rgba(155,162,176,0.8)"
              fontSize="9"
            >
              {point.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

/* ------------------------------- overview -------------------------------- */

export function GameStatsPage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const inAdmin = location.pathname.startsWith('/admin');
  const base = inAdmin ? '/admin/game-stats' : '/staff/games';
  const [range, setRange] = useState<GameStatsRange>('30d');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<GameStatsSort>('wagered');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 320);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const params = new URLSearchParams({ range, sort, direction });
  if (search) params.set('q', search);
  const query = useApiQuery<GameStatsResponse>(`/staff/game-stats?${params.toString()}`);
  const data = query.data;

  const warningRows = useMemo(() => data?.games.filter((game) => game.deviation.level === 'warning') ?? [], [data]);

  const selectSort = (next: GameStatsSort) => {
    setSort(next);
    setDirection(next === 'name' ? 'asc' : 'desc');
  };

  if (query.loading && !data) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-14 w-80" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-32 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-[420px] rounded-2xl" />
      </div>
    );
  }

  if (query.error && !data) {
    return (
      <div>
        <PageHeader title="Game statistics" />
        <Alert tone="error" title="Could not load game statistics">
          {query.error}
        </Alert>
        <Button className="mt-4" onClick={query.refetch}>Retry</Button>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Game statistics"
        description="Real settled-round performance for every game. Configured chances are kept separate from observed results."
        actions={
          <>
            {user && roleHasPermission(user.role, 'games.manage') && (
              <Link to="/admin/games">
                <Button variant="secondary" leftIcon={<Gamepad2 className="h-4 w-4" />}>
                  Game configuration
                </Button>
              </Link>
            )}
            <Button variant="secondary" onClick={query.refetch} leftIcon={<RefreshCw className="h-4 w-4" />}>
              Refresh
            </Button>
          </>
        }
      />

      {query.error && <Alert tone="error" className="mb-4">{query.error}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Total bets"
          value={count(data?.totals.bets ?? 0)}
          hint="Settled rounds in this period"
          icon={<BarChart3 className="h-4 w-4" />}
        />
        <StatCard
          label="Wagered"
          value={money(data?.totals.wagered ?? 0)}
          hint="Player stakes"
          icon={<Coins className="h-4 w-4" />}
        />
        <StatCard
          label="Payouts"
          value={money(data?.totals.payouts ?? 0)}
          hint="Returned to players"
          icon={<Landmark className="h-4 w-4" />}
        />
        <StatCard
          label="House P/L"
          value={
            <span className={profitTone(data?.totals.houseProfit ?? 0)}>
              {signedMoney(data?.totals.houseProfit ?? 0)}
            </span>
          }
          hint="Wagered minus payouts"
          icon={<TrendingUp className="h-4 w-4" />}
          tone={(data?.totals.houseProfit ?? 0) >= 0 ? 'success' : 'danger'}
        />
        <StatCard
          label="Actual win rate"
          value={percent(data?.totals.actualWinRate ?? null)}
          hint={`${count(data?.totals.wins ?? 0)}W · ${count(data?.totals.losses ?? 0)}L · ${count(data?.totals.pushes ?? 0)}P`}
          icon={<Percent className="h-4 w-4" />}
        />
        <StatCard
          label="Deviations"
          value={count(data?.warningCount ?? 0)}
          hint={data?.warningCount ? 'Games outside the control band' : 'No significant deviations'}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={data?.warningCount ? 'warning' : 'success'}
        />
      </div>

      {warningRows.length > 0 ? (
        <Alert tone="warning" title={`${warningRows.length} game${warningRows.length === 1 ? '' : 's'} outside the statistical control band`} className="mt-4">
          <p>
            {warningRows.map((game) => `${game.name} (${percent(game.deviation.observedWinRate)} vs ${percent(game.deviation.configuredWinChance)})`).join(' · ')}
          </p>
          <p className="mt-1 text-[11px] text-warning/80">
            Warnings are advisory only. Probabilities are never changed automatically from short-term results.
          </p>
        </Alert>
      ) : (
        <Alert tone="info" className="mt-4">
          No statistically significant deviations in this period. Warnings require at least{' '}
          {data?.minimumSample ?? 50} settled rounds with a configuration snapshot, a 3σ z-score, and a difference of at
          least 5 percentage points. {count(data?.totals.comparisonSample ?? 0)} comparable rounds are in this view.
        </Alert>
      )}

      <Card className="mt-4 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative min-w-[220px] flex-1 xl:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search games"
                className="pl-9"
                aria-label="Search games"
              />
            </div>
            {rangeTabs(range, setRange)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Field className="w-44">
              <Select
                value={sort}
                onChange={(event) => selectSort(event.target.value as GameStatsSort)}
                aria-label="Sort games"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              variant="secondary"
              size="icon"
              aria-label={direction === 'asc' ? 'Sort ascending' : 'Sort descending'}
              title={direction === 'asc' ? 'Ascending' : 'Descending'}
              onClick={() => setDirection((value) => (value === 'asc' ? 'desc' : 'asc'))}
            >
              {direction === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {query.error ? (
          <div className="p-4"><Alert tone="error">{query.error}</Alert></div>
        ) : (data?.games.length ?? 0) === 0 ? (
          <EmptyState
            icon={<ChartNoAxesCombined className="h-5 w-5" />}
            title="No games match this search"
            description="Clear the search to see every game."
          />
        ) : (
          <TableWrap minWidth={980}>
            <thead>
              <tr>
                <Th>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-inherit"
                    onClick={() => selectSort('name')}
                  >
                    Game <ArrowUpDown className={cn('h-3 w-3', sort === 'name' ? 'text-gold' : 'text-faint')} />
                  </button>
                </Th>
                <Th>
                  <button type="button" className="inline-flex items-center gap-1 text-inherit" onClick={() => selectSort('bets')}>
                    Bets <ArrowUpDown className={cn('h-3 w-3', sort === 'bets' ? 'text-gold' : 'text-faint')} />
                  </button>
                </Th>
                <Th>W / L / P</Th>
                <Th>
                  <button type="button" className="inline-flex items-center gap-1 text-inherit" onClick={() => selectSort('winRate')}>
                    Actual win <ArrowUpDown className={cn('h-3 w-3', sort === 'winRate' ? 'text-gold' : 'text-faint')} />
                  </button>
                </Th>
                <Th>
                  <button type="button" className="inline-flex items-center gap-1 text-inherit" onClick={() => selectSort('configuredWinChance')}>
                    Configured <ArrowUpDown className={cn('h-3 w-3', sort === 'configuredWinChance' ? 'text-gold' : 'text-faint')} />
                  </button>
                </Th>
                <Th>Monitoring</Th>
                <Th>
                  <button type="button" className="inline-flex items-center gap-1 text-inherit" onClick={() => selectSort('houseProfit')}>
                    House P/L <ArrowUpDown className={cn('h-3 w-3', sort === 'houseProfit' ? 'text-gold' : 'text-faint')} />
                  </button>
                </Th>
                <Th>
                  <button type="button" className="inline-flex items-center gap-1 text-inherit" onClick={() => selectSort('wagered')}>
                    Wagered <ArrowUpDown className={cn('h-3 w-3', sort === 'wagered' ? 'text-gold' : 'text-faint')} />
                  </button>
                </Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data!.games.map((game) => (
                <Tr key={game.slug} onClick={() => navigate(`${base}/${game.slug}`)}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-faint">
                        <Gamepad2 className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[12.5px] font-medium text-ink">{game.name}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          <span className="text-[10px] text-faint">{game.modeLabel}</span>
                          {!game.enabled && <Badge tone="warning">Offline</Badge>}
                          {game.openRounds > 0 && <Badge tone="info">{game.openRounds} open</Badge>}
                        </div>
                      </div>
                    </div>
                  </Td>
                  <Td className="tnum text-ink">{count(game.bets)}</Td>
                  <Td className="whitespace-nowrap tnum text-[11.5px]">
                    <span className="text-success">{count(game.wins)}</span>
                    <span className="text-faint"> / </span>
                    <span className="text-danger">{count(game.losses)}</span>
                    <span className="text-faint"> / </span>
                    <span className="text-muted">{count(game.pushes)}</span>
                  </Td>
                  <Td>
                    <p className="tnum text-[13px] font-semibold text-ink">{percent(game.actualWinRate)}</p>
                    <p className="mt-0.5 text-[10px] text-faint">
                      {game.comparisonSample > 0 ? `${count(game.comparisonSample)} snapshotted` : 'No snapshot data'}
                    </p>
                  </Td>
                  <Td>
                    <p className="tnum text-[13px] font-semibold text-gold-bright">{percent(game.configuredWinChance)}</p>
                    <p className="mt-0.5 text-[10px] text-faint">
                      {game.averageConfiguredWinChance === null ? 'Current setting' : `${percent(game.averageConfiguredWinChance)} period avg`}
                    </p>
                  </Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      <DeviationBadge deviation={game.deviation} />
                      <span className="text-[10px] text-faint">
                        {game.deviation.deltaPercentagePoints === null
                          ? `${count(game.deviation.sampleSize)}/${game.deviation.minimumSample} sample`
                          : `${game.deviation.deltaPercentagePoints > 0 ? '+' : ''}${game.deviation.deltaPercentagePoints.toFixed(1)} pp`}
                      </span>
                    </div>
                  </Td>
                  <Td className={cn('tnum font-semibold', profitTone(game.houseProfit))}>{signedMoney(game.houseProfit)}</Td>
                  <Td>
                    <p className="tnum text-ink">{money(game.wagered)}</p>
                    <p className="mt-0.5 text-[10px] text-faint">{money(game.payouts)} paid</p>
                  </Td>
                  <Td>
                    <ChevronRight className="h-4 w-4 text-faint transition-colors group-hover/row:text-gold" />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <p className="mt-4 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-faint">
        <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
        Financial figures use settled rounds only and are calculated from the database, not the browser. A win is a
        payout above the wager; pushes are excluded from win rates. Configured chances come from each round's saved
        snapshot, so old bets are never judged against newer settings.
      </p>
    </div>
  );
}

/* -------------------------------- detail --------------------------------- */

function ConfigHistoryTable({ entries }: { entries: GameConfigHistoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck className="h-5 w-5" />}
        title="No configuration changes yet"
        description="Every saved win-chance or rule change will appear here with the administrator, timestamp and previous/new values."
      />
    );
  }
  return (
    <TableWrap minWidth={760}>
      <thead>
        <tr>
          <Th>When</Th>
          <Th>Administrator</Th>
          <Th>Win chance</Th>
          <Th>Other changes</Th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <Tr key={entry.id}>
            <Td className="whitespace-nowrap text-[10.5px]">
              {dateTime(entry.createdAt)}
              <span className="ml-1 text-faint">· {timeAgo(entry.createdAt)}</span>
            </Td>
            <Td className="text-[11.5px] text-ink">{entry.actorName ?? 'Unknown'}</Td>
            <Td className="tnum text-[11.5px]">
              <span className="text-muted">{entry.previousWinChance === null ? '—' : `${entry.previousWinChance}%`}</span>
              <span className="mx-1.5 text-faint">→</span>
              <span className="font-semibold text-gold-bright">{entry.newWinChance === null ? '—' : `${entry.newWinChance}%`}</span>
            </Td>
            <Td className="text-[11px]">
              {entry.changedKeys.filter((key) => key !== 'winChance').length === 0
                ? '—'
                : entry.changedKeys
                    .filter((key) => key !== 'winChance')
                    .map((key) => titleCase(key))
                    .join(', ')}
            </Td>
          </Tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

export function GameStatsDetailPage() {
  const { slug = '' } = useParams();
  const { user } = useAuth();
  const location = useLocation();
  const inAdmin = location.pathname.startsWith('/admin');
  const base = inAdmin ? '/admin/game-stats' : '/staff/games';
  const [range, setRange] = useState<GameStatsRange>('30d');
  const query = useApiQuery<GameStatsDetailResponse>(
    slug ? `/staff/game-stats/${encodeURIComponent(slug)}?range=${range}` : null,
  );
  const detail = query.data;
  const game = detail?.game;

  if (query.loading && !detail) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-12 w-72" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-32 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (query.error || !detail || !game) {
    return (
      <div>
        <Link to={base} className="mb-4 inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Back to game statistics
        </Link>
        <Alert tone="error" title="Could not load this game">
          {query.error ?? 'Game not found.'}
        </Alert>
        <Button className="mt-4" onClick={query.refetch}>Retry</Button>
      </div>
    );
  }

  const recentBuckets = detail.trend.filter((point) => point.bets > 0).slice(-12).reverse();

  return (
    <div>
      <Link to={base} className="mb-3 inline-flex items-center gap-1.5 text-[12px] text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Back to game statistics
      </Link>
      <PageHeader
        title={game.name}
        description={game.description}
        actions={
          <>
            <Badge tone={game.mode === 'outcome' ? 'success' : 'info'}>{game.modeLabel}</Badge>
            {game.enabled ? <Badge tone="success" dot>Live</Badge> : <Badge tone="warning" dot>Offline</Badge>}
            {user && roleHasPermission(user.role, 'games.manage') && (
              <Link to="/admin/games">
                <Button variant="secondary" leftIcon={<Gamepad2 className="h-4 w-4" />}>Configure</Button>
              </Link>
            )}
            <Button variant="secondary" onClick={query.refetch} leftIcon={<RefreshCw className="h-4 w-4" />}>
              Refresh
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {rangeTabs(range, setRange)}
        <p className="text-[10.5px] text-faint">
          Last settled {timeAgo(game.lastSettledAt)} · {game.mode === 'outcome' ? 'Chance applied to new rounds' : 'Native rules, monitored target'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Total bets"
          value={count(game.bets)}
          hint={`${count(game.openRounds)} open now`}
          icon={<BarChart3 className="h-4 w-4" />}
        />
        <StatCard
          label="Actual win rate"
          value={percent(game.actualWinRate)}
          hint={`${count(game.wins)}W · ${count(game.losses)}L · ${count(game.pushes)}P`}
          icon={<Percent className="h-4 w-4" />}
        />
        <StatCard
          label="Configured chance"
          value={percent(game.configuredWinChance)}
          hint={game.averageConfiguredWinChance === null ? 'Current setting' : `${percent(game.averageConfiguredWinChance)} period average`}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="gold"
        />
        <StatCard
          label="House P/L"
          value={<span className={profitTone(game.houseProfit)}>{signedMoney(game.houseProfit)}</span>}
          hint={game.rtp === null ? 'No settled rounds' : `${game.rtp.toFixed(1)}% RTP`}
          icon={<Landmark className="h-4 w-4" />}
          tone={game.houseProfit >= 0 ? 'success' : 'danger'}
        />
        <StatCard
          label="Wagered"
          value={money(game.wagered)}
          hint="Settled player stakes"
          icon={<Coins className="h-4 w-4" />}
        />
        <StatCard
          label="Payouts"
          value={money(game.payouts)}
          hint="Returned to players"
          icon={<TrendingUp className="h-4 w-4" />}
        />
      </div>

      <div className="mt-4">
        <DeviationAlert row={game} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader
            title="Win rate trend"
            description="Observed profitability against the configured chance recorded on each bet."
            action={
              <span className="text-[10px] text-faint">
                {count(game.comparisonSample)} comparable settled rounds
              </span>
            }
          />
          <div className="p-4">
            {detail.trend.length === 0 ? (
              <EmptyState
                icon={<ChartNoAxesCombined className="h-5 w-5" />}
                title="No trend data yet"
                description="Settled rounds will populate this chart."
              />
            ) : (
              <WinRateTrendChart points={detail.trend} currentChance={game.configuredWinChance} />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Configured vs observed" description="Monitoring is descriptive; it never changes a probability." />
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-line/80 bg-surface-2/50 p-3">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint">Configured</p>
                <p className="mt-1.5 font-display text-2xl font-semibold tnum text-gold-bright">
                  {percent(game.deviation.configuredWinChance ?? game.configuredWinChance)}
                </p>
              </div>
              <div className="rounded-xl border border-line/80 bg-surface-2/50 p-3">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint">Observed</p>
                <p className={cn('mt-1.5 font-display text-2xl font-semibold tnum', game.deviation.level === 'warning' ? 'text-warning' : 'text-ink')}>
                  {percent(game.deviation.observedWinRate)}
                </p>
              </div>
            </div>
            <dl className="space-y-2 text-[11.5px]">
              <div className="flex justify-between gap-3">
                <dt className="text-faint">95% confidence</dt>
                <dd className="tnum text-ink">
                  {game.deviation.confidenceLow === null
                    ? '—'
                    : `${game.deviation.confidenceLow.toFixed(1)}–${game.deviation.confidenceHigh?.toFixed(1)}%`}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-faint">Comparison sample</dt>
                <dd className="tnum text-ink">
                  {count(game.deviation.sampleSize)} / {count(game.deviation.minimumSample)} minimum
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-faint">Z-score</dt>
                <dd className="tnum text-ink">{game.deviation.zScore === null ? '—' : game.deviation.zScore.toFixed(2)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-faint">Difference</dt>
                <dd className={cn('tnum', game.deviation.level === 'warning' ? 'text-warning' : 'text-ink')}>
                  {game.deviation.deltaPercentagePoints === null
                    ? '—'
                    : `${game.deviation.deltaPercentagePoints > 0 ? '+' : ''}${game.deviation.deltaPercentagePoints.toFixed(1)} pp`}
                </dd>
              </div>
            </dl>
            <div className="rounded-lg border border-line/70 bg-surface-1/60 px-3 py-2.5">
              <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-muted">
                <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-gold" />
                A warning needs a 3σ deviation, at least 50 comparable settled rounds, and a 5-point gap. This keeps
                ordinary variance from triggering alerts. Configuration is never changed automatically.
              </p>
            </div>
            <p className="text-[10px] leading-relaxed text-faint">
              {game.mode === 'outcome'
                ? 'This game applies its configured chance at round creation. Existing rounds keep the chance they started with.'
                : 'Outcomes are driven by this game’s fixed mechanics. The configured chance is a monitoring baseline, not a forced result.'}
            </p>
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="House profit and payout trend"
          description="Wagered minus payouts in each period. Positive bars are house profit; negative bars are player-favourable periods."
        />
        <div className="p-4">
          {detail.trend.length === 0 ? (
            <EmptyState
              icon={<BarChart3 className="h-5 w-5" />}
              title="No financial trend yet"
              description="Settled wagers and payouts will populate this chart."
            />
          ) : (
            <HouseProfitChart points={detail.trend} />
          )}
        </div>
      </Card>

      <Card className="mt-4 overflow-hidden">
        <CardHeader title="Recent periods" description="The most recent buckets with settled activity." />
        {recentBuckets.length === 0 ? (
          <EmptyState
            icon={<ChartNoAxesCombined className="h-5 w-5" />}
            title="No settled activity in this period"
            description="Try a longer date range."
          />
        ) : (
          <TableWrap minWidth={820}>
            <thead>
              <tr>
                <Th>Period</Th>
                <Th>Bets</Th>
                <Th>W / L / P</Th>
                <Th>Wagered</Th>
                <Th>Payouts</Th>
                <Th>House P/L</Th>
                <Th>RTP</Th>
                <Th>Actual win</Th>
              </tr>
            </thead>
            <tbody>
              {recentBuckets.map((point) => (
                <Tr key={point.bucket}>
                  <Td className="whitespace-nowrap text-[11.5px] text-ink">{point.label}</Td>
                  <Td className="tnum">{count(point.bets)}</Td>
                  <Td className="whitespace-nowrap text-[11.5px] tnum">
                    <span className="text-success">{count(point.wins)}</span>
                    <span className="text-faint"> / </span>
                    <span className="text-danger">{count(point.losses)}</span>
                    <span className="text-faint"> / </span>
                    <span className="text-muted">{count(point.pushes)}</span>
                  </Td>
                  <Td className="tnum">{money(point.wagered)}</Td>
                  <Td className="tnum">{money(point.payouts)}</Td>
                  <Td className={cn('tnum font-semibold', profitTone(point.houseProfit))}>{signedMoney(point.houseProfit)}</Td>
                  <Td className="tnum">{point.rtp === null ? '—' : `${point.rtp.toFixed(1)}%`}</Td>
                  <Td className="tnum">{percent(point.actualWinRate)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <Card className="mt-4 overflow-hidden">
        <CardHeader
          title="Configuration history"
          description="Append-only record of win-chance and rule changes, including the administrator, timestamp, and previous/new values."
        />
        <ConfigHistoryTable entries={detail.history} />
      </Card>
    </div>
  );
}
