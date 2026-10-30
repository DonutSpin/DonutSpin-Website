import { z } from 'zod';
import type { BlackjackView, Card } from '../../shared/types.ts';
import { parse } from '../lib/validation.ts';
import { badRequest, conflict, notFound, parseJson } from '../lib/core.ts';
import { applyLedger, balanceOf } from '../lib/wallet.ts';
import { payoutFor } from '../../shared/payout.ts';
import { compactAmount } from '../../shared/amount.ts';
import {
  baseView,
  creditPayout,
  debitWager,
  findReplay,
  finishSession,
  getSessionRow,
  insertSession,
  maxPayout,
  newSessionId,
  numberConfig,
  secureInt,
  shuffle,
  updateSessionState,
  type GameModule,
  type GameSessionRow,
} from './common.ts';

const SUITS = ['♠', '♥', '♦', '♣'] as const;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

type Suit = (typeof SUITS)[number];
type Rank = (typeof RANKS)[number];

interface ShoeCard {
  rank: Rank;
  suit: Suit;
}

export function buildShoe(decks: number): ShoeCard[] {
  const cards: ShoeCard[] = [];
  for (let d = 0; d < decks; d += 1) {
    for (const suit of SUITS) for (const rank of RANKS) cards.push({ rank, suit });
  }
  return shuffle(cards);
}

export function handTotal(cards: { rank: string }[]): number {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === 'A') {
      aces += 1;
      total += 11;
    } else if (['J', 'Q', 'K'].includes(card.rank)) {
      total += 10;
    } else {
      total += Number(card.rank) || 0;
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function isSoft(cards: { rank: string }[]): boolean {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === 'A') {
      aces += 1;
      total += 11;
    } else if (['J', 'Q', 'K'].includes(card.rank)) total += 10;
    else total += Number(card.rank) || 0;
  }
  let softAces = aces;
  while (total > 21 && softAces > 0) {
    total -= 10;
    softAces -= 1;
  }
  return softAces > 0;
}

interface BlackjackState {
  shoe: ShoeCard[];
  player: ShoeCard[];
  dealer: ShoeCard[];
  doubled: boolean;
  actions: number;
  result: string | null;
  lastActionId: string | null;
  allowDouble: boolean;
  standsSoft17: boolean;
  blackjackPays: number;
  /** Shoe size, persisted so a resumed hand rebuilds the same shoe size. */
  decks: number;
}

function draw(shoe: ShoeCard[], decks: number): ShoeCard {
  const card = shoe.pop();
  if (card) return card;
  const rebuilt = buildShoe(decks);
  const next = rebuilt.pop();
  if (!next) throw new Error('Unable to draw a card');
  shoe.push(...rebuilt);
  return next;
}

/** A two-card 21: the only hand that pays the blackjack bonus. */
function isNatural(cards: ShoeCard[]): boolean {
  return cards.length === 2 && handTotal(cards) === 21;
}

function dealerPlay(state: BlackjackState, decks: number): void {
  for (let guard = 0; guard < 30; guard += 1) {
    const total = handTotal(state.dealer);
    const soft = isSoft(state.dealer);
    const shouldHit = total < 17 || (total === 17 && soft && !state.standsSoft17);
    if (!shouldHit) return;
    state.dealer.push(draw(state.shoe, decks));
  }
}

