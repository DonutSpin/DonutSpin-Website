import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LEGAL_DISCLAIMER, LEGAL_DISCLAIMER_NL } from '../../shared/legal';
import { legalUi, legalPagePaths, type LegalLocale } from '../content/legal';
import { cn } from './ui';

export function LegalFooterLinks({
  locale = 'en',
  className,
}: {
  locale?: LegalLocale;
  className?: string;
}) {
  const ui = legalUi[locale];
  const suffix = locale === 'nl' ? '?lang=nl' : '';
  return (
    <nav className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)} aria-label={ui.footerHeading}>
      <Link to={`${legalPagePaths.terms}${suffix}`} className="transition-colors hover:text-gold">
        {ui.terms}
      </Link>
      <Link to={`${legalPagePaths.privacy}${suffix}`} className="transition-colors hover:text-gold">
        {ui.privacy}
      </Link>
      <Link to={`${legalPagePaths['responsible-gambling']}${suffix}`} className="transition-colors hover:text-gold">
        {ui.responsible}
      </Link>
    </nav>
  );
}

export function LegalDisclaimer({ locale = 'en', className }: { locale?: LegalLocale; className?: string }) {
  return (
    <div className={cn('space-y-0.5', className)}>
      <p className="text-[11px] font-semibold text-muted">{LEGAL_DISCLAIMER}</p>
      {locale === 'nl' && <p className="text-muted/80">{LEGAL_DISCLAIMER_NL}</p>}
    </div>
  );
}

export function LegalCheckbox({
  id,
  checked,
  onChange,
  children,
  hint,
  error,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  hint?: ReactNode;
  error?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-3.5 transition-colors',
        error ? 'border-danger/45 bg-danger/5' : checked ? 'border-gold/35 bg-gold/[0.06]' : 'border-line bg-surface-2/45',
      )}
    >
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-line-strong bg-surface-3 accent-[#e6c27a]"
          aria-invalid={Boolean(error)}
        />
        <span className="text-[12px] leading-relaxed text-ink/90">{children}</span>
      </label>
      {hint && <p className="mt-1 pl-7 text-[10.5px] leading-relaxed text-faint">{hint}</p>}
      {error && <p className="mt-1 pl-7 text-[10.5px] leading-relaxed text-danger">{error}</p>}
    </div>
  );
}
