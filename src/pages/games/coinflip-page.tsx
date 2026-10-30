import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Coins, Crown, Gem, RotateCcw, Sparkles, Volume2, VolumeX } from 'lucide-react';
import type { CoinflipView } from '../../../shared/types';
import { useAuth } from '../../context/AuthContext';
import { acknowledgeRound, playGame, type CoinflipView as CoinflipViewType } from '../../lib/games';
import { useRestoreActiveRound } from '../../lib/useActiveRound';
import { api, errorMessage, requestId } from '../../lib/api';
import { money } from '../../lib/format';
import { payoutFor } from '../../../shared/payout';
import { useToast } from '../../context/ToastContext';
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
import { Alert, Button, Card, Toggle, cn } from '../../components/ui';

const TOSS_MS = 3100;
/** Full turns added before landing, so the flip reads as a real toss. */
const TURNS = 4;
const COIN_EASING = 'cubic-bezier(0.16, 0.84, 0.18, 1)';
const SOUND_KEY = 'donutcash:coin-sound';
type CoinSide = 'heads' | 'tails';

/** Heads is the un-rotated face; tails is the back of the coin. */
function faceDegrees(side: CoinSide): number {
  return side === 'tails' ? 180 : 0;
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

/**
 * Absolute rotation angle whose visible face is `outcome`.
 *
 * The visible face is decided purely by the angle modulo 360, so the ending
 * angle is derived from the server result and nothing else. The angle always
 * advances forwards, so the coin keeps spinning the same way instead of
 * snapping backwards to reach a face.
 */
function landingDegrees(from: number, outcome: CoinSide): number {
  const current = normalizeDegrees(from);
  const raw = ((faceDegrees(outcome) - current) % 360 + 360) % 360;
  // A remaining angle under 45° would look like an abrupt snap on landing.
  const delta = raw < 45 ? raw + 360 : raw;
  return current + TURNS * 360 + delta;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function useCoinSound() {
  const [enabled, setEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(SOUND_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const contextRef = useRef<AudioContext | null>(null);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current) window.clearTimeout(timer);
      void contextRef.current?.close();
    };
  }, []);

  const toggle = (value: boolean) => {
    setEnabled(value);
    try {
      window.localStorage.setItem(SOUND_KEY, String(value));
    } catch {
      /* storage may be unavailable */
    }
  };

  const getContext = (): AudioContext | null => {
    if (!enabled) return null;
    try {
      if (!contextRef.current) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        contextRef.current = new Ctor();
      }
      if (contextRef.current.state === 'suspended') void contextRef.current.resume();
      return contextRef.current;
    } catch {
      return null;
    }
  };

  const playToss = useCallback(() => {
    const context = getContext();
    if (!context) return;
    const duration = 0.32;
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * duration), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      const decay = 1 - i / data.length;
      data[i] = (Math.random() * 2 - 1) * decay * 0.24;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1500, context.currentTime);
    filter.frequency.exponentialRampToValueAtTime(520, context.currentTime + duration);
    filter.Q.value = 0.9;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start();
  }, [enabled]);

  const playLanding = useCallback((won: boolean) => {
    const context = getContext();
    if (!context) return;
    const now = context.currentTime;
    const notes = won ? [659.25, 880, 1318.5] : [392, 261.63];
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = won ? 'sine' : 'triangle';
      oscillator.frequency.setValueAtTime(frequency, now + index * 0.075);
      gain.gain.setValueAtTime(0.0001, now + index * 0.075);
      gain.gain.exponentialRampToValueAtTime(won ? 0.1 : 0.07, now + index * 0.075 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.075 + (won ? 0.55 : 0.3));
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + index * 0.075);
      oscillator.stop(now + index * 0.075 + (won ? 0.6 : 0.34));
    });
    // A tiny metallic tick anchors the landing.
    const tick = context.createOscillator();
    const tickGain = context.createGain();
    tick.type = 'square';
    tick.frequency.setValueAtTime(2200, now);
    tickGain.gain.setValueAtTime(0.035, now);
    tickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    tick.connect(tickGain).connect(context.destination);
    tick.start(now);
    tick.stop(now + 0.05);
  }, [enabled]);

  return { enabled, toggle, playToss, playLanding };
}

function CoinFace({ side }: { side: 'heads' | 'tails' }) {
  const heads = side === 'heads';
  return (
    <div className={cn('coin-face', !heads && 'back')} aria-hidden>
      <div className="coin-ring" />
      <div className="coin-inner">
        <span className="coin-monogram">{heads ? 'H' : 'T'}</span>
        <span className="coin-label">{heads ? 'Heads' : 'Tails'}</span>
        <span className="coin-stars">✦ DONUTCASH ✦</span>
      </div>
      <div className="coin-glint" />
    </div>
  );
}

