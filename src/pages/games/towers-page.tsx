import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Lock, RotateCcw, Sparkles, TriangleAlert } from 'lucide-react';
import type { TowersView } from '../../../shared/types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { errorMessage, requestId } from '../../lib/api';
import { acknowledgeRound, gameAction, playGame } from '../../lib/games';
import { useRestoreActiveRound } from '../../lib/useActiveRound';
import { TABLE_REVEAL_MS, useRoundBalance } from '../../lib/useRoundBalance';
import { money, multiplier } from '../../lib/format';
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

export function TowersPage() {
  const { game, loading, error, refetch, maintenance, maxPayout } = useGameConfig('towers');
  const { user } = useAuth();
  const { hold, reveal, release } = useRoundBalance();
  const { error: toastError, success } = useToast();
  const [bet, setBet] = useState(100);
  const [view, setView] = useState<TowersView | null>(null);
  const [busy, setBusy] = useState(false);
  const [resultRevealed, setResultRevealed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (game && !initialized.current) {
      initialized.current = true;
      setBet(Math.max(game.minBet, Math.min(100, game.maxBet)));
    }
  }, [game]);

  useRestoreActiveRound(game?.slug, (round) => {
    const restored = round.view as TowersView;
    setBet(restored.session.bet);
    setView(restored);
    setResultRevealed(restored.session.status !== 'active');
    reveal(restored.balance);
    if (restored.session.status !== 'active') void acknowledgeRound(restored.session.id);
  });

  if (loading) return <GameSkeleton />;
  if (error || !game) return <GameError message={error ?? 'Game unavailable.'} onRetry={refetch} />;

  const levels = typeof game.config.levels === 'number' ? game.config.levels : 9;
  const balance = user?.balance ?? 0;
  const active = view?.session.status === 'active';
  const ended = Boolean(view && view.session.status !== 'active');
  const won = view?.session.status === 'won';

  const start = async () => {
    setActionError(null);
    setBusy(true);
    setResultRevealed(false);
    hold();
    try {
      const response = await playGame<TowersView>(game.slug, { requestId: requestId(), bet });
      setView(response);
      reveal(response.balance, { delay: TABLE_REVEAL_MS });
    } catch (err) {
      release();
      setActionError(errorMessage(err));
      toastError('Could not start the climb', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const revealTile = async (tile: number) => {
    if (!view || !active || busy) return;
    setActionError(null);
    setBusy(true);
    setResultRevealed(false);
    hold();
    try {
      const response = await gameAction<TowersView>(view.session.id, {
        action: 'reveal',
        tile,
        requestId: requestId(),
      });
      const ended = response.session.status !== 'active';
      setView(response);
      reveal(response.balance, {
        delay: TABLE_REVEAL_MS,
        onRevealed: () => {
          if (!ended) return;
          setResultRevealed(true);
          if (response.session.status === 'won') success('Tower cleared', `${money(response.session.payout)} money paid out.`);
          else toastError('A trap on that floor', 'The climb ends here. Start a new ascent.');
        },
      });
    } catch (err) {
      release();
      setActionError(errorMessage(err));
      toastError('Reveal failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const cashout = async () => {
    if (!view || !active || busy || view.level === 0) return;
    setActionError(null);
    setBusy(true);
    setResultRevealed(false);
    hold();
    try {
      const response = await gameAction<TowersView>(view.session.id, {
        action: 'cashout',
        requestId: requestId(),
      });
      setView(response);
      reveal(response.balance, {
        delay: TABLE_REVEAL_MS,
        onRevealed: () => {
          setResultRevealed(true);
          success('Cashed out', `${money(response.session.payout)} money returned.`);
        },
      });
    } catch (err) {
      release();
      setActionError(errorMessage(err));
      toastError('Cash-out failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const rows = Array.from({ length: levels }, (_, index) => levels - 1 - index);
  const current = view?.level ?? 0;

  return (
    <GameLayout
      game={game}
      maintenance={maintenance}
      maxPayout={maxPayout}
      rules={
        <>
          <p>Every floor has three doors and one trap. Pick a safe door to climb; the multiplier grows with each floor.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Choose one of three tiles per floor. A trap ends the round immediately.</li>
            <li>Cash out after any completed floor to keep the current potential payout.</li>
            <li>Reach the top to settle automatically at the maximum multiplier.</li>
            <li>The trap layout is generated server-side before the first pick.</li>
          </ul>
        </>
      }
      board={
        <BoardCard
          label={
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-faint">The tower</span>
              <Badge tone="info">{levels} floors</Badge>
              {active && <Badge tone="gold" dot>Climbing</Badge>}
            </div>
          }
        >
          <div className="space-y-4">
            {ended && view && resultRevealed && (
              <ResultBanner
                tone={won ? 'win' : 'lose'}
                title={won ? (view.level === levels ? 'Top floor reached!' : 'You cashed out safely.') : 'A trap caught you.'}
                detail={
                  won
                    ? `${view.level} floors · ${multiplier(view.multiplier)} final multiplier`
                    : `Fell on floor ${view.level + 1} after clearing ${view.level}.`
                }
                extra={
                  <span className={cn('font-display text-lg font-semibold tnum', won ? 'text-success' : 'text-muted')}>
                    {won ? `+${money(view.session.payout)}` : '0'} <span className="text-[9px] uppercase">money</span>
                  </span>
                }
              />
            )}
            <div className="mx-auto flex w-full max-w-[430px] flex-col gap-1.5">
              {rows.map((floor) => {
                const completed = Boolean(view && floor < view.level);
                const isCurrent = Boolean(active && floor === view.level);
                const failed = Boolean(ended && !won && view && floor === view.level);
                const future = Boolean(view && floor > view.level) || !view;
                const chosen = view?.revealed[floor];
                return (
                  <div
                    key={floor}
                    className={cn(
                      'flex items-center gap-2.5 rounded-xl border p-1.5 pl-2.5 transition-colors',
                      isCurrent && 'border-gold/35 bg-gold/5',
                      failed && 'border-danger/35 bg-danger/5',
                      completed && 'border-success/20 bg-success/4',
                      future && 'border-line/70 bg-surface-1',
                    )}
                  >
                    <div className="w-12 shrink-0">
                      <p className="text-[9px] uppercase tracking-[0.1em] text-faint">Floor</p>
                      <p className="font-display text-[13px] font-semibold text-ink tnum">{floor + 1}</p>
                    </div>
                    <div className="grid flex-1 grid-cols-3 gap-1.5">
                      {[0, 1, 2].map((tile) => {
                        const isChosen = completed && chosen === tile;
                        const isTrap = (failed || (ended && !won)) && view?.trapTile === tile && floor === view.level;
                        return (
                          <button
                            key={tile}
                            type="button"
                            disabled={!isCurrent || busy}
                            onClick={() => void revealTile(tile)}
                            className={cn(
                              'relative flex h-9 items-center justify-center rounded-lg border text-[10px] transition-all',
                              isCurrent && 'border-line-strong bg-surface-2 hover:-translate-y-0.5 hover:border-gold/50 hover:bg-surface-3',
                              isChosen && 'border-success/40 bg-success/10 text-success',
                              isTrap && 'border-danger/50 bg-danger/15 text-danger',
                              !isCurrent && !isChosen && !isTrap && 'border-line/60 bg-surface-1 text-faint',
                            )}
                            aria-label={`Floor ${floor + 1}, tile ${tile + 1}`}
                          >
                            {isChosen ? (
                              <Check className="h-4 w-4" />
                            ) : isTrap ? (
                              <TriangleAlert className="h-4 w-4" />
                            ) : isCurrent ? (
                              <Sparkles className="h-3.5 w-3.5 text-gold/70" />
                            ) : (
                              <Lock className="h-3 w-3 text-line-strong" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <div className="w-10 shrink-0 text-right">
                      {floor < current ? (
                        <span className="text-[10px] font-medium text-success">Clear</span>
                      ) : floor === current && active ? (
                        <span className="text-[9px] font-medium uppercase tracking-wider text-gold">Pick</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-center text-[10.5px] text-faint">
              One trap per floor. Safe picks are locked in; the ascent ends when you cash out, reach the top, or meet a trap.
            </p>
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
            {active && view ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-line bg-surface-2/60 p-3 text-[11.5px]">
                  <div className="flex justify-between">
                    <span className="text-muted">Floor reached</span>
                    <span className="font-medium text-ink tnum">{view.level} / {levels}</span>
                  </div>
                  <div className="mt-1.5 flex justify-between">
                    <span className="text-muted">Current multiplier</span>
                    <span className="font-display font-semibold text-gold">{multiplier(view.multiplier)}</span>
                  </div>
                  <div className="mt-1.5 flex justify-between">
                    <span className="text-muted">Next floor</span>
                    <span className="font-medium text-ink">{multiplier(view.nextMultiplier)}</span>
                  </div>
                  <div className="mt-1.5 flex justify-between">
                    <span className="text-muted">Cash-out value</span>
                    <span className="font-medium text-success tnum">{money(view.potential)} money</span>
                  </div>
                </div>
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  loading={busy}
                  disabled={view.level === 0}
                  onClick={() => void cashout()}
                >
                  Cash out {view.level > 0 ? `${money(view.potential)} money` : ''}
                </Button>
                <p className="text-center text-[11px] text-faint">
                  {view.level === 0 ? 'Clear one floor to unlock a cash-out.' : `Pick a door on floor ${view.level + 1}.`}
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-line bg-surface-2/60 p-3 text-[11.5px]">
                  <div className="flex justify-between">
                    <span className="text-muted">Floors</span>
                    <span className="font-medium text-ink tnum">{levels}</span>
                  </div>
                  <div className="mt-1.5 flex justify-between">
                    <span className="text-muted">Trap per floor</span>
                    <span className="font-medium text-ink">1 of 3</span>
                  </div>
                  <div className="mt-1.5 flex justify-between">
                    <span className="text-muted">First floor pays</span>
                    <span className="font-medium text-gold">~1.45×</span>
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
                    disabled={bet < game.minBet || bet > game.maxBet || bet > balance}
                    leftIcon={<Sparkles className="h-4 w-4" />}
                  >
                    Start the climb
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
                    Reset tower
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
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-faint">Bankroll discipline</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              Higher floors multiply the payout but each step carries the same trap risk. Cash-out is final and
              idempotent, so an accidental double click cannot withdraw twice.
            </p>
          </Card>
        </>
      }
    />
  );
}
