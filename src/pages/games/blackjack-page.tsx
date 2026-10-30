import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Hand, RotateCcw, Sparkles } from 'lucide-react';
import type { BlackjackView } from '../../../shared/types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { errorMessage, requestId } from '../../lib/api';
import { acknowledgeRound, gameAction, playGame } from '../../lib/games';
import { useRestoreActiveRound } from '../../lib/useActiveRound';
import { money } from '../../lib/format';
import {
  BalanceRow,
  BoardCard,
  GameError,
  GameLayout,
  GameSkeleton,
  PlayingCard,
  ResultBanner,
  SidePanel,
  WagerField,
  useGameConfig,
} from '../../components/game';
import { Alert, Badge, Button, Card, cn } from '../../components/ui';

export function BlackjackPage() {
  const { game, loading, error, refetch, maintenance, maxPayout } = useGameConfig('blackjack');
  const { user, updateBalance } = useAuth();
  const { error: toastError } = useToast();
  const [bet, setBet] = useState(100);
  const [view, setView] = useState<BlackjackView | null>(null);
  const [busy, setBusy] = useState<'deal' | 'hit' | 'stand' | 'double' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (game && !initialized.current) {
      initialized.current = true;
      setBet(Math.max(game.minBet, Math.min(100, game.maxBet)));
    }
  }, [game]);

  useRestoreActiveRound(game?.slug, (round) => {
    const restored = round.view as BlackjackView;
    setBet(restored.session.bet);
    setView(restored);
    updateBalance(restored.balance);
    if (restored.session.status !== 'active') void acknowledgeRound(restored.session.id);
  });

  if (loading) return <GameSkeleton />;
  if (error || !game) return <GameError message={error ?? 'Game unavailable.'} onRetry={refetch} />;

  const balance = user?.balance ?? 0;
  const active = view?.session.status === 'active';
  const ended = Boolean(view && view.session.status !== 'active');
  const blackjackPays = typeof game.config.blackjackPays === 'number' ? game.config.blackjackPays : 1.5;
  const allowDouble = game.config.allowDouble !== false;

  const deal = async () => {
    setActionError(null);
    setBusy('deal');
    try {
      const response = await playGame<BlackjackView>(game.slug, { requestId: requestId(), bet });
      setView(response);
      updateBalance(response.balance);
    } catch (err) {
      setActionError(errorMessage(err));
      toastError('Could not deal', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const act = async (action: 'hit' | 'stand' | 'double') => {
    if (!view || !active || busy) return;
    setActionError(null);
    setBusy(action);
    try {
      const response = await gameAction<BlackjackView>(view.session.id, { action, requestId: requestId() });
      setView(response);
      updateBalance(response.balance);
    } catch (err) {
      setActionError(errorMessage(err));
      toastError('Action failed', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const dealerLabel = active ? 'Showing one card' : 'Dealer';
  const resultTone = view?.session.status === 'won' ? 'win' : view?.session.status === 'push' ? 'neutral' : 'lose';

  return (
    <GameLayout
      game={game}
      maintenance={maintenance}
      maxPayout={maxPayout}
      rules={
        <>
          <p>A six-deck shoe, dealer stands on 17. Get closer to 21 than the dealer without going over.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Blackjack pays {(blackjackPays + 1).toFixed(1)}× your wager (stake plus {blackjackPays.toFixed(1)}:1).</li>
            <li>A regular win returns 2× your wager; a push returns your stake.</li>
            <li>Double down doubles the wager and draws exactly one card{allowDouble ? '' : ' (disabled at this table)'}.</li>
            <li>Split and insurance are not offered. Dealer stands on all 17s.</li>
          </ul>
        </>
      }
      board={
        <BoardCard
          label={
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-faint">Blackjack table</span>
              {active && <Badge tone="gold" dot>In play</Badge>}
              {ended && <Badge tone="neutral">Round complete</Badge>}
            </div>
          }
        >
          <div
            className="relative mx-auto w-full max-w-[620px] rounded-2xl border border-line/80 px-4 py-6 sm:px-8"
            style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(69,209,154,0.06), transparent 70%)' }}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-faint">{dealerLabel}</p>
                  <p className="font-display text-sm font-semibold text-ink">
                    {view ? (active ? `${view.dealerScore}+` : view.dealerScore) : '—'}
                    <span className="ml-1 text-[10px] font-normal text-faint">score</span>
                  </p>
                </div>
                <Badge tone="neutral">Stands on 17</Badge>
              </div>
              <div className="flex min-h-[110px] items-center gap-2 sm:min-h-[128px]">
                {view ? (
                  view.dealerCards.map((card, index) => <PlayingCard key={`${card.rank}-${card.suit}-${index}`} card={card} index={index} hidden={card.hidden} />)
                ) : (
                  <div className="flex h-[92px] w-full items-center justify-center rounded-xl border border-dashed border-line text-[11.5px] text-faint sm:h-[110px]">
                    The dealer's cards appear here
                  </div>
                )}
              </div>
            </div>

            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-gradient-to-r from-transparent via-line-strong to-transparent" />
              <span className="grid h-7 w-7 place-items-center rounded-full border border-gold/25 bg-gold/8">
                <Hand className="h-3.5 w-3.5 text-gold" />
              </span>
              <span className="h-px flex-1 bg-gradient-to-r from-transparent via-line-strong to-transparent" />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-gold-dim">Your hand</p>
                  <p className="font-display text-sm font-semibold text-ink">
                    {view ? view.playerScore : '—'}
                    <span className="ml-1 text-[10px] font-normal text-faint">score</span>
                  </p>
                </div>
                {view && <Badge tone="gold">Wager {money(view.session.bet)} money</Badge>}
              </div>
              <div className="flex min-h-[110px] items-center gap-2 sm:min-h-[128px]">
                {view ? (
                  view.playerCards.map((card, index) => <PlayingCard key={`${card.rank}-${card.suit}-${index}`} card={card} index={index} />)
                ) : (
                  <div className="flex h-[92px] w-full items-center justify-center rounded-xl border border-dashed border-line text-[11.5px] text-faint sm:h-[110px]">
                    Place a wager and deal to begin
                  </div>
                )}
              </div>
            </div>

            {ended && view && (
              <div className="mt-5">
                <ResultBanner
                  tone={resultTone}
                  title={view.result ?? (view.session.status === 'won' ? 'You win.' : view.session.status === 'push' ? 'Push.' : 'Dealer wins.')}
                  detail={`Your ${view.playerScore} vs dealer ${view.dealerScore}`}
                  extra={
                    <span className={cn('font-display text-lg font-semibold tnum', view.session.payout > 0 ? 'text-success' : 'text-muted')}>
                      {view.session.payout > 0 ? `+${money(view.session.payout)}` : '0'} <span className="text-[9px] uppercase">money</span>
                    </span>
                  }
                />
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
              disabled={Boolean(view)}
            />
            {!view && (
              <>
                <div className="rounded-xl border border-line bg-surface-2/60 p-3 text-[11.5px]">
                  <div className="flex justify-between">
                    <span className="text-muted">Blackjack pays</span>
                    <span className="font-medium text-gold">{(blackjackPays + 1).toFixed(1)}×</span>
                  </div>
                  <div className="mt-1.5 flex justify-between">
                    <span className="text-muted">Win pays</span>
                    <span className="font-medium text-ink">2.00×</span>
                  </div>
                  <div className="mt-1.5 flex justify-between">
                    <span className="text-muted">Push returns</span>
                    <span className="font-medium text-ink">1.00×</span>
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
                    loading={busy === 'deal'}
                    onClick={() => void deal()}
                    disabled={bet < game.minBet || bet > game.maxBet || bet > balance}
                    leftIcon={<Sparkles className="h-4 w-4" />}
                  >
                    Deal cards
                  </Button>
                )}
              </>
            )}

            {active && view && (
              <>
                <div className="grid gap-2">
                  <Button variant="primary" onClick={() => void act('hit')} loading={busy === 'hit'} disabled={!view.canHit || Boolean(busy)}>
                    Hit
                  </Button>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="secondary" onClick={() => void act('stand')} loading={busy === 'stand'} disabled={!view.canStand || Boolean(busy)}>
                      Stand
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void act('double')}
                      loading={busy === 'double'}
                      disabled={!view.canDouble || Boolean(busy) || balance < view.session.bet}
                    >
                      Double
                    </Button>
                  </div>
                </div>
                <p className="text-center text-[11px] text-faint">
                  Double requires {money(view.session.bet)} more money and draws exactly one card.
                </p>
              </>
            )}

            {ended && view && (
              <div className="space-y-2">
                <Button variant="primary" size="lg" className="w-full" onClick={() => setView(null)} leftIcon={<RotateCcw className="h-4 w-4" />}>
                  New round
                </Button>
                <p className="text-center text-[11px] text-faint">Adjust your wager before the next deal.</p>
              </div>
            )}
            {actionError && (
              <Alert tone="error" title="Table error">
                {actionError}
              </Alert>
            )}
          </SidePanel>
          <Card className="p-3.5">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-faint">Table rules</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              Six-deck shoe · dealer stands on all 17s · blackjack pays {(blackjackPays + 1).toFixed(1)}× · no split or
              insurance. Cards are dealt and scored on the server.
            </p>
          </Card>
        </>
      }
    />
  );
}
