import { useId } from 'react';

/**
 * Donutcash mark: a glazed donut with a gold ring and sprinkles.
 */
export function BrandMark({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  const icingId = `donut-icing-${id}`;
  const holeId = `donut-hole-${id}`;

  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label="Donutcash"
      focusable="false"
    >
      <defs>
        <linearGradient id={icingId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffd9a8" />
          <stop offset="45%" stopColor="#f78bb0" />
          <stop offset="100%" stopColor="#c1548f" />
        </linearGradient>
        <mask id={holeId}>
          <rect width="32" height="32" fill="white" />
          <circle cx="16" cy="16" r="4.7" fill="black" />
        </mask>
      </defs>

      <g mask={`url(#${holeId})`}>
        <circle cx="16" cy="16" r="14.2" fill="#d9b26a" />
        <circle cx="16" cy="16" r="12.1" fill={`url(#${icingId})`} />
        <path
          d="M6.2 20.4c3.4 4.6 12.2 5.6 18.1 1.1"
          fill="none"
          stroke="rgba(255, 236, 199, 0.55)"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </g>

      <g fill="#fff6e4">
        <rect x="10.4" y="9.4" width="3.1" height="1.15" rx="0.575" transform="rotate(-28 10.4 9.4)" />
        <rect x="18.6" y="8.4" width="3.1" height="1.15" rx="0.575" transform="rotate(24 18.6 8.4)" />
        <rect x="7.9" y="15.6" width="3.1" height="1.15" rx="0.575" transform="rotate(64 7.9 15.6)" />
        <rect x="21.2" y="15.2" width="3.1" height="1.15" rx="0.575" transform="rotate(-52 21.2 15.2)" />
        <rect x="12.5" y="20.6" width="3.1" height="1.15" rx="0.575" transform="rotate(-12 12.5 20.6)" />
        <rect x="19.6" y="21.4" width="3.1" height="1.15" rx="0.575" transform="rotate(38 19.6 21.4)" />
      </g>

      <circle cx="16" cy="16" r="4.7" fill="none" stroke="rgba(26, 20, 8, 0.35)" strokeWidth="0.9" />
    </svg>
  );
}
