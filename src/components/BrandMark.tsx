/**
 * Official DonutCash mark. The single asset lives at /logo.png so the header,
 * auth screens, legal pages, and favicon all stay in sync with one file.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src="/logo.png"
      alt="DonutCash"
      className={className}
      width={64}
      height={64}
      loading="eager"
      decoding="async"
    />
  );
}
