import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  FileText,
  Gamepad2,
  Globe2,
  HeartHandshake,
  LifeBuoy,
  ShieldCheck,
  Trophy,
} from 'lucide-react';
import type { SessionUser } from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { api, ApiRequestError, errorMessage } from '../lib/api';
import { BrandMark } from '../components/BrandMark';
import { LegalCheckbox, LegalDisclaimer, LegalFooterLinks } from '../components/legal';
import { Alert, Button } from '../components/ui';
import {
  getLegalDocument,
  legalPagePaths,
  legalUi,
  type LegalLocale,
  type LegalPageKind,
} from '../content/legal';
import { cn } from '../components/ui';

function queryForLocale(locale: LegalLocale): string {
  return locale === 'nl' ? '?lang=nl' : '';
}

function useLocale(): LegalLocale {
  const [params] = useSearchParams();
  return params.get('lang') === 'nl' ? 'nl' : 'en';
}

function BrandHeader({ locale }: { locale: LegalLocale }) {
  const ui = legalUi[locale];
  const suffix = queryForLocale(locale);
  const other: LegalLocale = locale === 'en' ? 'nl' : 'en';
  return (
    <header className="border-b border-line/70 bg-surface-0/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1160px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-gold/30 bg-gold/10">
            <BrandMark className="h-6 w-6" />
          </span>
          <span>
            <span className="block font-display text-[13px] font-bold tracking-[0.18em] text-ink">{ui.brand}</span>
            <span className="block text-[8px] uppercase tracking-[0.2em] text-faint">{ui.brandSub}</span>
          </span>
        </Link>
        <div className="flex items-center gap-3 text-[11px]">
          <Link to="/" className="text-muted transition-colors hover:text-ink">
            {ui.back}
          </Link>
          <span className="h-3 w-px bg-line" />
          <Link
            to={`${legalPagePaths.terms}${suffix}`}
            className="hidden text-muted transition-colors hover:text-ink sm:inline"
          >
            {ui.terms}
          </Link>
          <Link
            to={`${legalPagePaths.privacy}${suffix}`}
            className="hidden text-muted transition-colors hover:text-ink sm:inline"
          >
            {ui.privacy}
          </Link>
          <Link
            to={`${legalPagePaths['responsible-gambling']}${suffix}`}
            className="hidden text-muted transition-colors hover:text-ink md:inline"
          >
            {ui.responsible}
          </Link>
          <Link
            to={`${location.pathname}?lang=${other}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2/70 px-2.5 py-1.5 font-medium text-muted transition-colors hover:border-gold/30 hover:text-gold"
          >
            <Globe2 className="h-3 w-3" />
            {other === 'nl' ? ui.dutch : ui.english}
          </Link>
        </div>
      </div>
    </header>
  );
}

function LegalFooter({ locale }: { locale: LegalLocale }) {
  return (
    <footer className="mt-14 border-t border-line/70 py-6">
      <div className="mx-auto flex max-w-[1160px] flex-col gap-3 px-4 text-[10.5px] text-faint sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p>© {new Date().getFullYear()} DonutSpin</p>
        <LegalFooterLinks locale={locale} />
        <LegalDisclaimer locale={locale} />
      </div>
    </footer>
  );
}

export function LegalPage({ kind }: { kind: LegalPageKind }) {
  const locale = useLocale();
  const ui = legalUi[locale];
  const doc = getLegalDocument(kind, locale);
  const { user } = useAuth();
  const [params] = useSearchParams();
  const showSelfExcluded = params.get('selfExcluded') === '1';

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${doc.title} · DonutSpin`;
    document.documentElement.lang = locale;
    return () => {
      document.title = previousTitle;
      document.documentElement.lang = 'en';
    };
  }, [doc.title, locale]);

  return (
    <div className="min-h-screen">
      <BrandHeader locale={locale} />
      <main className="mx-auto max-w-[1160px] px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <Link
          to={user ? '/' : '/login'}
          className="mb-6 inline-flex items-center gap-1.5 text-[11.5px] text-muted transition-colors hover:text-gold"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {ui.back}
        </Link>

        {user?.legalAcceptanceRequired && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold/25 bg-gold/[0.06] px-4 py-3 text-[12px] text-gold-bright">
            <span>{ui.consentBanner}</span>
            <Link to="/legal-consent" className="font-semibold underline decoration-gold/40 underline-offset-2">
              {ui.backToConsent}
            </Link>
          </div>
        )}

        {showSelfExcluded && kind === 'responsible-gambling' && (
          <Alert tone="success" title={ui.selfExcludedTitle} className="mb-6">
            {ui.selfExcludedText}
          </Alert>
        )}

        <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
          <aside className="min-w-0">
            <div className="lg:sticky lg:top-8">
              <p className="mb-3 text-[9.5px] font-bold uppercase tracking-[0.16em] text-faint">{ui.contents}</p>
              <nav className="flex gap-1.5 overflow-x-auto pb-2 lg:block lg:space-y-1 lg:overflow-visible lg:pb-0" aria-label={ui.contents}>
                {doc.sections.map((section) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className="block shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] leading-snug text-muted transition-colors hover:bg-surface-2 hover:text-gold lg:text-[11.5px]"
                  >
                    {section.title}
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          <article className="min-w-0 max-w-[780px]">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">{doc.eyebrow}</p>
            <h1 className="mt-2 font-display text-[34px] font-semibold leading-tight tracking-[-0.035em] text-ink sm:text-[42px]">
              {doc.title}
            </h1>
            <p className="mt-4 max-w-2xl text-[13.5px] leading-7 text-muted">{doc.intro}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[10.5px] text-faint">
              <span className="rounded-full border border-line bg-surface-2/60 px-2.5 py-1">{doc.versionLabel ?? ui.version}</span>
              <span>{doc.updatedLabel ?? ui.lastUpdated}</span>
            </div>

            <div className="mt-9 space-y-9">
              {doc.sections.map((section) => (
                <section key={section.id} id={section.id} className="scroll-mt-24">
                  <h2 className="font-display text-[19px] font-semibold leading-snug text-ink">{section.title}</h2>
                  {section.paragraphs?.map((paragraph) => (
                    <p key={paragraph} className="mt-2.5 text-[12.5px] leading-6 text-muted">
                      {paragraph}
                    </p>
                  ))}
                  {section.bullets && (
                    <ul className="mt-3 space-y-2 pl-5">
                      {section.bullets.map((bullet) => (
                        <li key={bullet} className="list-disc text-[12.5px] leading-6 text-muted marker:text-gold/70">
                          {bullet}
                        </li>
                      ))}
                    </ul>
                  )}
                  {section.links && (
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {section.links.map((link) => (
                        <a
                          key={link.href}
                          href={link.href}
                          target="_blank"
                          rel="noreferrer"
                          className="group rounded-xl border border-line bg-surface-2/50 p-3.5 transition-colors hover:border-gold/30 hover:bg-surface-2"
                        >
                          <span className="flex items-center justify-between gap-2 text-[12px] font-semibold text-ink group-hover:text-gold">
                            {link.label}
                            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-faint group-hover:text-gold" />
                          </span>
                          {link.description && <span className="mt-1 block text-[11px] leading-relaxed text-faint">{link.description}</span>}
                        </a>
                      ))}
                    </div>
                  )}
                  {section.code && (
                    <pre className="mt-3.5 overflow-x-auto rounded-xl border border-line bg-surface-0/70 p-4 text-[11px] leading-relaxed text-ink/90">
                      <code>{section.code}</code>
                    </pre>
                  )}
                </section>
              ))}
            </div>

            {kind === 'responsible-gambling' && (
              <div className="mt-10 overflow-hidden rounded-2xl border border-gold/25 bg-gradient-to-br from-gold/[0.1] via-surface-1 to-surface-1 p-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-gold/25 bg-gold/10 text-gold">
                    <HeartHandshake className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="font-display text-[17px] font-semibold text-ink">{ui.selfExclusionTitle}</h2>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{ui.selfExclusionText}</p>
                    <Link
                      to={user ? '/settings?tab=responsible' : '/login'}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-gold/30 bg-gold/10 px-3 py-1.5 text-[11.5px] font-semibold text-gold-bright transition-colors hover:bg-gold/15"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> {ui.selfExclusionCta}
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {kind === 'provably-fair' && (
              <div className="mt-10 grid gap-2 sm:grid-cols-3">
                {[
                  { to: '/games', label: ui.fairCtaGames, icon: Gamepad2 },
                  { to: '/giveaways', label: ui.fairCtaGiveaways, icon: Trophy },
                  { to: '/tickets/new', label: ui.fairCtaSupport, icon: LifeBuoy },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      className="group flex items-center gap-2.5 rounded-xl border border-line bg-surface-2/50 px-3.5 py-3 text-[12px] font-medium text-muted transition-colors hover:border-gold/30 hover:bg-surface-2 hover:text-gold"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-faint group-hover:text-gold" />
                      <span className="flex-1">{item.label}</span>
                      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-faint group-hover:text-gold" />
                    </Link>
                  );
                })}
              </div>
            )}

            <div className="mt-10 border-t border-line/70 pt-5">
              <LegalFooterLinks locale={locale} />
            </div>
          </article>
        </div>
      </main>
      <LegalFooter locale={locale} />
    </div>
  );
}

export function LegalConsentPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acknowledgeDonutRules, setAcknowledgeDonutRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  if (!user) return <Navigate to="/login" replace />;
  if (!user.legalAcceptanceRequired) return <Navigate to="/" replace />;

  const allAccepted = ageConfirmed && acceptTerms && acknowledgeDonutRules;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    setError(null);
    setFields({});
    if (!allAccepted) {
      setError(legalUi.en.consentRequired);
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<{ user: SessionUser }>('/legal/accept', {
        ageConfirmed,
        acceptTerms,
        acknowledgeDonutRules,
      });
      setUser(result.user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fieldErrors);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-line/70 bg-surface-0/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[780px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link to="/" className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-gold/30 bg-gold/10">
              <BrandMark className="h-6 w-6" />
            </span>
            <span>
              <span className="block font-display text-[13px] font-bold tracking-[0.18em] text-ink">DONUTSPIN</span>
              <span className="block text-[8px] uppercase tracking-[0.2em] text-faint">DonutSMP casino</span>
            </span>
          </Link>
          <span className="rounded-full border border-gold/25 bg-gold/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gold">
            18+
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] px-4 py-10 sm:px-6 sm:py-14">
        <div className="rounded-2xl border border-line/80 bg-surface-1/90 p-5 shadow-2xl sm:p-7">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-gold/25 bg-gold/10 text-gold">
              <FileText className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold">Required before entry</p>
              <h1 className="mt-1 font-display text-[26px] font-semibold leading-tight tracking-[-0.03em] text-ink">
                {legalUi.en.consentTitle}
              </h1>
            </div>
          </div>
          <p className="mt-4 text-[12.5px] leading-6 text-muted">{legalUi.en.consentIntro}</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-faint">{legalUi.nl.consentIntro}</p>

          <div className="mt-5 rounded-xl border border-warning/25 bg-warning/[0.06] px-3.5 py-3 text-[11px] leading-relaxed text-warning">
            DonutSpin is not affiliated with DonutSMP, Mojang or Microsoft. Only in-game currency is used. Gambling with
            in-game currency may violate DonutSMP’s rules and could result in a ban.
          </div>

          {error && (
            <Alert tone="error" className="mt-4">
              {error}
            </Alert>
          )}

          <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-2.5">
            <LegalCheckbox
              id="consent-age"
              checked={ageConfirmed}
              onChange={setAgeConfirmed}
              error={fields.ageConfirmed}
              hint="Ik bevestig dat ik 18 jaar of ouder ben."
            >
              I confirm that I am 18 years or older.
            </LegalCheckbox>
            <LegalCheckbox
              id="consent-terms"
              checked={acceptTerms}
              onChange={setAcceptTerms}
              error={fields.acceptTerms}
              hint="Ik ga akkoord met de Servicevoorwaarden en het Privacybeleid."
            >
              I agree to the{' '}
              <Link to="/terms" target="_blank" rel="noreferrer" className="font-medium text-gold underline decoration-gold/40 underline-offset-2">
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link to="/privacy" target="_blank" rel="noreferrer" className="font-medium text-gold underline decoration-gold/40 underline-offset-2">
                Privacy Policy
              </Link>
              .
            </LegalCheckbox>
            <LegalCheckbox
              id="consent-donutsmp"
              checked={acknowledgeDonutRules}
              onChange={setAcknowledgeDonutRules}
              error={fields.acknowledgeDonutRules}
              hint="Ik begrijp dat deze activiteit in strijd kan zijn met de regels van DonutSMP en kan leiden tot een ban."
            >
              I understand that this activity may violate DonutSMP’s rules and could result in a ban.
            </LegalCheckbox>

            <div className="pt-2">
              <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!allAccepted} className="w-full">
                <Check className="h-4 w-4" /> {busy ? legalUi.en.consentAccepting : legalUi.en.consentAccept}
              </Button>
            </div>
          </form>

          <div className="mt-5 grid gap-2 border-t border-line/70 pt-4 text-[11px] sm:grid-cols-3">
            <Link to="/terms" className="text-muted transition-colors hover:text-gold">
              {legalUi.en.readTerms}
            </Link>
            <Link to="/privacy" className="text-muted transition-colors hover:text-gold">
              {legalUi.en.readPrivacy}
            </Link>
            <Link to="/responsible-gambling" className="text-muted transition-colors hover:text-gold">
              {legalUi.en.readResponsible}
            </Link>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-center gap-2 text-[10px] text-faint">
          <Globe2 className="h-3 w-3" /> English / Nederlands · Versions {legalUi.en.version.replace('Version ', '')}
        </div>
      </main>

      <footer className="mx-auto max-w-[720px] border-t border-line/70 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-3 text-[10.5px] text-faint sm:flex-row sm:items-center sm:justify-between">
          <LegalFooterLinks />
          <LegalDisclaimer />
        </div>
      </footer>
    </div>
  );
}

