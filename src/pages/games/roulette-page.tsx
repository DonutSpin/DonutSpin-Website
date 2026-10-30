import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleDot, RotateCcw, Trash2 } from 'lucide-react';
import type { RouletteBet, RouletteView } from '../../../shared/types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { api, errorMessage, requestId } from '../../lib/api';
import { acknowledgeRound, playGame, sleep } from '../../lib/games';
import { useRestoreActiveRound } from '../../lib/useActiveRound';
import { money } from '../../lib/format';
import { compactAmount, parseAmount } from '../../lib/amount';
import {
  BalanceRow,
  BoardCard,
  GameError,
  GameLayout,
  GameSkeleton,
  ResultBanner,
  SidePanel,
  useGameConfig,
} from '../../components/game';
import { Alert, AmountInput, Badge, Button, Card, cn } from '../../components/ui';

type Color = 'red' | 'black' | 'green';

const OUTSIDE_BETS: { type: RouletteBet['type']; label: string }[] = [
  { type: 'red', label: 'Red' },
  { type: 'black', label: 'Black' },
  { type: 'odd', label: 'Odd' },
  { type: 'even', label: 'Even' },
  { type: 'low', label: '1–18' },
  { type: 'high', label: '19–36' },
  { type: 'dozen1', label: '1st 12' },
  { type: 'dozen2', label: '2nd 12' },
  { type: 'dozen3', label: '3rd 12' },
  { type: 'column1', label: 'Col 1' },
  { type: 'column2', label: 'Col 2' },
  { type: 'column3', label: 'Col 3' },
];

const CHIP_VALUES = [1, 5, 10, 25, 100, 500, 1_000];
const DEFAULT_CHIP_VALUE = 10;
const MAX_CHIP_VALUE = 1_000_000_000_000;

/** Real European single-zero wheel order, clockwise from 0 at the top. */
const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18,
  29, 7, 28, 12, 35, 3, 26,
];
const POCKET_ANGLE = 360 / WHEEL_ORDER.length;
const SPIN_MS = 4000;

const POCKET_COLOR: Record<Color, string> = {
  red: '#a52a33',
  black: '#15181f',
  green: '#1f7a4d',
};

/** Advance the ball by whole turns so it settles exactly on the winning pocket. */
function landingRotation(winningNumber: number, current: number): number {
  const pocketIndex = Math.max(0, WHEEL_ORDER.indexOf(winningNumber));
  const targetAngle = pocketIndex * POCKET_ANGLE + POCKET_ANGLE / 2;
  const normalized = ((current % 360) + 360) % 360;
  const delta = (targetAngle - normalized + 360) % 360;
  return current + 360 * 3 + delta;
}

