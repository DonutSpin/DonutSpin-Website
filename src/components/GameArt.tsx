import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Bomb,
  CircleDot,
  Coins,
  Layers,
  Lock,
  Spade,
  Triangle,
} from 'lucide-react';
import type { GameConfig } from '../../shared/types';
import { money } from '../lib/format';
import { Badge, cn } from './ui';

const visuals: Record<string, { Icon: typeof Coins; glow: string; tint: string; label: string }> = {
  coinflip: { Icon: Coins, glow: 'rgba(230,194,122,0.22)', tint: '#e6c27a', label: 'Heads or tails' },
  mines: { Icon: Bomb, glow: 'rgba(77,214,160,0.18)', tint: '#4dd6a0', label: 'Clear the grid' },
  blackjack: { Icon: Spade, glow: 'rgba(124,184,255,0.18)', tint: '#7cb8ff', label: 'Beat the dealer' },
  roulette: { Icon: CircleDot, glow: 'rgba(248,123,134,0.18)', tint: '#f87b86', label: 'Spin the wheel' },
  towers: { Icon: Layers, glow: 'rgba(183,156,255,0.2)', tint: '#b79cff', label: 'Climb and cash out' },
  plinko: { Icon: Triangle, glow: 'rgba(94,234,212,0.18)', tint: '#5eead4', label: 'Drop and multiply' },
};

export function GameArtwork({ slug, compact = false }: { slug: string; compact?: boolean }) {
  const visual = visuals[slug] ?? visuals.coinflip!;
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-line/80 bg-surface-2/70',
        compact ? 'h-20' : 'h-36',
      )}
      style={{
        backgroundImage: `radial-gradient(circle at 76% 18%, ${visual.glow}, transparent 60%), linear-gradient(145deg, rgba(255,255,255,0.035), transparent 54%)`,
      }}
    >
      <div className="absolute inset-0 surface-grid opacity-40" />
      <div
        className="absolute -bottom-16 -right-10 h-44 w-44 rounded-full blur-2xl"
        style={{ backgroundColor: visual.glow }}
      />
      <div
        className="absolute right-4 top-1/2 grid -translate-y-1/2 place-items-center rounded-full border transition-transform duration-500 group-hover:scale-105"
        style={{
          width: compact ? 72 : 108,
          height: compact ? 72 : 108,
          borderColor: `${visual.tint}30`,
          backgroundColor: `${visual.tint}0c`,
          boxShadow: `inset 0 1px 0 ${visual.tint}20, 0 18px 34px -22px ${visual.tint}88`,
        }}
      >
        <visual.Icon
          style={{ width: compact ? 34 : 48, height: compact ? 34 : 48, color: visual.tint }}
          strokeWidth={1.25}
        />
      </div>
      <div className={cn('relative flex h-full flex-col justify-between', compact ? 'p-3' : 'p-4')}>
        <span
          className="grid h-8 w-8 place-items-center rounded-lg border shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
          style={{ borderColor: `${visual.tint}40`, backgroundColor: `${visual.tint}12`, color: visual.tint }}
        >
          <visual.Icon className="h-4 w-4" />
        </span>
        {!compact && (
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-faint">{visual.label}</p>
        )}
      </div>
    </div>
  );
}

export function GameCard({ game, children }: { game: GameConfig; children?: ReactNode }) {
  const body = (
    <div
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-2xl border border-line/90 premium-card transition-all duration-300',
        game.enabled
          ? 'hover:-translate-y-1 hover:border-gold/30 hover:shadow-[0_30px_60px_-32px_rgba(0,0,0,0.95)]'
          : 'opacity-75',
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/0 to-transparent transition-colors duration-300 group-hover:via-gold/50" />
      <div className="p-3.5 pb-0">
        <GameArtwork slug={game.slug} />
      </div>
      <div className="flex flex-1 flex-col p-4 pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-[16px] font-semibold tracking-[-0.015em] text-ink">{game.name}</h3>
          {game.enabled ? (
            <span className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.12em] text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_6px_rgba(77,214,160,0.8)]" />
              Live
            </span>
          ) : (
            <Badge tone="warning">
              <Lock className="h-3 w-3" /> Offline
            </Badge>
          )}
        </div>
        <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted">{game.description}</p>
        <div className="mt-auto flex items-center justify-between border-t border-line/60 pt-3.5">
          <p className="text-[10px] text-faint tnum">
            {money(game.minBet)}–{money(game.maxBet)} money
          </p>
          {game.enabled ? (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-gold transition-colors group-hover:text-gold-bright">
              Play
              <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </span>
          ) : (
            <span className="text-[10.5px] text-faint">Unavailable</span>
          )}
        </div>
      </div>
    </div>
  );

  if (!game.enabled) return body;
  return (
    <Link to={`/games/${game.slug}`} className="block h-full">
      {body}
      {children}
    </Link>
  );
}
