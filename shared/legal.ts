/**
 * Central legal versioning. Bump these values whenever the published text
 * changes so every account is asked to accept the new version again.
 */
export const LEGAL_TERMS_VERSION = '1.0';
export const LEGAL_PRIVACY_VERSION = '1.0';
export const LEGAL_EFFECTIVE_DATE = '2026-10-30';
export const LEGAL_LAST_UPDATED_EN = '30 October 2026';
export const LEGAL_LAST_UPDATED_NL = '30 oktober 2026';

// Reserved example addresses. Replace these with the operator's real contact
// details before publication.
export const LEGAL_CONTACT_EMAIL = 'legal@donutcash.example';
export const LEGAL_PRIVACY_EMAIL = 'privacy@donutcash.example';

export const LEGAL_DISCLAIMER = 'Not affiliated with DonutSMP. In-game currency only. 18+.';
export const LEGAL_DISCLAIMER_NL = 'Niet verbonden aan DonutSMP. Alleen in-game valuta. 18+.';

export const SELF_EXCLUSION_DURATIONS = ['24h', '7d', '30d', 'permanent'] as const;
export type SelfExclusionDuration = (typeof SELF_EXCLUSION_DURATIONS)[number];

export interface LegalAcceptanceFields {
  ageConfirmed: true;
  acceptTerms: true;
  acknowledgeDonutRules: true;
}

export interface LegalAcceptanceRecord {
  id: string;
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: string;
  ip: string | null;
}

export interface LegalStatus {
  current: {
    termsVersion: string;
    privacyVersion: string;
    effectiveDate: string;
  };
  accepted: LegalAcceptanceRecord | null;
  required: boolean;
}
