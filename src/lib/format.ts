import { compactAmount } from './amount';

const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Money is always shown in the short K/M/B/T format. */
export function money(value: number): string {
  return compactAmount(Math.trunc(value));
}

/** Non-money counters (users, tickets, rounds) stay exact and grouped. */
export function count(value: number): string {
  return numberFormatter.format(Math.trunc(value));
}

export function signedCredits(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${money(value)}`;
}

export function multiplier(value: number): string {
  return `${value.toFixed(2)}×`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { dateStyle: 'medium' });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '—';
  const diff = Date.now() - time;
  const abs = Math.abs(diff);
  const future = diff < 0;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 24 * 3600_000],
    ['month', 30 * 24 * 3600_000],
    ['week', 7 * 24 * 3600_000],
    ['day', 24 * 3600_000],
    ['hour', 3600_000],
    ['minute', 60_000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) {
      const value = Math.round(diff / ms);
      return new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' }).format(-value, unit);
    }
  }
  return future ? 'in a moment' : 'just now';
}

export function initials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function truncate(value: string, length = 90): string {
  if (value.length <= length) return value;
  return `${value.slice(0, length - 1)}…`;
}

export function niceDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