export function RoulettePage() {
  const { game, loading, error, refetch, maintenance, maxPayout } = useGameConfig('roulette');
  const { user, updateBalance } = useAuth();
  const { error: toastError } = useToast();
  const [chipValue, setChipValue] = useState(DEFAULT_CHIP_VALUE);
  const [customChip, setCustomChip] = useState<number | ''>(DEFAULT_CHIP_VALUE);
  const [chipError, setChipError] = useState<string | null>(null);
  const [bets, setBets] = useState<RouletteBet[]>([]);
  const [view, setView] = useState<RouletteView | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ballRotation, setBallRotation] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .get<{ chipValue: number }>('/games/roulette/preferences')
      .then((preference) => {
        if (!live || !Number.isInteger(preference.chipValue) || preference.chipValue < 1) return;
        setChipValue(preference.chipValue);
        setCustomChip(preference.chipValue);
      })
      .catch(() => {
        /* The default chip value is usable if preferences cannot be loaded. */
      });
    return () => {
      live = false;
    };
  }, []);

  const redNumbers = useMemo(() => {
    const raw = game?.config.redNumbers;
    return new Set(Array.isArray(raw) ? (raw as number[]) : [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  }, [game]);

  const maxBets = typeof game?.config.maxBetsPerSpin === 'number' ? (game.config.maxBetsPerSpin as number) : 10;
  const balance = user?.balance ?? 0;
  const totalChips = bets.reduce((sum, bet) => sum + bet.chips, 0);
  const totalStake = totalChips * chipValue;

  // The server settles roulette immediately; restore that spin if the player
  // reloads or navigates back before the animation has finished.
  useRestoreActiveRound(game?.slug, (round) => {
    const restored = round.view as RouletteView;
    const restoredChipValue = restored.chipValue ?? 1;
    setBets(restored.bets);
    setChipValue(restoredChipValue);
    setCustomChip(restoredChipValue);
    setBallRotation((current) => landingRotation(restored.winningNumber, current));
    setView(restored);
    updateBalance(restored.balance);
    void acknowledgeRound(restored.session.id);
  });

  if (loading) return <GameSkeleton />;
  if (error || !game) return <GameError message={error ?? 'Game unavailable.'} onRetry={refetch} />;

  const colorOf = (n: number): Color => (n === 0 ? 'green' : redNumbers.has(n) ? 'red' : 'black');
  const maxChipValue = Math.max(1, Math.min(MAX_CHIP_VALUE, game.maxBet));

  const applyChipValue = (value: number) => {
    if (busy) return;
    if (!Number.isSafeInteger(value) || value < 1 || value > maxChipValue) {
      setChipError(`Choose a whole chip value between 1 and ${money(maxChipValue)} money.`);
      return;
    }
    setChipError(null);
    if (value === chipValue) return;
    setChipValue(value);
    setCustomChip(value);
    // Existing bets were priced at the old chip value, so switching clears the
    // felt. Every new chip then costs exactly the selected value.
    setBets([]);
    setView(null);
    setActionError(null);
    void api
      .put('/games/roulette/preferences', { chipValue: value })
      .catch((err: unknown) => toastError('Could not save chip value', errorMessage(err)));
  };

  const commitCustomChip = (value: number | '' = customChip) => {
    if (value === '') {
      setChipError('Enter a chip value first.');
      return;
    }
    applyChipValue(value);
  };

  const addBet = (type: RouletteBet['type'], number?: number) => {
    if (busy) return;
    setView(null);
    const existingIndex = bets.findIndex((bet) => bet.type === type && bet.number === number);
    if (existingIndex === -1 && bets.length >= maxBets) {
      toastError('Table limit reached', `You can place at most ${maxBets} bets per spin.`);
      return;
    }
    if (existingIndex >= 0) {
      setBets((current) =>
        current.map((bet, index) => {
          if (index !== existingIndex) return bet;
          const chips = bet.chips + 1;
          return { ...bet, chips, amount: chips * chipValue };
        }),
      );
    } else {
      setBets((current) => [
        ...current,
        { type, ...(type === 'straight' ? { number } : {}), chips: 1, amount: chipValue },
      ]);
    }
  };

  const removeBet = (index: number) => {
    if (busy) return;
    setView(null);
    setBets((current) => current.filter((_, i) => i !== index));
  };

  const clear = () => {
    if (busy) return;
    setBets([]);
    setView(null);
  };

  const spin = async () => {
    if (busy || bets.length === 0) return;
    if (totalStake < game.minBet) {
      setActionError(`Minimum total stake is ${money(game.minBet)} money.`);
      return;
    }
    if (totalStake > game.maxBet) {
      setActionError(`Maximum total stake is ${money(game.maxBet)} money.`);
      return;
    }
    if (totalStake > balance) {
      setActionError('Not enough DonutSMP money for this stake.');
      return;
    }
    setActionError(null);
    setBusy(true);
    setView(null);
    try {
      const response = await playGame<RouletteView>(game.slug, {
        requestId: requestId(),
        bet: totalStake,
        chipValue,
        bets: bets.map(({ type, number: betNumber, chips }) => ({
          type,
          ...(betNumber === undefined ? {} : { number: betNumber }),
          chips,
        })),
      });
      // The server already settled this spin. Derive the landing angle only from
      // that result; the static wheel and the ball can never disagree with it.
      setBallRotation((current) => landingRotation(response.winningNumber, current));
      updateBalance(response.balance);
      await sleep(SPIN_MS + 120);
      setView(response);
      void acknowledgeRound(response.session.id);
    } catch (err) {
      setActionError(errorMessage(err));
      toastError('Spin failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const winningNumber = view?.winningNumber;
  const straightChips = (n: number) =>
    bets.filter((bet) => bet.type === 'straight' && bet.number === n).reduce((sum, bet) => sum + bet.chips, 0);
  const outsideChips = (type: RouletteBet['type']) =>
    bets.filter((bet) => bet.type === type).reduce((sum, bet) => sum + bet.chips, 0);

  const betLabel = (bet: RouletteBet) => {
    if (bet.type === 'straight') return `Straight ${bet.number}`;
    return OUTSIDE_BETS.find((entry) => entry.type === bet.type)?.label ?? bet.type;
  };

  return (
    <GameLayout
      game={game}
      maintenance={maintenance}
      maxPayout={maxPayout}
      rules={
        <>
          <p>European single-zero wheel (0–36). Place one or more bets, then spin.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Every chip you place costs exactly the chip value you selected.</li>
            <li>Payout multiples apply to the chip value, so the odds never change.</li>
            <li>Straight number pays 35:1 (36× returned).</li>
            <li>Red/black, odd/even, and low/high pay 1:1 (2× returned).</li>
            <li>Dozens and columns pay 2:1 (3× returned).</li>
            <li>Zero wins only straight bets on 0. All outside bets lose when the ball lands on zero.</li>
          </ul>
        </>
      }
      board={
        <BoardCard
          label={
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-faint">The wheel</span>
              <Badge tone="neutral">European</Badge>
              {busy && <Badge tone="gold" dot>No more bets</Badge>}
            </div>
          }
        >
          <div className="flex flex-col items-center gap-5">
            <div className="roulette-stage">
              <div
                className="roulette-wheel"
                role="img"
                aria-label="European roulette wheel"
                style={{
                  background: `conic-gradient(from 0deg, ${WHEEL_ORDER.map((value, index) => {
                    const start = (index * POCKET_ANGLE).toFixed(3);
                    const end = ((index + 1) * POCKET_ANGLE).toFixed(3);
                    return `${POCKET_COLOR[colorOf(value)]} ${start}deg ${end}deg`;
                  }).join(', ')})`,
                }}
              >
                {WHEEL_ORDER.map((value, index) => {
                  const angle = index * POCKET_ANGLE + POCKET_ANGLE / 2;
                  return (
                    <div
                      key={value}
                      className="roulette-number-slot"
                      style={{ transform: `rotate(${angle}deg)` }}
                    >
                      <span
                        className={cn('roulette-number', winningNumber === value && 'roulette-number-hit')}
                        style={{ transform: `rotate(${-angle}deg)` }}
                      >
                        {value}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div
                className="roulette-ball-rotor"
                style={{ transform: `rotate(${ballRotation}deg)` }}
                aria-hidden
              >
                <span className="roulette-ball" />
              </div>
              <div className="absolute inset-0 z-10 grid place-items-center">
                <div className="grid h-20 w-20 place-items-center rounded-full border border-gold/30 bg-surface-1/95 shadow-xl">
                  {winningNumber !== undefined ? (
                    <div className="text-center">
                      <p
                        className={cn(
                          'font-display text-2xl font-bold leading-none',
                          colorOf(winningNumber) === 'red'
                            ? 'text-danger'
                            : colorOf(winningNumber) === 'green'
                              ? 'text-success'
                              : 'text-ink',
                        )}
                      >
                        {winningNumber}
                      </p>
                      <p className="mt-1 text-[8px] uppercase tracking-[0.18em] text-faint">{colorOf(winningNumber)}</p>
                    </div>
                  ) : (
                    <CircleDot className="h-6 w-6 text-gold/60" />
                  )}
                </div>
              </div>
            </div>

            {busy ? (
              <p className="text-[11.5px] text-muted">The ball is spinning…</p>
            ) : view ? (
              <div className="w-full max-w-xl">
                <ResultBanner
                  tone={view.totalPayout > 0 ? 'win' : 'lose'}
                  title={
                    view.totalPayout > 0
                      ? `${view.winningNumber} ${view.color} — you won`
                      : `${view.winningNumber} ${view.color} — no winning bets`
                  }
                  detail={`${money(view.session.bet)} money staked across ${view.bets.length} bet${view.bets.length === 1 ? '' : 's'} at ${money(view.chipValue)} per chip`}
                  extra={
                    <span className={cn('font-display text-lg font-semibold tnum', view.totalPayout > 0 ? 'text-success' : 'text-muted')}>
                      {view.totalPayout > 0 ? `+${money(view.totalPayout)}` : '0'} <span className="text-[9px] uppercase">money</span>
                    </span>
                  }
                />
              </div>
            ) : (
              <p className="text-[11.5px] text-faint">Place chips on the table, then spin.</p>
            )}

            <div className="w-full overflow-x-auto pb-1">
              <div className="mx-auto min-w-[620px] max-w-3xl">
                <div className="grid grid-cols-[44px_repeat(12,minmax(0,1fr))_44px] gap-1">
                  <button
                    type="button"
                    onClick={() => addBet('straight', 0)}
                    disabled={busy}
                    className={cn(
                      'row-span-3 rounded-lg border text-sm font-semibold transition-all',
                      colorOf(0) === 'green' && 'border-success/40 bg-success/20 text-success hover:bg-success/30',
                      winningNumber === 0 && 'ring-2 ring-gold ring-offset-1 ring-offset-surface-1',
                    )}
                  >
                    0
                    {straightChips(0) > 0 && <span className="mx-auto mt-1 block h-1.5 w-1.5 rounded-full bg-gold" />}
                  </button>
                  {[3, 2, 1].map((rowOffset) => {
                    const columnBet = rowOffset === 3 ? 'column3' : rowOffset === 2 ? 'column2' : 'column1';
                    const columnNumber = rowOffset === 3 ? 3 : rowOffset === 2 ? 2 : 1;
                    return (
                      <Fragment key={rowOffset}>
                        {Array.from({ length: 12 }).map((_, col) => {
                          const value = col * 3 + rowOffset;
                          const color = colorOf(value);
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => addBet('straight', value)}
                              disabled={busy}
                              className={cn(
                                'relative h-9 rounded-md border text-[11.5px] font-semibold transition-all hover:brightness-125 sm:h-10 sm:text-[12.5px]',
                                color === 'red'
                                  ? 'border-[#c9424b]/50 bg-[#a52a33] text-white'
                                  : 'border-[#2b303b] bg-[#15181f] text-ink',
                                winningNumber === value && 'ring-2 ring-gold ring-offset-1 ring-offset-surface-1',
                              )}
                            >
                              {value}
                              {straightChips(value) > 0 && (
                                <span className="absolute -right-1 -top-1 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-gold px-0.5 text-[8px] font-bold text-[#1a1408]">
                                  ×{straightChips(value)}
                                </span>
                              )}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => addBet(columnBet)}
                          disabled={busy}
                          title={`Bet on column ${columnNumber}`}
                          className={cn(
                            'relative h-9 rounded-md border border-line bg-surface-2 text-[9px] font-medium text-faint transition-colors hover:text-gold sm:h-10',
                            outsideChips(columnBet) > 0 && 'border-gold/50 text-gold',
                          )}
                        >
                          2:1
                          {outsideChips(columnBet) > 0 && (
                            <span className="absolute -right-1 -top-1 rounded-full bg-gold px-1 text-[8px] font-bold text-[#1a1408]">
                              ×{outsideChips(columnBet)}
                            </span>
                          )}
                        </button>
                      </Fragment>
                    );
                  })}
                </div>

                <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                  {OUTSIDE_BETS.slice(0, 6).map((entry) => (
                    <button
                      key={entry.type}
                      type="button"
                      onClick={() => addBet(entry.type)}
                      disabled={busy}
                      className={cn(
                        'relative h-9 rounded-lg border text-[10.5px] font-medium transition-all hover:border-gold/35',
                        entry.type === 'red' && 'border-[#c9424b]/40 bg-[#a52a33]/35 text-[#ffb3b8]',
                        entry.type === 'black' && 'border-line-strong bg-[#12151b] text-muted',
                        !['red', 'black'].includes(entry.type) && 'border-line bg-surface-2 text-muted',
                        outsideChips(entry.type) > 0 && 'border-gold/50 text-gold',
                      )}
                    >
                      {entry.label}
                      {outsideChips(entry.type) > 0 && (
                        <span className="absolute -right-1 -top-1 rounded-full bg-gold px-1 text-[8px] font-bold text-[#1a1408]">
                          ×{outsideChips(entry.type)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                  {OUTSIDE_BETS.slice(6, 9).map((entry) => (
                    <button
                      key={entry.type}
                      type="button"
                      onClick={() => addBet(entry.type)}
                      disabled={busy}
                      className={cn(
                        'relative h-9 rounded-lg border border-line bg-surface-2 text-[10.5px] font-medium text-muted transition-all hover:border-gold/35',
                        outsideChips(entry.type) > 0 && 'border-gold/50 text-gold',
                      )}
                    >
                      {entry.label}
                      {outsideChips(entry.type) > 0 && (
                        <span className="absolute -right-1 -top-1 rounded-full bg-gold px-1 text-[8px] font-bold text-[#1a1408]">
                          ×{outsideChips(entry.type)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="w-full max-w-xl">
              {bets.length === 0 ? (
                <p className="text-center text-[11px] text-faint">
                  No chips placed. Pick a chip value and tap a spot on the felt.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {bets.map((bet, index) => (
                    <button
                      key={`${bet.type}-${bet.number ?? ''}-${index}`}
                      type="button"
                      onClick={() => removeBet(index)}
                      disabled={busy}
                      title="Remove bet"
                      className="group flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/8 py-1 pl-2.5 pr-1.5 text-[10.5px] text-gold transition-colors hover:border-danger/40 hover:text-danger"
                    >
                      {betLabel(bet)}
                      <span className="rounded-full bg-surface-1/60 px-1.5 py-0.5 font-semibold tnum">
                        {bet.chips} × {money(chipValue)}
                      </span>
                      <Trash2 className="h-2.5 w-2.5 opacity-50 group-hover:opacity-100" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </BoardCard>
      }
      aside={
        <>
          <SidePanel>
            <BalanceRow />
            <div>
              <div className="flex items-center justify-between">
                <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted">Chip value</p>
                <button
                  type="button"
                  onClick={clear}
                  disabled={busy || bets.length === 0}
                  className="text-[10.5px] text-faint hover:text-danger disabled:opacity-40"
                >
                  Clear board
                </button>
              </div>
              <div className="mt-2 rounded-xl border border-gold/20 bg-gold/5 p-3">
                <div className="flex items-end justify-between gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-faint">1 chip =</span>
                  <span className="font-display text-[18px] font-semibold leading-none text-gold-bright tnum">
                    {money(chipValue)} <span className="text-[9px] uppercase tracking-wider text-gold-dim">money</span>
                  </span>
                </div>
                <div className="mt-2.5 grid grid-cols-4 gap-1.5">
                  {CHIP_VALUES.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => applyChipValue(value)}
                      disabled={busy || value > maxChipValue}
                      aria-pressed={chipValue === value}
                      className={cn(
                        'rounded-lg border py-1.5 text-[10.5px] font-semibold tnum transition-colors disabled:opacity-30',
                        chipValue === value
                          ? 'border-gold/50 bg-gold/15 text-gold'
                          : 'border-line bg-surface-2 text-muted hover:border-line-strong hover:text-ink',
                      )}
                    >
                      {compactAmount(value)}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex gap-1.5">
                  <AmountInput
                    value={customChip}
                    onChange={setCustomChip}
                    onInvalid={setChipError}
                    invalid={Boolean(chipError)}
                    disabled={busy}
                    placeholder="Custom value"
                    aria-label="Custom roulette chip value in money"
                    className="h-9 text-[12px]"
                    onBlur={(event) => {
                      const parsed = parseAmount(event.target.value);
                      if (parsed !== null) commitCustomChip(parsed);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitCustomChip();
                      }
                    }}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    disabled={busy || customChip === ''}
                    onClick={() => commitCustomChip()}
                  >
                    Set
                  </Button>
                </div>
                <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
                  Whole amounts from 1 to {money(maxChipValue)}. Changing the chip clears the felt.
                </p>
                {chipError && <p className="mt-1 text-[10.5px] text-danger">{chipError}</p>}
              </div>
            </div>
            <div className="rounded-xl border border-line bg-surface-2/60 p-3 text-[11.5px]">
              <div className="flex justify-between">
                <span className="text-muted">Total stake</span>
                <span className="font-display font-semibold text-gold tnum">{money(totalStake)} money</span>
              </div>
              <div className="mt-1.5 flex justify-between">
                <span className="text-muted">Chips on table</span>
                <span className="text-ink tnum">
                  {totalChips} <span className="text-faint">({bets.length}/{maxBets} spots)</span>
                </span>
              </div>
              <div className="mt-1.5 flex justify-between">
                <span className="text-muted">Spin cost</span>
                <span className="text-ink tnum">{totalChips} × {money(chipValue)}</span>
              </div>
              <div className="mt-1.5 flex justify-between">
                <span className="text-muted">Limits</span>
                <span className="text-ink tnum">{money(game.minBet)}–{money(game.maxBet)}</span>
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
                disabled={bets.length === 0 || totalStake < game.minBet || totalStake > game.maxBet || totalStake > balance}
                onClick={() => void spin()}
              >
                <CircleDot className="h-4 w-4" /> Spin the wheel
              </Button>
            )}
            {view && (
              <Button variant="ghost" size="sm" className="w-full" leftIcon={<RotateCcw className="h-3.5 w-3.5" />} onClick={clear}>
                Clear and bet again
              </Button>
            )}
            {actionError && (
              <Alert tone="error" title="Could not spin">
                {actionError}
              </Alert>
            )}
          </SidePanel>
          <Card className="p-3.5">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-faint">Payout table</p>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <span className="text-muted">Straight</span><span className="text-right text-ink">36×</span>
              <span className="text-muted">Red / black</span><span className="text-right text-ink">2×</span>
              <span className="text-muted">Odd / even</span><span className="text-right text-ink">2×</span>
              <span className="text-muted">Dozens</span><span className="text-right text-ink">3×</span>
              <span className="text-muted">Columns</span><span className="text-right text-ink">3×</span>
            </div>
          </Card>
        </>
      }
    />
  );
}