function settle(
  db: Parameters<typeof finishSession>[0],
  input: {
    sessionId: string;
    userId: string;
    bet: number;
    state: BlackjackState;
    natural?: boolean;
  },
): { status: 'won' | 'lost' | 'push'; payout: number; result: string } {
  const playerTotal = handTotal(input.state.player);
  const dealerTotal = handTotal(input.state.dealer);
  let status: 'won' | 'lost' | 'push' = 'lost';
  let payoutMultiplier = 0;
  let result = '';

  if (playerTotal > 21) {
    result = 'Bust — you went over 21.';
    status = 'lost';
  } else if (input.natural) {
    if (dealerTotal === 21 && input.state.dealer.length === 2) {
      result = 'Both blackjack — push.';
      status = 'push';
      payoutMultiplier = 1;
    } else {
      result = 'Blackjack!';
      status = 'won';
      payoutMultiplier = 1 + input.state.blackjackPays;
    }
  } else if (dealerTotal > 21) {
    result = 'Dealer busts — you win.';
    status = 'won';
    payoutMultiplier = 2;
  } else if (playerTotal > dealerTotal) {
    result = 'You beat the dealer.';
    status = 'won';
    payoutMultiplier = 2;
  } else if (playerTotal === dealerTotal) {
    result = 'Push — your wager is returned.';
    status = 'push';
    payoutMultiplier = 1;
  } else {
    result = 'Dealer wins.';
    status = 'lost';
  }

  const payout = payoutFor(input.bet, payoutMultiplier, maxPayout(db));
  input.state.result = result;
  const payoutLedgerId = creditPayout(
    db,
    { id: input.sessionId, user_id: input.userId, game_id: 'blackjack' },
    payout,
    result,
  );
  finishSession(db, input.sessionId, {
    status,
    payout,
    state: input.state,
    outcome: { playerTotal, dealerTotal, result },
    payoutLedgerId,
  });
  return { status, payout, result };
}

function buildView(row: GameSessionRow, state: BlackjackState, balance: number, configDecks = 6): BlackjackView {
  const active = row.status === 'active';
  const dealerCards: Card[] = state.dealer.map((card, index) =>
    active && index === 1
      ? { rank: '?', suit: '♠', hidden: true }
      : { rank: card.rank, suit: card.suit as Card['suit'] },
  );
  return {
    ...baseView(row, balance),
    playerCards: state.player.map((card) => ({ rank: card.rank, suit: card.suit as Card['suit'] })),
    dealerCards,
    playerScore: handTotal(state.player),
    dealerScore: active ? handTotal(state.dealer.slice(0, 1)) : handTotal(state.dealer),
    canHit: active,
    canStand: active,
    canDouble: active && state.actions === 0 && state.player.length === 2 && state.allowDouble,
    result: state.result,
  };
}

const actionSchema = z.object({ action: z.enum(['hit', 'stand', 'double']) });

