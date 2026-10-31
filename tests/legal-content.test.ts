import { describe, expect, it } from 'vitest';
import { legalDocuments, legalPagePaths, type LegalLocale, type LegalPageKind } from '../src/content/legal.ts';
import { LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION } from '../shared/legal.ts';

const kinds = Object.keys(legalPagePaths) as LegalPageKind[];
const locales: LegalLocale[] = ['en', 'nl'];

function documentText(kind: LegalPageKind, locale: LegalLocale): string {
  const doc = legalDocuments[kind][locale];
  return [
    doc.title,
    doc.eyebrow,
    doc.intro,
    ...doc.sections.flatMap((section) => [
      section.title,
      ...(section.paragraphs ?? []),
      ...(section.bullets ?? []),
      ...(section.links ?? []).flatMap((link) => [link.label, link.description ?? '']),
    ]),
  ].join(' ');
}

describe('published legal content', () => {
  it('contains no template notices, placeholders, or example addresses', () => {
    const forbidden = [/template/i, /placeholder/i, /SJABLOON/i, /must be inserted/i, /\.example/i];
    for (const kind of kinds) {
      for (const locale of locales) {
        const text = documentText(kind, locale);
        for (const pattern of forbidden) {
          expect(text, `${kind}/${locale} contains ${pattern}`).not.toMatch(pattern);
        }
      }
    }
  });

  it('uses the in-app support desk for contact in both languages', () => {
    expect(documentText('terms', 'en')).toContain('support desk in your account');
    expect(documentText('terms', 'nl')).toContain('supportdesk in je account');
    expect(documentText('privacy', 'en')).toContain('support desk in your account');
    expect(documentText('privacy', 'nl')).toContain('supportdesk in je account');
  });

  it('publishes the Netherlands as the governing law and the final version numbers', () => {
    expect(documentText('terms', 'en')).toContain('laws of the Netherlands');
    expect(documentText('terms', 'nl')).toContain('recht van Nederland');
    expect(LEGAL_TERMS_VERSION).toBe(LEGAL_PRIVACY_VERSION);
    expect(LEGAL_TERMS_VERSION).not.toBe('1.0');
  });
});