function Coin({
  outcome,
  tossing,
  landed,
  angle,
  animated,
}: {
  outcome: CoinSide | null;
  tossing: boolean;
  landed: boolean;
  angle: number;
  animated: boolean;
}) {
  return (
    <div
      className="coin-stage"
      data-tossing={tossing}
      data-outcome={outcome ?? 'ready'}
      role="img"
      aria-label={tossing ? 'Coin spinning' : outcome ? `Coin landed on ${outcome}` : 'Coin ready to flip'}
    >
      <div className="coin-spotlight" aria-hidden />
      <div className="coin-aura" aria-hidden />
      <div className="coin-floor" aria-hidden />
      <div className={cn('coin-impact', !tossing && outcome && 'is-active')} aria-hidden />
      <div className={cn('coin-float', landed && 'is-still')}>
        {/*
          The rotation is driven inline rather than by a CSS keyframe class so
          the angle the animation stops on is exactly the angle derived from the
          server outcome. `animation: none` stops any stylesheet keyframe from
          overriding the inline transform, and the element is never remounted,
          so the transition is not interrupted by a re-render.
        */}
        <div
          className={cn('coin', !tossing && landed && 'is-landed')}
          style={
            {
              transform: `rotateY(${angle}deg)`,
              transition: animated ? `transform ${TOSS_MS}ms ${COIN_EASING}` : 'none',
              animation: 'none',
              transformStyle: 'preserve-3d',
              willChange: animated ? 'transform' : undefined,
            } as CSSProperties
          }
        >
          <CoinFace side="heads" />
          <CoinFace side="tails" />
          <div className="coin-edge" aria-hidden>
            {Array.from({ length: 72 }).map((_, index) => (
              <span
                key={index}
                className="coin-edge-segment"
                style={{ '--i': index } as CSSProperties}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="absolute left-3 top-2 z-10 hidden rounded-full border border-line/80 bg-surface-1/80 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-faint backdrop-blur sm:block">
        50 / 50
      </div>
      <div className="absolute right-3 top-2 z-10 hidden rounded-full border border-gold/20 bg-gold/[0.06] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-gold-dim backdrop-blur sm:block">
        Provably fair
      </div>
    </div>
  );
}

function SideGlyph({ side }: { side: 'heads' | 'tails' }) {
  return (
    <span
      className={cn(
        'grid h-7 w-7 place-items-center rounded-full border font-display text-[11px] font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]',
        side === 'heads'
          ? 'border-[#f3d493] bg-gradient-to-br from-[#f9e7b6] to-[#c79a4c] text-[#5a3f13]'
          : 'border-[#c8d2df] bg-gradient-to-br from-[#f6f9fc] to-[#93a0b1] text-[#354150]',
      )}
      aria-hidden
    >
      {side === 'heads' ? 'H' : 'T'}
    </span>
  );
}

export function CoinflipPage() {
  const { game, loading, error, refetch, maintenance, maxPayout } = useGameConfig('coinflip');
  const { user, updateBalance } = useAuth();
  const { error: toastError } = useToast();
  const sound = useCoinSound();
  const [pick, setPick] = useState<'heads' | 'tails'>('heads');
  const [bet, setBet] = useState(100);
  const [view, setView] = useState<CoinflipViewType | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [coin, setCoin] = useState<{ angle: number; animated: boolean }>({ angle: 0, animated: false });
  const restAngleRef = useRef(0);
  const initialized = useRef(false);
  const timeoutRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (game && !initialized.current) {
      initialized.current = true;
      setBet(Math.max(game.minBet, Math.min(100, game.maxBet)));
    }
  }, [game]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, []);

  /**
   * Reveals a settled round. The final coin angle is derived from the server
   * outcome, so the face the coin stops on can never disagree with the payout.
   * `immediate` skips the spin for restored or reduced-motion rounds.
   */
  const showSettled = useCallback(
    (result: CoinflipViewType, immediate: boolean) => {
      const target = landingDegrees(restAngleRef.current, result.outcome);

      const finish = () => {
        const resting = normalizeDegrees(target);
        restAngleRef.current = resting;
        setCoin({ angle: resting, animated: false });
        setAnimating(false);
        setBusy(false);
        setRevealed(true);
        sound.playLanding(result.won);
        void acknowledgeRound(result.session.id);
      };

      if (immediate || reduced) {
        const resting = faceDegrees(result.outcome);
        restAngleRef.current = resting;
        setCoin({ angle: resting, animated: false });
        setAnimating(false);
        setBusy(false);
        setRevealed(true);
        sound.playLanding(result.won);
        void acknowledgeRound(result.session.id);
        return;
      }

      // Park the coin on its current face with transitions off, then start the
      // flip on the next painted frame so the change is actually animated.
      setRevealed(false);
      setCoin({ angle: restAngleRef.current, animated: false });
      setAnimating(true);
      sound.playToss();
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = window.requestAnimationFrame(() => {
          frameRef.current = null;
          setCoin({ angle: target, animated: true });
        });
      });
      timeoutRef.current = window.setTimeout(finish, TOSS_MS + 120);
    },
    [reduced, sound],
  );

  // A result can be settled before its animation finishes. Restore it after a
  // refresh or navigation so the player always sees the round they paid for.
  useRestoreActiveRound(game?.slug, (round) => {
    const restored = round.view as CoinflipViewType;
    setBet(restored.session.bet);
    setPick(restored.pick);
    setView(restored);
    updateBalance(restored.balance);
    // Already settled: show the true face immediately instead of replaying a
    // spin that could appear to decide a new result.
    showSettled(restored, true);
  });

  if (loading) return <GameSkeleton />;
  if (error || !game) return <GameError message={error ?? 'Game unavailable.'} onRetry={refetch} />;

  const winMultiplier = typeof game.config.winMultiplier === 'number' ? game.config.winMultiplier : 1.96;
  const balance = user?.balance ?? 0;
  // Same helper the server uses, so the shown return cannot drift from the
  // credited amount (including the platform payout ceiling).
  const potential = payoutFor(bet, winMultiplier, typeof maxPayout === 'number' ? maxPayout : undefined);

  const flip = async () => {
    if (busy) return;
    setActionError(null);
    setBusy(true);
    setAnimating(false);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    try {
      const response = await playGame<CoinflipView>(game.slug, {
        requestId: requestId(),
        bet,
        pick,
      });
      setView(response);
      updateBalance(response.balance);
      showSettled(response, false);
    } catch (err) {
      setBusy(false);
      setAnimating(false);
      setActionError(errorMessage(err));
      toastError('The coin could not be flipped', errorMessage(err));
    }
  };

  const outcome = view?.outcome ?? null;
  const tossing = Boolean(view && animating);
  const showResult = Boolean(view && revealed);
  const sideLabel = outcome ? outcome.charAt(0).toUpperCase() + outcome.slice(1) : null;

  return (
    <GameLayout
      game={game}
      maintenance={maintenance}
      maxPayout={maxPayout}
      rules={
        <>
          <p>Choose heads or tails, set your wager, and flip. The coin is flipped by the server using a secure random source.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>A correct call returns your wager multiplied by {winMultiplier.toFixed(2)}×.</li>
            <li>An incorrect call loses the wager.</li>
            <li>Every flip creates a game session and matching ledger entries.</li>
            <li>Coin sound can be enabled from the bet panel. Visual results always remain available.</li>
          </ul>
        </>
      }
      board={
        <BoardCard
          label={
            <div className="flex w-full items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-faint">The toss</span>
              <span className="flex items-center gap-1.5 rounded-full border border-line/80 bg-surface-2/70 px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint">
                <span className={cn('h-1.5 w-1.5 rounded-full', busy ? 'animate-pulse bg-gold' : 'bg-success')} />
                {busy ? (animating ? 'In the air' : 'Locking in') : showResult ? 'Settled' : 'Ready'}
              </span>
            </div>
          }
        >
          <div className="relative flex flex-col items-center justify-center gap-5 py-2">
            {showResult && view?.won && (
              <div className="pointer-events-none absolute inset-x-8 top-0 h-40" aria-hidden>
                {Array.from({ length: 16 }).map((_, index) => (
                  <span
                    key={index}
                    className="absolute top-0 h-1.5 w-1.5 rounded-[1px]"
                    style={{
                      left: `${6 + ((index * 37) % 88)}%`,
                      backgroundColor: ['#e6c27a', '#4dd6a0', '#f8e5b8', '#7cb8ff'][index % 4],
                      animation: `confetti-fall ${0.9 + (index % 5) * 0.12}s ease-in ${(index % 7) * 60}ms both`,
                    }}
                  />
                ))}
              </div>
            )}

            <Coin
              outcome={outcome}
              tossing={tossing}
              landed={showResult}
              angle={coin.angle}
              animated={coin.animated}
            />

            <div className="flex min-h-9 items-center justify-center">
              {busy && !showResult ? (
                <div className="flex items-center gap-2 rounded-full border border-gold/20 bg-gold/[0.06] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-gold">
                  <Coins className={cn('h-3.5 w-3.5', animating && 'animate-bounce')} />
                  {animating ? 'The coin is in the air…' : 'Locking in your flip…'}
                </div>
              ) : showResult && sideLabel ? (
                <div className={cn('coin-result', view?.won ? 'is-win' : 'is-lose')}>
                  {view?.won ? <Sparkles className="h-3.5 w-3.5" /> : <Coins className="h-3.5 w-3.5" />}
                  Landed on {sideLabel}
                </div>
              ) : (
                <p className="text-center text-[12px] text-muted">
                  Pick a side, set a wager, and send the coin spinning.
                </p>
              )}
            </div>

            <div className="w-full max-w-md" aria-live="polite">
              {showResult && view ? (
                <ResultBanner
                  tone={view.won ? 'win' : 'lose'}
                  title={view.won ? `Perfect call — ${view.outcome}.` : `It landed on ${view.outcome}.`}
                  detail={`Picked ${view.pick} · wager ${money(view.session.bet)} money`}
                  extra={
                    <span className={cn('font-display text-lg font-semibold tnum', view.won ? 'text-success' : 'text-muted')}>
                      {view.won ? `+${money(view.session.payout)}` : '0'}{' '}
                      <span className="text-[9px] uppercase tracking-wider">money</span>
                    </span>
                  }
                />
              ) : (
                <div className="rounded-xl border border-line/70 bg-surface-2/40 px-4 py-3 text-center text-[11px] leading-relaxed text-faint">
                  The result is settled securely before the animation. The coin always lands on the true outcome.
                </div>
              )}
            </div>

            {actionError && (
              <div className="w-full max-w-md">
                <Alert tone="error" title="Flip failed">
                  {actionError}
                </Alert>
              </div>
            )}
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
              disabled={busy}
            />
            <div>
              <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-faint">Your call</p>
              <div className="grid grid-cols-2 gap-2">
                {(['heads', 'tails'] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    disabled={busy}
                    onClick={() => setPick(side)}
                    className={cn(
                      'group flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-[12px] font-semibold capitalize transition-all duration-200 disabled:opacity-50',
                      pick === side
                        ? 'border-gold/50 bg-gradient-to-b from-gold/[0.14] to-gold/[0.04] text-gold-bright shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_20px_-16px_rgba(230,194,122,0.8)]'
                        : 'border-line bg-surface-2/70 text-muted hover:border-line-strong hover:bg-surface-2 hover:text-ink',
                    )}
                    aria-pressed={pick === side}
                  >
                    <SideGlyph side={side} />
                    {side}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-line/80 bg-surface-2/50">
              <div className="flex justify-between px-3 py-2.5 text-[11.5px]">
                <span className="text-muted">Return on win</span>
                <span className="font-semibold text-gold">{winMultiplier.toFixed(2)}×</span>
              </div>
              <div className="flex justify-between border-t border-line/60 bg-gold/[0.03] px-3 py-2.5 text-[11.5px]">
                <span className="text-muted">Potential payout</span>
                <span className="font-semibold text-ink tnum">{money(potential)} money</span>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-line/70 bg-surface-2/40 px-3 py-2.5">
              <span className="flex items-center gap-2 text-[11.5px] font-medium text-muted">
                {sound.enabled ? <Volume2 className="h-4 w-4 text-gold" /> : <VolumeX className="h-4 w-4 text-faint" />}
                Coin sound
              </span>
              <Toggle checked={sound.enabled} onChange={sound.toggle} label="Coin sound" />
            </div>
            {balance < game.minBet ? (
              <Alert tone="warning" title="No money to wager">
                You need at least {money(game.minBet)} money.{' '}
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
                onClick={() => void flip()}
                disabled={bet < game.minBet || bet > game.maxBet || bet > balance}
              >
                <Sparkles className="h-4 w-4" /> {busy ? 'Coin in flight' : 'Flip the coin'}
              </Button>
            )}
            {view && !busy && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                onClick={() => {
                  setView(null);
                  setRevealed(false);
                  setCoin({ angle: restAngleRef.current, animated: false });
                }}
              >
                Clear result
              </Button>
            )}
          </SidePanel>
          <Card className="p-4">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-faint">Fair play</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              The outcome is generated with a cryptographically secure random source. Losing rounds are ledgered too,
              and retries reuse an idempotent request key so nothing is deducted twice.
            </p>
          </Card>
        </>
      }
    />
  );
}

export { api, errorMessage };