export const blackjack: GameModule = {
  start(ctx) {
    const replay = findReplay(ctx.db, ctx.user.id, ctx.requestId);
    if (replay) return this.resume(replay, balanceOf(ctx.db, ctx.user.id), maxPayout(ctx.db));

    const decks = Math.min(8, Math.max(1, Math.floor(numberConfig(ctx.gameConfig, 'decks', 6))));
    const blackjackPays = Math.min(2, Math.max(1, numberConfig(ctx.gameConfig, 'blackjackPays', 1.5)));
    const standsSoft17 = ctx.gameConfig.dealerStandsSoft17 !== false;
    const allowDouble = ctx.gameConfig.allowDouble !== false;
    const shoe = buildShoe(decks);
    const player = [draw(shoe, decks), draw(shoe, decks)];
    const dealer = [draw(shoe, decks), draw(shoe, decks)];
    const state: BlackjackState = {
      shoe,
      player,
      dealer,
      doubled: false,
      actions: 0,
      result: null,
      lastActionId: null,
      allowDouble,
      standsSoft17,
      blackjackPays,
      decks,
    };
    const sessionId = newSessionId();
    const wagerLedgerId = debitWager(ctx.db, ctx.user.id, sessionId, ctx.bet, ctx.game.id);
    insertSession(ctx.db, {
      id: sessionId,
      userId: ctx.user.id,
      gameId: ctx.game.id,
      bet: ctx.bet,
      status: 'active',
      state,
      requestId: ctx.requestId,
      wagerLedgerId,
      gameConfig: ctx.gameConfig,
    });

    const playerNatural = isNatural(player);
    const dealerNatural = isNatural(dealer);
    if (playerNatural || dealerNatural) {
      // A natural ends the hand immediately: the dealer never draws, because a
      // player blackjack only pushes against another natural.
      state.lastActionId = null;
      settle(ctx.db, { sessionId, userId: ctx.user.id, bet: ctx.bet, state, natural: playerNatural });
    }

    const row = getSessionRow(ctx.db, sessionId);
    if (!row) throw new Error('Session disappeared');
    return buildView(row, state, balanceOf(ctx.db, ctx.user.id), decks);
  },

  action(ctx) {
    const { action } = parse(actionSchema, ctx.body);
    const session = getSessionRow(ctx.db, ctx.sessionId);
    if (!session || session.user_id !== ctx.user.id) throw notFound('Game session not found.');
    const state = parseJson<BlackjackState | null>(session.state, null);
    if (!state) throw new Error('Corrupt game state');

    if (state.lastActionId && state.lastActionId === ctx.requestId) {
      return buildView(session, state, balanceOf(ctx.db, ctx.user.id));
    }
    if (session.status !== 'active') {
      throw conflict('This round is already complete.', 'ROUND_COMPLETE');
    }

    const decks = Math.min(8, Math.max(1, Math.floor(state.decks || 6)));
    const bet = session.bet;
    state.lastActionId = ctx.requestId;

    if (action === 'hit') {
      state.actions += 1;
      state.player.push(draw(state.shoe, decks));
      const total = handTotal(state.player);
      if (total > 21) {
        state.result = 'Bust — you went over 21.';
        creditPayout(ctx.db, { id: session.id, user_id: session.user_id, game_id: session.game_id }, 0, 'Blackjack loss');
        finishSession(ctx.db, session.id, {
          status: 'lost',
          payout: 0,
          state,
          outcome: { playerTotal: total, dealerTotal: handTotal(state.dealer) },
        });
      } else if (total === 21) {
        dealerPlay(state, decks);
        settle(ctx.db, { sessionId: session.id, userId: session.user_id, bet, state });
      } else {
        updateSessionState(ctx.db, session.id, state);
      }
    } else if (action === 'stand') {
      dealerPlay(state, decks);
      settle(ctx.db, { sessionId: session.id, userId: session.user_id, bet, state });
    } else {
      if (!state.allowDouble) throw badRequest('Doubling is disabled for this table.', 'DOUBLE_DISABLED');
      if (state.actions !== 0 || state.player.length !== 2) {
        throw badRequest('You can only double on the first two cards.', 'DOUBLE_NOT_ALLOWED');
      }
      const newBet = bet * 2;
      // Doubling doubles the real wager, so the table maximum has to hold for the
      // doubled amount too. Otherwise a 1M table limit could be bet past at 2M.
      if (newBet > ctx.game.max_bet) {
        throw badRequest(
          `Doubling would stake ${compactAmount(newBet)} DonutSMP money, above the ${compactAmount(ctx.game.max_bet)} table maximum.`,
          'WAGER_TOO_HIGH',
        );
      }
      applyLedger(ctx.db, {
        userId: session.user_id,
        amount: -bet,
        type: 'game_wager',
        refType: 'game_session',
        refId: session.id,
        reason: 'Blackjack double down',
        idempotencyKey: `game-wager-double:${session.id}`,
        metadata: { game: 'blackjack' },
      });
      state.doubled = true;
      state.actions += 1;
      state.player.push(draw(state.shoe, decks));
      updateSessionState(ctx.db, session.id, state, newBet);
      if (handTotal(state.player) > 21) {
        state.result = 'Bust — you went over 21.';
        creditPayout(ctx.db, { id: session.id, user_id: session.user_id, game_id: session.game_id }, 0, 'Blackjack loss');
        finishSession(ctx.db, session.id, {
          status: 'lost',
          payout: 0,
          state,
          outcome: { playerTotal: handTotal(state.player), dealerTotal: handTotal(state.dealer) },
        });
      } else {
        dealerPlay(state, decks);
        settle(ctx.db, { sessionId: session.id, userId: session.user_id, bet: newBet, state });
      }
    }

    const updated = getSessionRow(ctx.db, session.id);
    if (!updated) throw new Error('Session disappeared');
    const finalState = parseJson<BlackjackState>(updated.state, state);
    return buildView(updated, finalState, balanceOf(ctx.db, ctx.user.id));
  },

  resume(row, balance) {
    const state = parseJson<BlackjackState | null>(row.state, null);
    if (!state) throw new Error('Corrupt game state');
    return buildView(row, state, balance);
  },
};

export { secureInt };
