import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bomb, Gem, RotateCcw, ShieldQuestion, Sparkles } from 'lucide-react';
import type { MinesView } from '../../../shared/types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { errorMessage, requestId } from '../../lib/api';
import { acknowledgeRound, gameAction, playGame } from '../../lib/games';
import { useRestoreActiveRound } from '../../lib/useActiveRound';
import { money, multiplier } from '../../lib/format';
import {
  BalanceRow,
  BoardCard,
  GameError,
  GameLayout,
  GameSkeleton,
  ResultBanner,
  SidePanel,
  Stepper,
  WagerField,
  useGameConfig,
} from '../../components/game';
import { Alert, Badge, Button, Card, cn } from '../../components/ui';

export function MinesPage() {
  const { game, loading, error, refetch, maintenance, maxPayout } = useGameConfig('mines');
  const { user, updateBalance } = useAuth();
  const { error: toastError, success } = useToast();
  const [bet, setBet] = useState(100);
  const [mineCount, setMineCount] = useState(3);
  const [view, setView] = useState<MinesView | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (game && !initialized.current) {
      initialized.current = true;
      setBet(Math.max(game.minBet, Math.min(100, game.maxBet)));
      const limit = typeof game.config.maxMines === 'number' ? game.config.maxMines : 20;
      setMineCount(Math.min(3, limit));
    }
  }, [game]);

  useRestoreActiveRound(game?.slug, (round) => {
    const restored = round.view as MinesView;
    setBet(restored.session.bet);
    setMineCount(restored.mines);
    setView(restored);
    updateBalance(restored.balance);
    if (restored.session.status !== 'active') void acknowledgeRound(restored.session.id);
  });

  if (loading) return <GameSkeleton />;
  if (error || !game) return <GameError message={error ?? 'Game unavailable.'} onRetry={refetch} />;

  const maxMines = typeof game.config.maxMines === 'number' ? game.config.maxMines : 20;
  const houseEdge = typeof game.config.houseEdge === 'number' ? game.config.houseEdge : 0.03;
  const firstPickMultiplier = Math.round((1 - houseEdge) * (25 / (25 - mineCount)) * 100) / 100;
  const balance = user?.balance ?? 0;
  const active = view?.session.status === 'active';
  const ended = Boolean(view && view.session.status !== 'active');
  const endedWin = view?.session.status === 'won';
  const revealed = new Set(view?.revealed ?? []);
  const mineTiles = new Set(view?.mineTiles ?? []);

  const start = async () => {
    setActionError(null);
    setBusy(true);
    try {
      const response = await playGame<MinesView>(game.slug, {
        requestId: requestId(),
        bet,
        mines: mineCount,
      });
      setView(response);
      updateBalance(response.balance);
    } catch (err) {
      setActionError(errorMessage(err));
      toastError('Could not start the round', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reveal = async (tile: number) => {
    if (!view || !active || busy || revealed.has(tile)) return;
    setActionError(null);
    setBusy(true);
    try {
      const response = await gameAction<MinesView>(view.session.id, {
        action: 'reveal',
        tile,
        requestId: requestId(),
      });
      setView(response);
      updateBalance(response.balance);
      if (response.session.status !== 'active') {
        if (response.session.status === 'won') success('Grid cleared', `${money(response.session.payout)} money paid out.`);
        else toastError('Mine hit', 'The round is over. Start a new grid to try again.');
      }
    } catch (err) {
      setActionError(errorMessage(err));
      toastError('Reveal failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const cashout = async () => {
    if (!view || !active || busy || view.revealed.length === 0) return;
    setActionError(null);
    setBusy(true);
    try {
      const response = await gameAction<MinesView>(view.session.id, {
        action: 'cashout',
        requestId: requestId(),
      });
      setView(response);
      updateBalance(response.balance);
      success('Cashed out', `${money(response.session.payout)} money returned to your wallet.`);
    } catch (err) {
      setActionError(errorMessage(err));
      toastError('Cash-out failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <GameLayout
      game={game}
      maintenance={maintenance}
      maxPayout={maxPayout}
      rules={
        <>
          <p>Choose how many mines hide in a 5×5 grid, then reveal tiles one at a time. Every safe tile raises your multiplier.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Hit a mine and the round ends with no payout.</li>
            <li>Cash out at any time after one safe reveal to keep the current potential payout.</li>
            <li>Clear every safe tile and the round settles automatically at the final multiplier.</li>
            <li>The full mine layout is generated on the server before your first pick.</li>
          </ul>
        </>
      }
      board={
        <BoardCard
          label={
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-faint">Minefield</span>
              <Badge tone="warning">{view ? `${view.mines} mines` : `${mineCount} mines`}</Badge>
              {active && <Badge tone="gold" dot>Active</Badge>}
            </div>
          }
        >
          <div className="mx-auto w-full max-w-[460px]">
            {ended && view && (
              <div className="mb-4">
                <ResultBanner
                  tone={endedWin ? 'win' : 'lose'}
                  title={endedWin ? (view.revealed.length === 25 - view.mines ? 'Grid cleared!' : 'Cashed out') : 'You hit a mine.'}
                  detail={
                    endedWin
                      ? `${view.revealed.length} safe tiles · ${multiplier(view.multiplier)}`
                      : `${view.revealed.length} safe tiles before the hit.`
                  }
                  extra={
                    <span className={cn('font-display text-lg font-semibold tnum', endedWin ? 'text-success' : 'text-muted')}>
                      {endedWin ? `+${money(view.session.payout)}` : '0'} <span className="text-[9px] uppercase">money</span>
                    </span>
                  }
                />
              </div>
            )}
            <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
              {Array.from({ length: 25 }).map((_, tile) => {
                const isRevealed = revealed.has(tile);
                const isMine = mineTiles.has(tile);
                const isHit = view?.hitTile === tile;
                const clickable = active && !busy && !isRevealed;
                return (
                  <button
                    key={tile}
                    type="button"
                    disabled={!clickable}
                    onClick={() => void reveal(tile)}
                    className={cn(
                      'relative aspect-square rounded-lg border text-center transition-all duration-200 sm:rounded-xl',
                      !view && 'border-line bg-surface-2 hover:border-line-strong',
                      active && !isRevealed && 'border-line bg-surface-2 hover:-translate-y-0.5 hover:border-gold/40 hover:bg-surface-3',
                      isRevealed && 'border-success/30 bg-success/10',
                      ended && isMine && !isHit && 'border-danger/30 bg-danger/8',
                      isHit && 'border-danger/60 bg-danger/20',
                      ended && !isMine && !isRevealed && 'border-line/60 bg-surface-1 opacity-45',
                    )}
                    aria-label={`Tile ${tile + 1}`}
                  >
                    {isRevealed ? (
                      <Gem className="mx-auto h-5 w-5 text-success" />
                    ) : isHit ? (
                      <Bomb className="mx-auto h-5 w-5 text-danger" />
                    ) : ended && isMine ? (
                      <Bomb className="mx-auto h-5 w-5 text-danger/70" />
                    ) : (
                      <ShieldQuestion
                        className={cn(
                          'mx-auto h-4 w-4 transition-colors',
                          active ? 'text-faint group-hover:text-gold' : 'text-line-strong',
                        )}
                      />
                    )}
                    {isRevealed && (
                      <span className="absolute inset-x-0 bottom-1 text-[8px] font-medium uppercase tracking-wider text-success/70">
                        safe
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-faint">
              <span>Server-seeded mine layout · {multiplier(view?.multiplier ?? 1)} current</span>
              <span>{active ? 'Pick any hidden tile' : ended ? 'Start a new round to play again' : 'Set mines and buy a grid'}</span>
            </div>
          </div>
        </BoardCard>
      }
      aside={
        <>
          <SidePanel>
            <BalanceRow />
            <WagerField
              value={bet}
              onChange={setBet}
              min={game.minBet}
              max={game.maxBet}
              balance={balance}
              disabled={active || busy}
            />
            <Stepper
              value={Math.min(mineCount, maxMines)}
              onChange={(value) => setMineCount(Math.min(maxMines, Math.max(1, value)))}
              min={1}
              max={maxMines}
              disabled={active || busy}
              label="Mines in grid"
            />
            {active && view ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-line bg-surface-2/60 p-3 text-[11.5px]">
                  <div className="flex justify-between">
                    <span className="text-muted">Current multiplier</span>
                    <span className="font-display font-semibold text-gold">{multiplier(view.multiplier)}</span>
                  </div>
                  <div className="mt-1.5 flex justify-between">
                    <span className="text-muted">Next safe tile</span>
                    <span className="font-medium text-ink">{view.nextMultiplier ? multiplier(view.nextMultiplier) : '—'}</span>
                  </div>
                  <div className="mt-1.5 flex justify-between">
                    <span className="text-muted">Potential cash-out</span>
                    <span className="font-medium text-success tnum">{money(view.potential)} money</span>
                  </div>
                  <div className="mt-1.5 flex justify-between">
                    <span className="text-muted">Safe tiles left</span>
                    <span className="font-medium text-ink tnum">{25 - view.mines - view.revealed.length}</span>
                  </div>
                </div>
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  loading={busy}
                  disabled={view.revealed.length === 0}
                  onClick={() => void cashout()}
                >
                  Cash out {view.revealed.length > 0 ? `${money(view.potential)} money` : ''}
                </Button>
                {view.revealed.length === 0 && (
                  <p className="text-center text-[11px] text-faint">Reveal one safe tile to unlock cash-out.</p>
                )}
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-line bg-surface-2/60 p-3 text-[11.5px]">
                  <div className="flex justify-between">
                    <span className="text-muted">Max mines</span>
                    <span className="font-medium text-ink tnum">{maxMines}</span>
                  </div>
                  <div className="mt-1.5 flex justify-between">
                    <span className="text-muted">Grid</span>
                    <span className="font-medium text-ink">5 × 5</span>
                  </div>
                  <div className="mt-1.5 flex justify-between">
                    <span className="text-muted">First safe tile</span>
                    <span className="font-medium text-gold">{multiplier(firstPickMultiplier)}</span>
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
                    onClick={() => void start()}
                    disabled={bet < game.minBet || bet > game.maxBet || bet > balance || mineCount > maxMines}
                    leftIcon={<Sparkles className="h-4 w-4" />}
                  >
                    Buy grid · {money(bet)} money
                  </Button>
                )}
                {ended && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                    onClick={() => setView(null)}
                  >
                    Reset grid
                  </Button>
                )}
              </>
            )}
            {actionError && (
              <Alert tone="error" title="Round error">
                {actionError}
              </Alert>
            )}
          </SidePanel>
          <Card className="p-3.5">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-faint">Payout note</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              Multipliers include a house edge and increase with every safe pick. Cashing out money the balance
              atomically and closes the round — a second request cannot pay twice.
            </p>
          </Card>
        </>
      }
    />
  );
}
