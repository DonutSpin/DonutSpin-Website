import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleDollarSign, Sparkles } from 'lucide-react';
import type { PlinkoView } from '../../../shared/types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { errorMessage, requestId } from '../../lib/api';
import { acknowledgeRound, playGame, sleep } from '../../lib/games';
import { useRestoreActiveRound } from '../../lib/useActiveRound';
import { money } from '../../lib/format';
import {
  BalanceRow,
  BoardCard,
  GameError,
  GameLayout,
  GameSkeleton,
  ResultBanner,
  SidePanel,
  WagerField,
  useGameConfig,
} from '../../components/game';
import { Alert, Badge, Button, Card, cn } from '../../components/ui';

type Risk = 'low' | 'medium' | 'high';

const CENTER = 280;
const STEP_X = 18;
const ROW_Y = 40;
const ROW_GAP = 22;
const ROWS = 12;

export function PlinkoPage() {
  const { game, loading, error, refetch, maintenance, maxPayout } = useGameConfig('plinko');
  const { user, updateBalance } = useAuth();
  const { error: toastError, success } = useToast();
  const [bet, setBet] = useState(100);
  const [risk, setRisk] = useState<Risk>('medium');
  const [view, setView] = useState<PlinkoView | null>(null);
  const [busy, setBusy] = useState(false);
  const [landed, setLanded] = useState(false);
  const [ball, setBall] = useState<{ x: number; y: number }>({ x: CENTER, y: 16 });
  const [actionError, setActionError] = useState<string | null>(null);
  const [dropped, setDropped] = useState(0);
  const initialized = useRef(false);

  const tables = useMemo<Record<Risk, number[]>>(() => {
    const raw = game?.config.tables as Record<Risk, number[]> | undefined;
    return raw ?? {
      low: [10, 3, 1.6, 1.3, 1.1, 0.7, 0.5, 0.7, 1.1, 1.3, 1.6, 3, 10],
      medium: [33, 11, 4, 2, 1.2, 0.5, 0.2, 0.5, 1.2, 2, 4, 11, 33],
      high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
    };
  }, [game]);

  const enabledRisks = useMemo<Risk[]>(() => {
    const raw = game?.config.enabledRisks;
    return Array.isArray(raw) && raw.length ? (raw as Risk[]) : ['low', 'medium', 'high'];
  }, [game]);

  useEffect(() => {
    if (game && !initialized.current) {
      initialized.current = true;
      setBet(Math.max(game.minBet, Math.min(100, game.maxBet)));
      if (!enabledRisks.includes('medium')) setRisk(enabledRisks[0] ?? 'low');
    }
  }, [game, enabledRisks]);

  useRestoreActiveRound(game?.slug, (round) => {
    const restored = round.view as PlinkoView;
    setBet(restored.session.bet);
    setRisk(restored.risk);
    setView(restored);
    setBall({ x: CENTER + (restored.slot - 6) * STEP_X * 2, y: 296 });
    setLanded(true);
    setDropped((value) => value + 1);
    updateBalance(restored.balance);
    void acknowledgeRound(restored.session.id);
  });

  if (loading) return <GameSkeleton />;
  if (error || !game) return <GameError message={error ?? 'Game unavailable.'} onRetry={refetch} />;

  const balance = user?.balance ?? 0;
  const multipliers = tables[risk] ?? tables.medium;
  const maxMultiplier = Math.max(...multipliers);

  const drop = async () => {
    if (busy) return;
    setActionError(null);
    setBusy(true);
    setLanded(false);
    setView(null);
    setBall({ x: CENTER, y: 16 });
    try {
      const response = await playGame<PlinkoView>(game.slug, { requestId: requestId(), bet, risk });
      updateBalance(response.balance);
      setView(response);
      let rights = 0;
      for (let step = 0; step < response.path.length; step += 1) {
        if (response.path[step] === 'right') rights += 1;
        const x = CENTER + (rights - (step + 1 - rights)) * STEP_X;
        const y = ROW_Y + step * ROW_GAP;
        setBall({ x, y });
        await sleep(105);
      }
      setBall({ x: CENTER + (response.slot - 6) * STEP_X * 2, y: 296 });
      await sleep(220);
      setLanded(true);
      setDropped((value) => value + 1);
      void acknowledgeRound(response.session.id);
      if (response.session.payout >= response.session.bet) {
        success('Landing pays', `${money(response.session.payout)} money · ${response.multiplier.toFixed(2)}×`);
      }
    } catch (err) {
      setActionError(errorMessage(err));
      toastError('Drop failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const pegRows = Array.from({ length: ROWS }, (_, row) => {
    const pegs = row + 2;
    return Array.from({ length: pegs }, (_, index) => {
      const x = CENTER + (index - (pegs - 1) / 2) * (STEP_X * 2);
      return { x, y: ROW_Y + row * ROW_GAP };
    });
  }).flat();

  return (
    <GameLayout
      game={game}
      maintenance={maintenance}
      maxPayout={maxPayout}
      rules={
        <>
          <p>Drop the ball from the top. Each peg deflects it left or right with equal probability until it lands in a multiplier slot.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>The ball path is generated on the server; the animation replays that exact path.</li>
            <li>Edge slots carry the largest multipliers and the lowest probability.</li>
            <li>Low risk has gentler swings; high risk has large edges and frequent small returns.</li>
            <li>Your payout is the wager multiplied by the landing slot.</li>
          </ul>
        </>
      }
      board={
        <BoardCard
          label={
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-faint">Drop zone</span>
              <Badge tone="info">{risk} risk</Badge>
              {busy && <Badge tone="gold" dot>Ball in play</Badge>}
            </div>
          }
        >
          <div className="w-full">
            {landed && view && (
              <div className="mb-3">
                <ResultBanner
                  tone={view.session.status === 'won' ? 'win' : 'lose'}
                  title={`Landed on ${view.multiplier.toFixed(2)}×`}
                  detail={`Slot ${view.slot + 1} of 13 · ${risk} risk · wager ${money(view.session.bet)}`}
                  extra={
                    <span className={cn('font-display text-lg font-semibold tnum', view.session.payout >= view.session.bet ? 'text-success' : 'text-muted')}>
                      {money(view.session.payout)} <span className="text-[9px] uppercase">money</span>
                    </span>
                  }
                />
              </div>
            )}
            <div className="mx-auto w-full max-w-[640px]">
              <svg viewBox="0 0 560 350" className="w-full" role="img" aria-label="Plinko board">
                <defs>
                  <radialGradient id="ball-gradient" cx="35%" cy="30%">
                    <stop offset="0%" stopColor="#fff4d4" />
                    <stop offset="60%" stopColor="#e6bd74" />
                    <stop offset="100%" stopColor="#a87b34" />
                  </radialGradient>
                  <linearGradient id="bin-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(217,178,106,0.18)" />
                    <stop offset="100%" stopColor="rgba(217,178,106,0.05)" />
                  </linearGradient>
                </defs>
                {pegRows.map((peg, index) => (
                  <circle key={index} cx={peg.x} cy={peg.y} r={2.2} fill="#475062" opacity={0.8} />
                ))}
                {multipliers.map((value, index) => {
                  const x = CENTER + (index - 6) * STEP_X * 2;
                  const isLanded = landed && view?.slot === index;
                  return (
                    <g key={index}>
                      <rect
                        x={x - 15.5}
                        y={306}
                        width={31}
                        height={26}
                        rx={6}
                        fill={isLanded ? 'rgba(217,178,106,0.32)' : 'url(#bin-gradient)'}
                        stroke={isLanded ? '#d9b26a' : 'rgba(217,178,106,0.22)'}
                        strokeWidth={isLanded ? 1.5 : 1}
                      />
                      <text
                        x={x}
                        y={323}
                        textAnchor="middle"
                        fontSize="9.5"
                        fontWeight="600"
                        fill={isLanded ? '#f2d69e' : '#b6a074'}
                        fontFamily="Inter Variable, sans-serif"
                      >
                        {value}×
                      </text>
                    </g>
                  );
                })}
                <circle
                  cx={ball.x}
                  cy={ball.y}
                  r={7}
                  fill="url(#ball-gradient)"
                  style={{ transition: 'cx 100ms linear, cy 100ms linear', filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.55))' }}
                />
              </svg>
              <div className="mt-2 flex items-center justify-between text-[10px] text-faint">
                <span>12 rows · 13 slots</span>
                <span>Max {maxMultiplier.toFixed(2)}× · outcomes server-generated</span>
              </div>
            </div>
          </div>
        </BoardCard>
      }
      aside={
        <>
          <SidePanel>
            <BalanceRow />
            <WagerField value={bet} onChange={setBet} min={game.minBet} max={game.maxBet} balance={balance} disabled={busy} />
            <div>
              <p className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted">Risk level</p>
              <div className="grid grid-cols-3 gap-1.5">
                {(['low', 'medium', 'high'] as Risk[]).map((level) => {
                  const enabled = enabledRisks.includes(level);
                  return (
                    <button
                      key={level}
                      type="button"
                      disabled={!enabled || busy}
                      onClick={() => {
                        setRisk(level);
                        setView(null);
                        setLanded(false);
                        setBall({ x: CENTER, y: 16 });
                      }}
                      className={cn(
                        'rounded-lg border py-2 text-[11px] font-medium capitalize transition-colors disabled:opacity-30',
                        risk === level ? 'border-gold/50 bg-gold/10 text-gold' : 'border-line bg-surface-2 text-muted hover:text-ink',
                      )}
                    >
                      {level}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="rounded-xl border border-line bg-surface-2/60 p-3 text-[11.5px]">
              <div className="flex justify-between">
                <span className="text-muted">Max multiplier</span>
                <span className="font-medium text-gold">{maxMultiplier.toFixed(2)}×</span>
              </div>
              <div className="mt-1.5 flex justify-between">
                <span className="text-muted">Best possible</span>
                <span className="font-medium text-ink tnum">{money(Math.min(Math.floor(bet * maxMultiplier), maxPayout))} money</span>
              </div>
              <div className="mt-1.5 flex justify-between">
                <span className="text-muted">Drops this visit</span>
                <span className="font-medium text-ink tnum">{dropped}</span>
              </div>
            </div>
            {balance < game.minBet ? (
              <Alert tone="warning" title="No money to wager">
                <Link to="/cashier" className="underline">
                  Request money in the Cashier.
                </Link>
              </Alert>
            ) : (
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                loading={busy}
                onClick={() => void drop()}
                disabled={bet < game.minBet || bet > game.maxBet || bet > balance}
                leftIcon={<CircleDollarSign className="h-4 w-4" />}
              >
                Drop the ball
              </Button>
            )}
            {landed && view && (
              <p className="text-center text-[11px] text-faint">
                Landed at {view.multiplier.toFixed(2)}×. Drop again to keep playing.
              </p>
            )}
            {actionError && (
              <Alert tone="error" title="Drop failed">
                {actionError}
              </Alert>
            )}
          </SidePanel>
          <Card className="p-3.5">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-faint">Fair play</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              The server samples each of the 12 left/right deflections with a secure random generator, records the path,
              and settles the payout before the animation replays it.
            </p>
          </Card>
        </>
      }
    />
  );
}
