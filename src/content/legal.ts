import {
  LEGAL_LAST_UPDATED_EN,
  LEGAL_LAST_UPDATED_NL,
  LEGAL_PRIVACY_VERSION,
  LEGAL_TERMS_VERSION,
} from '../../shared/legal';

export type LegalPageKind = 'terms' | 'privacy' | 'responsible-gambling';
export type LegalLocale = 'en' | 'nl';

export interface LegalLink {
  label: string;
  href: string;
  description?: string;
}

export interface LegalSection {
  id: string;
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  links?: LegalLink[];
}

export interface LegalDocument {
  title: string;
  eyebrow: string;
  intro: string;
  sections: LegalSection[];
}

export const legalPagePaths: Record<LegalPageKind, string> = {
  terms: '/terms',
  privacy: '/privacy',
  'responsible-gambling': '/responsible-gambling',
};

export const legalUi: Record<
  LegalLocale,
  {
    brand: string;
    brandSub: string;
    back: string;
    contents: string;
    version: string;
    lastUpdated: string;
    footerHeading: string;
    disclaimer: string;
    terms: string;
    privacy: string;
    responsible: string;
    consentTitle: string;
    consentIntro: string;
    consentAccept: string;
    consentAccepting: string;
    consentRequired: string;
    consentDutch: string;
    language: string;
    english: string;
    dutch: string;
    readTerms: string;
    readPrivacy: string;
    readResponsible: string;
    consentBanner: string;
    backToConsent: string;
    selfExclusionTitle: string;
    selfExclusionText: string;
    selfExclusionCta: string;
    selfExcludedTitle: string;
    selfExcludedText: string;
  }
> = {
  en: {
    brand: 'DONUTCASH',
    brandSub: 'DonutSMP casino',
    back: 'Back to Donutcash',
    contents: 'On this page',
    version: `Version ${LEGAL_TERMS_VERSION}`,
    lastUpdated: `Last updated ${LEGAL_LAST_UPDATED_EN}`,
    footerHeading: 'Legal',
    disclaimer: 'Not affiliated with DonutSMP. In-game currency only. 18+.',
    terms: 'Terms of Service',
    privacy: 'Privacy Policy',
    responsible: 'Responsible Gambling',
    consentTitle: 'Before you enter the tables',
    consentIntro:
      'Donutcash is an 18+ entertainment service for DonutSMP in-game currency only. Please confirm the statements below to continue.',
    consentAccept: 'Accept and continue',
    consentAccepting: 'Saving your consent…',
    consentRequired: 'You must accept all three statements before using Donutcash.',
    consentDutch: 'Nederlandse vertaling',
    language: 'Language',
    english: 'English',
    dutch: 'Nederlands',
    readTerms: 'Read the Terms of Service',
    readPrivacy: 'Read the Privacy Policy',
    readResponsible: 'Read the Responsible Gambling page',
    consentBanner:
      'You need to accept the current Terms of Service and Privacy Policy before using Donutcash.',
    backToConsent: 'Back to consent',
    selfExclusionTitle: 'Take a break from the tables',
    selfExclusionText:
      'If gambling is affecting your wellbeing, you can block your own account. The block cannot be lifted early.',
    selfExclusionCta: 'Manage self-exclusion',
    selfExcludedTitle: 'Your account is now blocked',
    selfExcludedText:
      'Your self-exclusion has been applied and you have been signed out. You cannot sign back in until the exclusion period ends. If you need help, use the support services on this page.',
  },
  nl: {
    brand: 'DONUTCASH',
    brandSub: 'DonutSMP casino',
    back: 'Terug naar Donutcash',
    contents: 'Op deze pagina',
    version: `Versie ${LEGAL_TERMS_VERSION}`,
    lastUpdated: `Laatst bijgewerkt ${LEGAL_LAST_UPDATED_NL}`,
    footerHeading: 'Juridisch',
    disclaimer: 'Niet verbonden aan DonutSMP. Alleen in-game valuta. 18+.',
    terms: 'Servicevoorwaarden',
    privacy: 'Privacybeleid',
    responsible: 'Verantwoord spelen',
    consentTitle: 'Voordat je aan tafel gaat',
    consentIntro:
      'Donutcash is een 18+ entertainmentservice voor DonutSMP in-game valuta. Bevestig de onderstaande verklaringen om verder te gaan.',
    consentAccept: 'Accepteren en doorgaan',
    consentAccepting: 'Toestemming opslaan…',
    consentRequired: 'Je moet alle drie de verklaringen accepteren voordat je Donutcash gebruikt.',
    consentDutch: 'English translation',
    language: 'Taal',
    english: 'English',
    dutch: 'Nederlands',
    readTerms: 'Lees de Servicevoorwaarden',
    readPrivacy: 'Lees het Privacybeleid',
    readResponsible: 'Lees de pagina Verantwoord spelen',
    consentBanner:
      'Je moet de actuele Servicevoorwaarden en het Privacybeleid accepteren voordat je Donutcash gebruikt.',
    backToConsent: 'Terug naar toestemming',
    selfExclusionTitle: 'Neem een pauze van de tafels',
    selfExclusionText:
      'Als gokken je welzijn beïnvloedt, kun je je eigen account blokkeren. De blokkade kan niet eerder worden opgeheven.',
    selfExclusionCta: 'Zelfuitsluiting beheren',
    selfExcludedTitle: 'Je account is nu geblokkeerd',
    selfExcludedText:
      'Je zelfuitsluiting is toegepast en je bent uitgelogd. Je kunt niet opnieuw inloggen tot de uitsluitingsperiode voorbij is. Als je hulp nodig hebt, gebruik dan de hulpdiensten op deze pagina.',
  },
};

const supportLinksEn: LegalLink[] = [
  {
    label: 'Loket Kansspel (Netherlands)',
    href: 'https://www.loketkansspel.nl/',
    description: 'Official Dutch information and help for gambling problems.',
  },
  {
    label: 'GamCare (UK and international)',
    href: 'https://www.gamcare.org.uk/',
    description: 'Free, confidential advice and support for anyone affected by gambling.',
  },
  {
    label: 'BeGambleAware',
    href: 'https://www.begambleaware.org/',
    description: 'Information, self-assessment tools, and support options.',
  },
  {
    label: 'Gambling Therapy',
    href: 'https://www.gamblingtherapy.org/',
    description: 'Free practical advice and emotional support worldwide.',
  },
  {
    label: 'Gamblers Anonymous',
    href: 'https://www.gamblersanonymous.org/',
    description: 'Peer support meetings for people who want to stop gambling.',
  },
];

const supportLinksNl: LegalLink[] = [
  {
    label: 'Loket Kansspel (Nederland)',
    href: 'https://www.loketkansspel.nl/',
    description: 'Officiële Nederlandse informatie en hulp bij gokproblemen.',
  },
  {
    label: 'GamCare (VK en internationaal)',
    href: 'https://www.gamcare.org.uk/',
    description: 'Gratis en vertrouwelijk advies en steun voor iedereen die door gokken wordt geraakt.',
  },
  {
    label: 'BeGambleAware',
    href: 'https://www.begambleaware.org/',
    description: 'Informatie, zelftesten en mogelijkheden voor ondersteuning.',
  },
  {
    label: 'Gambling Therapy',
    href: 'https://www.gamblingtherapy.org/',
    description: 'Gratis praktisch advies en emotionele steun wereldwijd.',
  },
  {
    label: 'Gamblers Anonymous',
    href: 'https://www.gamblersanonymous.org/',
    description: 'Lotgenotenbijeenkomsten voor mensen die willen stoppen met gokken.',
  },
];

export const legalDocuments: Record<LegalPageKind, Record<LegalLocale, LegalDocument>> = {
  terms: {
    en: {
      title: 'Terms of Service',
      eyebrow: 'Legal agreement',
      intro:
        'These Terms govern your use of Donutcash, a website for entertainment with DonutSMP in-game currency. Please read them carefully before creating an account.',
      sections: [
        {
          id: 'about',
          title: '1. About these terms',
          paragraphs: [
            'These Terms of Service (the “Terms”) are a legal agreement between you and the operator of Donutcash (the “Operator”, “we”, “us”, or “our”). They apply to the website, games, Cashier, support desk, and every related service.',
            'By creating an account, accessing, or using Donutcash, you agree to these Terms and our Privacy Policy. If you do not agree, do not access or use the website.',
            'We may publish updated Terms from time to time. You must accept the new version before you can continue using your account.',
          ],
        },
        {
          id: 'eligibility',
          title: '2. Age and lawful use',
          paragraphs: [
            'You must be at least 18 years old, or older if the legal gambling age in your country is higher. You must also confirm that using Donutcash is lawful in the country from which you access it.',
            'You are responsible for checking and complying with your local laws. If you are underage, or if using Donutcash is unlawful where you are, you must not create an account or use the service.',
          ],
          bullets: [
            'You confirm your age and lawful access during registration and whenever a new version of these Terms is published.',
            'We may suspend or close accounts that we reasonably believe belong to a person who does not meet these requirements.',
            'We do not provide legal, tax, financial, or gambling advice.',
          ],
        },
        {
          id: 'affiliation',
          title: '3. No affiliation with DonutSMP, Mojang or Microsoft',
          paragraphs: [
            'This website is NOT affiliated with, endorsed by, approved by or connected to DonutSMP, Mojang or Microsoft.',
            'DonutSMP, Minecraft, Mojang, Microsoft, and their logos and trademarks belong to their respective owners. We do not claim any sponsorship, partnership, approval, or official status.',
            'You must not present Donutcash as an official DonutSMP, Mojang, or Microsoft service.',
          ],
        },
        {
          id: 'currency',
          title: '4. In-game currency only',
          paragraphs: [
            'Only in-game currency is used on Donutcash. Buying or selling this currency for real money is strictly prohibited and will not be permitted.',
            'DonutSMP money has no cash value, is not legal tender, and is not a financial instrument. You cannot deposit, withdraw, or exchange it for real money, goods, or services through Donutcash.',
            'Wagers, losses, and payouts are made solely in in-game currency. We do not promise that any in-game currency can be converted into anything of real-world value.',
          ],
        },
        {
          id: 'donutsmp-risk',
          title: '5. DonutSMP rules and account risk',
          paragraphs: [
            'Gambling with in-game currency may violate DonutSMP’s rules. Users may be banned as a result. Use of this website is entirely at the user’s own risk. The website owner is not responsible for bans, lost currency, lost items or lost accounts.',
            'You are solely responsible for understanding and following DonutSMP’s rules. We do not control DonutSMP, its moderation decisions, its economy, or your account there.',
            'You must not use Donutcash in a way that breaks DonutSMP’s rules, Minecraft’s terms, or any applicable law.',
          ],
        },
        {
          id: 'accounts',
          title: '6. Accounts and fair play',
          paragraphs: [
            'Provide accurate account information and keep your login details secure. You are responsible for activity carried out through your account.',
            'The following conduct is prohibited: cheating, exploiting bugs, using bots or unauthorised automation, multi-accounting, collusion, account sharing or selling, fraud, money laundering, abuse, harassment, and any attempt to interfere with the website, its games, or other users.',
          ],
          bullets: [
            'We may investigate suspected abuse using account, session, game, ledger, and audit records.',
            'Sanctions may include a warning, restriction, suspension, permanent account closure, voiding of wagers or payouts, and forfeiture of some or all in-game balances tied to the abuse.',
            'We may report serious fraud or unlawful activity to DonutSMP, hosting providers, payment providers, or the authorities.',
            'Sanctions are applied at our discretion and do not create a right to a refund or compensation.',
          ],
        },
        {
          id: 'cashier',
          title: '7. Deposits, withdrawals and Cashier requests',
          paragraphs: [
            'All requests to add or remove in-game currency must be submitted through the Cashier. Support tickets must not be used to request, approve, or adjust money.',
            'Every Cashier request is reviewed manually by an owner or administrator. We aim to review requests within 24 hours, but processing times are targets, not guarantees, and may be longer during busy periods, maintenance, or additional checks.',
            'We may refuse, cancel, reverse, or request more information about any request that appears suspicious, fraudulent, duplicate, inaccurate, abusive, unlawful, or inconsistent with these Terms. A withdrawal cannot exceed the available balance at the time of review.',
            'Approving a request creates a ledger entry and updates the in-game wallet. Cashier decisions are final, subject to correction of genuine errors and applicable law.',
          ],
        },
        {
          id: 'wagers',
          title: '8. Wagers, outcomes and payouts',
          paragraphs: [
            'Game outcomes and balances are settled by the server. You must not manipulate, reverse-engineer, or interfere with the games or their random-number generation.',
            'No guarantee is given regarding winnings, payouts or service availability. The service is provided “as is” and “as available”.',
            'We may correct errors, void affected wagers, adjust balances, or cancel games where a technical fault, configuration error, or abuse has occurred. We do not guarantee that a game will always be available or that a specific payout will be achieved.',
          ],
        },
        {
          id: 'availability',
          title: '9. Availability and changes to the service',
          paragraphs: [
            'We may change, suspend, or discontinue any part of Donutcash, including games, limits, features, and the Cashier, at any time. We may perform maintenance without prior notice.',
            'We do not warrant that the service will be uninterrupted, secure, timely, or error-free, or that defects will be corrected.',
          ],
        },
        {
          id: 'liability',
          title: '10. Limitation of liability',
          paragraphs: [
            'To the maximum extent permitted by law, we are not liable for indirect, incidental, special, consequential, or punitive damages, or for loss of profits, data, goodwill, in-game currency, items, accounts, or access.',
            'In particular, we are not responsible for DonutSMP bans, moderation decisions, lost currency, lost items, lost accounts, or losses caused by your breach of DonutSMP’s rules or applicable law.',
            'Nothing in these Terms excludes or limits liability that cannot lawfully be excluded or limited, including mandatory consumer rights.',
          ],
        },
        {
          id: 'self-exclusion',
          title: '11. Self-exclusion',
          paragraphs: [
            'You can block your own account from the Responsible play section of your settings. You may choose a 24-hour, 7-day, 30-day, or permanent exclusion.',
            'Self-exclusion takes effect immediately, signs you out of active sessions, and prevents you from signing in until the period ends. It cannot be lifted early. Self-exclusion does not delete your account, wallet, or history, and it does not cancel a pending review or investigation.',
            'If you need help beyond self-exclusion, use the support services listed on our Responsible Gambling page.',
          ],
        },
        {
          id: 'termination',
          title: '12. Suspension, closure and forfeiture',
          paragraphs: [
            'The owner reserves the right to close accounts and modify these terms and conditions.',
            'We may suspend or close your account, restrict access, or terminate the service if you breach these Terms, create risk for other users, or if we are required to do so by law. Where a breach involves cheating, fraud, multi-accounting, or abuse, we may forfeit associated in-game balances and void affected wagers or payouts.',
          ],
        },
        {
          id: 'changes',
          title: '13. Changes to these Terms',
          paragraphs: [
            'We may update these Terms to reflect changes in the service, legal requirements, or risk controls. The current version and effective date are shown at the top of this page.',
            'When we publish a new version, you must accept it before continuing to use Donutcash. If you do not accept, access to your account will remain blocked until you accept or close your account.',
          ],
        },
        {
          id: 'law',
          title: '14. Governing law and contact',
          paragraphs: [
            'These Terms are governed by the laws of the Netherlands. Disputes that cannot be resolved informally will be submitted to the competent courts of the Netherlands, without prejudice to any mandatory consumer protections that apply in your country of residence.',
            'Questions about these Terms can be submitted through the support desk in your account.',
          ],
        },
      ],
    },
    nl: {
      title: 'Servicevoorwaarden',
      eyebrow: 'Juridische overeenkomst',
      intro:
        'Deze voorwaarden gelden voor je gebruik van Donutcash, een website voor entertainment met DonutSMP in-game valuta. Lees ze zorgvuldig voordat je een account aanmaakt.',
      sections: [
        {
          id: 'about',
          title: '1. Over deze voorwaarden',
          paragraphs: [
            'Deze Servicevoorwaarden (de “Voorwaarden”) vormen een juridische overeenkomst tussen jou en de exploitant van Donutcash (de “Exploitant”, “wij”, “ons” of “onze”). Ze gelden voor de website, spellen, Cashier, supportdesk en alle gerelateerde diensten.',
            'Door een account aan te maken of Donutcash te bezoeken of te gebruiken, ga je akkoord met deze Voorwaarden en ons Privacybeleid. Als je niet akkoord gaat, mag je de website niet gebruiken.',
            'We kunnen deze Voorwaarden van tijd tot tijd bijwerken. Je moet de nieuwe versie accepteren voordat je je account kunt blijven gebruiken.',
          ],
        },
        {
          id: 'eligibility',
          title: '2. Leeftijd en rechtmatig gebruik',
          paragraphs: [
            'Je moet minimaal 18 jaar oud zijn, of ouder als de wettelijke gokleeftijd in jouw land hoger is. Je moet ook bevestigen dat het gebruik van Donutcash is toegestaan in het land van waaruit je toegang krijgt.',
            'Je bent zelf verantwoordelijk voor het controleren en naleven van je lokale wetgeving. Als je minderjarig bent, of als gebruik van Donutcash op jouw locatie onrechtmatig is, mag je geen account aanmaken of de dienst gebruiken.',
          ],
          bullets: [
            'Je bevestigt je leeftijd en rechtmatige toegang bij registratie en telkens wanneer een nieuwe versie van deze Voorwaarden wordt gepubliceerd.',
            'We kunnen accounts opschorten of sluiten waarvan we redelijkerwijs vermoeden dat de gebruiker niet aan deze eisen voldoet.',
            'We geven geen juridisch, fiscaal, financieel of gokadvies.',
          ],
        },
        {
          id: 'affiliation',
          title: '3. Geen verbinding met DonutSMP, Mojang of Microsoft',
          paragraphs: [
            'Deze website is NIET verbonden aan, goedgekeurd door of gelieerd aan DonutSMP, Mojang of Microsoft.',
            'DonutSMP, Minecraft, Mojang, Microsoft en hun logo’s en handelsmerken zijn eigendom van hun respectieve eigenaren. We claimen geen sponsoring, partnerschap, goedkeuring of officiële status.',
            'Je mag Donutcash niet presenteren als een officiële dienst van DonutSMP, Mojang of Microsoft.',
          ],
        },
        {
          id: 'currency',
          title: '4. Alleen in-game valuta',
          paragraphs: [
            'Op Donutcash wordt uitsluitend in-game valuta gebruikt. Het kopen of verkopen van deze valuta voor echt geld is strikt verboden en niet toegestaan.',
            'DonutSMP-money heeft geen geldwaarde, is geen wettig betaalmiddel en is geen financieel instrument. Je kunt via Donutcash geen echt geld, goederen of diensten storten, opnemen of uitwisselen.',
            'Inzetten, verliezen en uitbetalingen vinden uitsluitend plaats in in-game valuta. We beloven niet dat in-game valuta kan worden omgezet in iets met waarde in de echte wereld.',
          ],
        },
        {
          id: 'donutsmp-risk',
          title: '5. DonutSMP-regels en accountrisico',
          paragraphs: [
            'Gokken met in-game valuta kan in strijd zijn met de regels van DonutSMP. Gebruikers kunnen daardoor een ban krijgen. Gebruik van deze website is volledig op eigen risico. De eigenaar van de website is niet verantwoordelijk voor bans, verloren valuta, verloren items of verloren accounts.',
            'Je bent zelf verantwoordelijk voor het begrijpen en naleven van de regels van DonutSMP. Wij hebben geen controle over DonutSMP, hun moderatiebeslissingen, hun economie of jouw account daar.',
            'Je mag Donutcash niet gebruiken op een manier die de regels van DonutSMP, de voorwaarden van Minecraft of toepasselijke wetgeving schendt.',
          ],
        },
        {
          id: 'accounts',
          title: '6. Accounts en eerlijk spelen',
          paragraphs: [
            'Verstrek juiste accountgegevens en houd je inloggegevens veilig. Je bent verantwoordelijk voor activiteit via jouw account.',
            'De volgende gedragingen zijn verboden: valsspelen, misbruik maken van bugs, bots of ongeautoriseerde automatisering gebruiken, meerdere accounts gebruiken, samenspanning, accounts delen of verkopen, fraude, witwassen, misbruik, intimidatie en elke poging om de website, de spellen of andere gebruikers te verstoren.',
          ],
          bullets: [
            'We kunnen vermoedelijk misbruik onderzoeken met account-, sessie-, spel-, grootboek- en auditgegevens.',
            'Sancties kunnen bestaan uit een waarschuwing, beperking, schorsing, permanente sluiting van het account, het ongeldig verklaren van inzetten of uitbetalingen en het verbeuren van een deel of het geheel van de in-game saldi die met het misbruik verband houden.',
            'We kunnen ernstige fraude of onrechtmatige activiteit melden bij DonutSMP, hostingproviders, betaalproviders of de autoriteiten.',
            'Sancties worden naar ons goeddunken opgelegd en geven geen recht op terugbetaling of compensatie.',
          ],
        },
        {
          id: 'cashier',
          title: '7. Stortingen, opnames en Cashier-aanvragen',
          paragraphs: [
            'Alle aanvragen om in-game valuta toe te voegen of te verwijderen moeten via de Cashier worden ingediend. Supporttickets mogen niet worden gebruikt om geld aan te vragen, goed te keuren of aan te passen.',
            'Elke Cashier-aanvraag wordt handmatig beoordeeld door een eigenaar of beheerder. We streven ernaar aanvragen binnen 24 uur te beoordelen, maar verwerkingstijden zijn doelen en geen garanties. Het kan langer duren tijdens drukte, onderhoud of extra controles.',
            'We kunnen een aanvraag weigeren, annuleren, terugdraaien of om meer informatie vragen als deze verdacht, frauduleus, dubbel, onjuist, misbruikelijk, onrechtmatig of in strijd met deze Voorwaarden lijkt. Een opname mag niet hoger zijn dan het beschikbare saldo op het moment van beoordeling.',
            'Goedkeuring van een aanvraag leidt tot een grootboekregel en werkt de in-game wallet bij. Cashier-beslissingen zijn definitief, behoudens correctie van echte fouten en toepasselijk recht.',
          ],
        },
        {
          id: 'wagers',
          title: '8. Inzetten, uitkomsten en uitbetalingen',
          paragraphs: [
            'Speluitkomsten en saldi worden door de server vastgesteld. Je mag de spellen of hun randomnummergenerator niet manipuleren, reverse-engineeren of verstoren.',
            'Er wordt geen garantie gegeven met betrekking tot winsten, uitbetalingen of beschikbaarheid van de dienst. De dienst wordt geleverd “as is” en “as available”.',
            'We kunnen fouten corrigeren, getroffen inzetten ongeldig verklaren, saldi aanpassen of spellen annuleren bij een technische fout, configuratiefout of misbruik. We garanderen niet dat een spel altijd beschikbaar is of dat een bepaalde uitbetaling wordt behaald.',
          ],
        },
        {
          id: 'availability',
          title: '9. Beschikbaarheid en wijzigingen van de dienst',
          paragraphs: [
            'We kunnen elk onderdeel van Donutcash op elk moment wijzigen, opschorten of stopzetten, inclusief spellen, limieten, functies en de Cashier. We kunnen onderhoud uitvoeren zonder voorafgaande kennisgeving.',
            'We garanderen niet dat de dienst ononderbroken, veilig, tijdig of foutloos is, of dat gebreken worden verholpen.',
          ],
        },
        {
          id: 'liability',
          title: '10. Beperking van aansprakelijkheid',
          paragraphs: [
            'Voor zover wettelijk toegestaan zijn wij niet aansprakelijk voor indirecte, incidentele, bijzondere, gevolg- of punitieve schade, of voor verlies van winst, gegevens, goodwill, in-game valuta, items, accounts of toegang.',
            'We zijn in het bijzonder niet verantwoordelijk voor bans van DonutSMP, moderatiebeslissingen, verloren valuta, verloren items, verloren accounts of verliezen door jouw schending van de regels van DonutSMP of toepasselijk recht.',
            'Niets in deze Voorwaarden sluit aansprakelijkheid uit of beperkt deze die wettelijk niet kan worden uitgesloten of beperkt, inclusief dwingende consumentenrechten.',
          ],
        },
        {
          id: 'self-exclusion',
          title: '11. Zelfuitsluiting',
          paragraphs: [
            'Je kunt je eigen account blokkeren via het onderdeel Verantwoord spelen in je instellingen. Je kunt kiezen voor 24 uur, 7 dagen, 30 dagen of een permanente uitsluiting.',
            'Zelfuitsluiting gaat onmiddellijk in, logt je uit actieve sessies en voorkomt dat je kunt inloggen tot de periode voorbij is. De uitsluiting kan niet eerder worden opgeheven. Zelfuitsluiting verwijdert je account, wallet of geschiedenis niet en annuleert geen lopende beoordeling of onderzoek.',
            'Als je meer hulp nodig hebt dan zelfuitsluiting, gebruik dan de hulpdiensten op onze pagina Verantwoord spelen.',
          ],
        },
        {
          id: 'termination',
          title: '12. Schorsing, sluiting en verbeurdverklaring',
          paragraphs: [
            'De eigenaar behoudt zich het recht voor accounts te sluiten en deze voorwaarden te wijzigen.',
            'We kunnen je account opschorten of sluiten, toegang beperken of de dienst beëindigen als je deze Voorwaarden schendt, een risico voor andere gebruikers vormt of als de wet ons daartoe verplicht. Bij schending door valsspelen, fraude, meerdere accounts of misbruik kunnen we bijbehorende in-game saldi verbeurd verklaren en getroffen inzetten of uitbetalingen ongeldig maken.',
          ],
        },
        {
          id: 'changes',
          title: '13. Wijzigingen van deze Voorwaarden',
          paragraphs: [
            'We kunnen deze Voorwaarden bijwerken om wijzigingen in de dienst, wettelijke eisen of risicobeheersing weer te geven. De actuele versie en ingangsdatum staan bovenaan deze pagina.',
            'Wanneer we een nieuwe versie publiceren, moet je deze accepteren voordat je Donutcash blijft gebruiken. Als je niet accepteert, blijft de toegang tot je account geblokkeerd tot je accepteert of je account sluit.',
          ],
        },
        {
          id: 'law',
          title: '14. Toepasselijk recht en contact',
          paragraphs: [
            'Deze Voorwaarden worden beheerst door het recht van Nederland. Geschillen die niet in onderling overleg kunnen worden opgelost, worden voorgelegd aan de bevoegde rechtbanken in Nederland, met inachtneming van dwingende consumentenbescherming in je woonland.',
            'Vragen over deze Voorwaarden kun je indienen via de supportdesk in je account.',
          ],
        },
      ],
    },
  },
  privacy: {
    en: {
      title: 'Privacy Policy',
      eyebrow: 'Your data and your rights',
      intro:
        'This policy explains what data Donutcash collects, why we collect it, how long we keep it, and how you can request access or deletion.',
      sections: [
        {
          id: 'controller',
          title: '1. Who is responsible for your data',
          paragraphs: [
            'The operator of Donutcash is the data controller for the personal data described in this policy.',
            'Privacy questions and requests can be submitted through the support desk in your account.',
          ],
        },
        {
          id: 'data',
          title: '2. What data we store',
          bullets: [
            'Minecraft username and account profile: the username you choose, account status, role, and account timestamps. This identifies your account and lets us operate the service and support desk.',
            'Email address and password hash: your email for sign-in, account recovery, security notices, and optional notifications. We store a salted password hash, never your plaintext password.',
            'IP address: collected when you register, sign in, accept legal terms, use security features, or perform audited actions. It is used for security, abuse prevention, rate limiting, and evidence of consent.',
            'Support tickets and messages: the subject, description, replies, internal notes, decisions, and attached account context needed to resolve your request.',
            'Game, wallet, and ledger records: wagers, outcomes, payouts, balances, Cashier requests, and related transaction history. These records keep the economy consistent and let us investigate disputes.',
            'Technical and audit logs: session records, browser/user-agent data, device and security events, administrator actions, and audit metadata. These protect the service and provide accountability.',
            'Legal acceptance records: the Terms and Privacy Policy versions you accepted, the acceptance timestamp, your IP address, and the browser user agent.',
            'Self-exclusion records: the start and end of a self-exclusion, the reason you optionally provide, and related audit information. These are used to enforce the block.',
            'Notification and email delivery metadata: in-app notifications, delivery status, retry information, and the address used for service emails.',
          ],
          paragraphs: [
            'We do not ask for your Mojang or Microsoft password. Do not send passwords, payment card details, or government identity documents through a support ticket unless we specifically request a secure method.',
          ],
        },
        {
          id: 'why',
          title: '3. Why we use your data',
          paragraphs: [
            'We process personal data to create and secure your account, provide the games and Cashier, maintain wallet and ledger integrity, answer support requests, prevent fraud and abuse, enforce self-exclusion, comply with legal obligations, and send service or security messages.',
            'Depending on the processing, our legal bases are performance of our contract with you, compliance with legal obligations, our legitimate interests in security and fraud prevention, your consent where required, and the establishment or defence of legal claims.',
          ],
        },
        {
          id: 'retention',
          title: '4. How long we keep data',
          bullets: [
            'Minecraft username and account profile: while your account is active, then up to 30 days after closure.',
            'Email address and password hash: while your account is active, then up to 30 days after closure. Encrypted backups may take up to 30 additional days to expire.',
            'IP address, session and device data: up to 90 days for session and security logs; up to 24 months for audit and fraud-prevention records.',
            'Support tickets and messages: up to 24 months after the ticket’s last activity.',
            'Game, wallet, ledger, and Cashier records: up to 7 years where needed for financial integrity, dispute resolution, or legal obligations.',
            'Legal acceptance records: for the life of the account plus up to 7 years, to demonstrate consent and compliance.',
            'Self-exclusion records: for the exclusion period plus up to 2 years after it ends.',
            'Notification and email delivery metadata: up to 12 months, and delivery provider logs up to 90 days.',
          ],
          paragraphs: [
            'When a retention period ends, we delete or anonymise the data. We may keep limited records longer where the law requires it, or where necessary to establish, exercise, or defend legal claims.',
          ],
        },
        {
          id: 'cookies',
          title: '5. Cookies and local storage',
          paragraphs: [
            'We use a strictly necessary session cookie to keep you signed in and to protect requests against cross-site forgery. We may use browser local storage for preferences such as sound settings.',
            'We do not use advertising cookies, sell audience data, or run third-party behavioural advertising on Donutcash. If analytics or additional cookies are added later, this policy and the consent flow must be updated first.',
          ],
        },
        {
          id: 'sharing',
          title: '6. Sharing and processors',
          paragraphs: [
            'We do not sell your personal data. We share it only with service providers that help us operate Donutcash, such as hosting and infrastructure providers and, when email delivery is enabled, our email delivery provider (currently Brevo). These providers process data on our instructions and under appropriate safeguards.',
            'We may also disclose data when required by law, to respond to lawful requests, to protect our rights or the safety of users, to investigate fraud or abuse, or in connection with a reorganisation or transfer of the service.',
          ],
        },
        {
          id: 'security',
          title: '7. Security',
          paragraphs: [
            'We use salted password hashing, httpOnly session cookies, CSRF protection, access controls, rate limiting, and append-only ledger and audit records. No internet service can be completely secure, so please use a unique password and protect your email account.',
          ],
        },
        {
          id: 'rights',
          title: '8. Your privacy rights',
          paragraphs: [
            'Depending on your location, you may have the right to access, correct, delete, restrict, or object to processing of your personal data, and to receive a portable copy. You may withdraw consent at any time where processing is based on consent; this does not affect processing that already happened.',
            'You can also lodge a complaint with your local supervisory authority. In the Netherlands this is the Autoriteit Persoonsgegevens. We would appreciate the chance to address your concern first.',
          ],
        },
        {
          id: 'deletion',
          title: '9. How to request deletion',
          paragraphs: [
            'Submit a deletion request through the support desk in your account. We may ask for information to verify that the request comes from the account holder.',
            'We aim to respond within 30 days. We will delete or anonymise data that we are not required to keep. We may retain records needed for legal obligations, ledger integrity, fraud prevention, dispute resolution, security, or an active self-exclusion. We will explain any retained category and the reason.',
          ],
        },
        {
          id: 'children',
          title: '10. Children',
          paragraphs: [
            'Donutcash is strictly for adults aged 18 or older (or the higher legal gambling age in their country). We do not knowingly collect data from children. If you believe a minor has created an account, contact us so we can investigate and close it.',
          ],
        },
        {
          id: 'transfers',
          title: '11. International transfers',
          paragraphs: [
            'Our service providers may process data outside your country. Where required, we use contractual safeguards and other lawful transfer mechanisms. Contact us for more information about the safeguards that apply to your data.',
          ],
        },
        {
          id: 'changes',
          title: '12. Changes to this policy',
          paragraphs: [
            'We may update this policy when the service or legal requirements change. The current version and date are shown at the top of this page. If the change is material, we will ask you to review and accept the updated Terms and Privacy Policy before continuing to use Donutcash.',
          ],
        },
        {
          id: 'contact',
          title: '13. Contact',
          paragraphs: [
            'For privacy questions, access requests, corrections, or deletion requests, use the support desk in your account.',
          ],
        },
      ],
    },
    nl: {
      title: 'Privacybeleid',
      eyebrow: 'Jouw gegevens en rechten',
      intro:
        'Dit beleid legt uit welke gegevens Donutcash verzamelt, waarom we ze verzamelen, hoe lang we ze bewaren en hoe je inzage of verwijdering kunt aanvragen.',
      sections: [
        {
          id: 'controller',
          title: '1. Wie is verantwoordelijk voor je gegevens',
          paragraphs: [
            'De exploitant van Donutcash is de verwerkingsverantwoordelijke voor de persoonsgegevens die in dit beleid worden beschreven.',
            'Vragen en verzoeken over privacy kun je indienen via de supportdesk in je account.',
          ],
        },
        {
          id: 'data',
          title: '2. Welke gegevens we bewaren',
          bullets: [
            'Minecraft-gebruikersnaam en accountprofiel: de gekozen gebruikersnaam, accountstatus, rol en accounttijdstippen. Hiermee identificeren we je account en kunnen we de dienst en supportdesk uitvoeren.',
            'E-mailadres en wachtwoordhash: je e-mailadres voor inloggen, accountherstel, beveiligingsmeldingen en optionele notificaties. We bewaren een gezouten wachtwoordhash, nooit je wachtwoord in leesbare vorm.',
            'IP-adres: verzameld bij registratie, inloggen, acceptatie van juridische voorwaarden, gebruik van beveiligingsfuncties en geauditeerde acties. Het wordt gebruikt voor beveiliging, misbruikpreventie, snelheidslimieten en bewijs van toestemming.',
            'Supporttickets en berichten: onderwerp, beschrijving, antwoorden, interne notities, beslissingen en bijbehorende accountcontext die nodig is om je verzoek af te handelen.',
            'Spel-, wallet- en grootboekgegevens: inzetten, uitkomsten, uitbetalingen, saldi, Cashier-aanvragen en gerelateerde transactiegeschiedenis. Deze gegevens houden de economie consistent en helpen bij het onderzoeken van geschillen.',
            'Technische en auditlogbestanden: sessiegegevens, browser/user-agent, apparaat- en beveiligingsgebeurtenissen, acties van beheerders en auditmetadata. Deze beschermen de dienst en zorgen voor verantwoording.',
            'Registraties van juridische acceptatie: de versies van de Servicevoorwaarden en het Privacybeleid die je hebt geaccepteerd, het tijdstip van acceptatie, je IP-adres en de user-agent van je browser.',
            'Zelfuitsluitingsgegevens: begin en einde van een zelfuitsluiting, de optionele reden en bijbehorende auditinformatie. Deze gegevens worden gebruikt om de blokkade te handhaven.',
            'Metadata over meldingen en e-mailbezorging: in-app meldingen, bezorgstatus, informatie over nieuwe pogingen en het adres dat voor service-e-mails wordt gebruikt.',
          ],
          paragraphs: [
            'We vragen niet om je Mojang- of Microsoft-wachtwoord. Stuur geen wachtwoorden, betaalkaartgegevens of overheidsidentiteitsbewijzen via een supportticket, tenzij we specifiek om een veilige methode vragen.',
          ],
        },
        {
          id: 'why',
          title: '3. Waarom we je gegevens gebruiken',
          paragraphs: [
            'We verwerken persoonsgegevens om je account aan te maken en te beveiligen, de spellen en Cashier te leveren, de integriteit van wallet en grootboek te bewaren, supportverzoeken te beantwoorden, fraude en misbruik te voorkomen, zelfuitsluiting te handhaven, aan wettelijke verplichtingen te voldoen en service- of beveiligingsberichten te sturen.',
            'Afhankelijk van de verwerking zijn onze rechtsgronden: uitvoering van onze overeenkomst met jou, naleving van wettelijke verplichtingen, onze gerechtvaardigde belangen bij beveiliging en fraudepreventie, jouw toestemming waar vereist, en het instellen of verdedigen van juridische claims.',
          ],
        },
        {
          id: 'retention',
          title: '4. Hoe lang we gegevens bewaren',
          bullets: [
            'Minecraft-gebruikersnaam en accountprofiel: zolang je account actief is, daarna maximaal 30 dagen na sluiting.',
            'E-mailadres en wachtwoordhash: zolang je account actief is, daarna maximaal 30 dagen na sluiting. Versleutelde back-ups kunnen tot 30 extra dagen nodig hebben om te verlopen.',
            'IP-adres, sessie- en apparaatgegevens: maximaal 90 dagen voor sessie- en beveiligingslogbestanden; maximaal 24 maanden voor audit- en fraudepreventiegegevens.',
            'Supporttickets en berichten: maximaal 24 maanden na de laatste activiteit van het ticket.',
            'Spel-, wallet-, grootboek- en Cashier-gegevens: maximaal 7 jaar waar nodig voor financiële integriteit, geschilbeslechting of wettelijke verplichtingen.',
            'Registraties van juridische acceptatie: zolang het account bestaat plus maximaal 7 jaar, om toestemming en naleving aan te tonen.',
            'Zelfuitsluitingsgegevens: tijdens de uitsluitingsperiode plus maximaal 2 jaar daarna.',
            'Metadata over meldingen en e-mailbezorging: maximaal 12 maanden, en logbestanden van de bezorgprovider maximaal 90 dagen.',
          ],
          paragraphs: [
            'Wanneer een bewaartermijn eindigt, verwijderen of anonimiseren we de gegevens. We kunnen beperkte gegevens langer bewaren als de wet dat vereist of als dat nodig is om juridische claims in te stellen, uit te oefenen of te verdedigen.',
          ],
        },
        {
          id: 'cookies',
          title: '5. Cookies en lokale opslag',
          paragraphs: [
            'We gebruiken een strikt noodzakelijke sessiecookie om je ingelogd te houden en verzoeken te beschermen tegen cross-site request forgery. We kunnen lokale browseropslag gebruiken voor voorkeuren zoals geluidsinstellingen.',
            'We gebruiken geen advertentiecookies, verkopen geen publieksgegevens en voeren op Donutcash geen gedragsgerichte advertenties van derden uit. Als later analytics of extra cookies worden toegevoegd, moeten dit beleid en de toestemmingsflow eerst worden bijgewerkt.',
          ],
        },
        {
          id: 'sharing',
          title: '6. Delen en verwerkers',
          paragraphs: [
            'We verkopen je persoonsgegevens niet. We delen ze alleen met dienstverleners die ons helpen Donutcash te exploiteren, zoals hosting- en infrastructuurproviders en, wanneer e-mailbezorging is ingeschakeld, onze e-mailprovider (momenteel Brevo). Deze providers verwerken gegevens volgens onze instructies en onder passende waarborgen.',
            'We kunnen gegevens ook verstrekken wanneer de wet dat vereist, om te reageren op rechtmatige verzoeken, om onze rechten of de veiligheid van gebruikers te beschermen, om fraude of misbruik te onderzoeken, of in verband met een reorganisatie of overdracht van de dienst.',
          ],
        },
        {
          id: 'security',
          title: '7. Beveiliging',
          paragraphs: [
            'We gebruiken gezouten wachtwoordhashing, httpOnly-sessiecookies, CSRF-bescherming, toegangscontroles, snelheidslimieten en append-only grootboek- en auditregistraties. Geen enkele internetdienst is volledig veilig; gebruik daarom een uniek wachtwoord en bescherm je e-mailaccount.',
          ],
        },
        {
          id: 'rights',
          title: '8. Je privacyrechten',
          paragraphs: [
            'Afhankelijk van je locatie heb je het recht op inzage, correctie, verwijdering, beperking van of bezwaar tegen de verwerking van je persoonsgegevens, en op een overdraagbare kopie. Je kunt toestemming op elk moment intrekken wanneer de verwerking op toestemming is gebaseerd; dit tast verwerkingen die al hebben plaatsgevonden niet aan.',
            'Je kunt ook een klacht indienen bij je lokale toezichthouder. In Nederland is dat de Autoriteit Persoonsgegevens. We stellen het op prijs als je je zorg eerst met ons probeert op te lossen.',
          ],
        },
        {
          id: 'deletion',
          title: '9. Hoe je verwijdering aanvraagt',
          paragraphs: [
            'Dien een verwijderverzoek in via de supportdesk in je account. We kunnen informatie vragen om te controleren of het verzoek van de accounthouder afkomstig is.',
            'We streven ernaar binnen 30 dagen te reageren. We verwijderen of anonimiseren gegevens die we niet hoeven te bewaren. We kunnen gegevens bewaren die nodig zijn voor wettelijke verplichtingen, grootboekintegriteit, fraudepreventie, geschilbeslechting, beveiliging of een actieve zelfuitsluiting. We leggen uit welke categorie wordt bewaard en waarom.',
          ],
        },
        {
          id: 'children',
          title: '10. Minderjarigen',
          paragraphs: [
            'Donutcash is uitsluitend bedoeld voor volwassenen van 18 jaar of ouder (of de hogere wettelijke gokleeftijd in hun land). We verzamelen niet bewust gegevens van minderjarigen. Als je vermoedt dat een minderjarige een account heeft aangemaakt, neem dan contact op zodat we dit kunnen onderzoeken en het account kunnen sluiten.',
          ],
        },
        {
          id: 'transfers',
          title: '11. Internationale doorgifte',
          paragraphs: [
            'Onze dienstverleners kunnen gegevens buiten je land verwerken. Waar vereist, gebruiken we contractuele waarborgen en andere rechtmatige doorgiftemechanismen. Neem contact op voor meer informatie over de waarborgen die op jouw gegevens van toepassing zijn.',
          ],
        },
        {
          id: 'changes',
          title: '12. Wijzigingen van dit beleid',
          paragraphs: [
            'We kunnen dit beleid bijwerken wanneer de dienst of wettelijke eisen veranderen. De actuele versie en datum staan bovenaan deze pagina. Bij een materiële wijziging vragen we je de bijgewerkte Servicevoorwaarden en het Privacybeleid te bekijken en te accepteren voordat je Donutcash blijft gebruiken.',
          ],
        },
        {
          id: 'contact',
          title: '13. Contact',
          paragraphs: [
            'Voor privacyvragen, inzageverzoeken, correcties of verwijderverzoeken gebruik je de supportdesk in je account.',
          ],
        },
      ],
    },
  },
  'responsible-gambling': {
    en: {
      title: 'Responsible Gambling',
      eyebrow: 'Play for fun, not for survival',
      intro:
        'Donutcash uses in-game currency only, but gambling behaviour can still become harmful. This page explains how to keep play under control and where to find help.',
      sections: [
        {
          id: 'important',
          title: '1. Important information',
          paragraphs: [
            'Donutcash is an entertainment service for adults aged 18 or older (or the higher legal gambling age in their country). In-game currency has no real-world cash value, but the time and attention you spend can still matter.',
            'Gambling with in-game currency may violate DonutSMP’s rules and can lead to a ban. You use this website entirely at your own risk. Never gamble with money you cannot afford to lose, and never buy in-game currency with real money.',
          ],
        },
        {
          id: 'tips',
          title: '2. Responsible gaming tips',
          bullets: [
            'Decide before you play how much time and in-game currency you will use, and stop when you reach that limit.',
            'Treat losses as entertainment costs. Do not chase losses by increasing wagers or playing longer.',
            'Take regular breaks. Stop if you feel stressed, frustrated, tired, intoxicated, or under pressure.',
            'Keep gambling separate from important responsibilities such as school, work, sleep, relationships, and real-world spending.',
            'Do not borrow money, sell belongings, or trade real money for in-game currency to keep playing.',
            'Never let another person play on your account, and do not pressure friends or family to gamble.',
            'Use the self-exclusion option if you need a firm break. It is better to stop early than to keep chasing a different outcome.',
          ],
        },
        {
          id: 'warning-signs',
          title: '3. Warning signs',
          paragraphs: [
            'Gambling may be becoming a problem if you recognise one or more of the following:',
          ],
          bullets: [
            'You spend more time or in-game currency than you planned, or you keep increasing your bets.',
            'You think about gambling constantly or feel restless when you cannot play.',
            'You chase losses, hide your play, or lie about how much you have wagered.',
            'Gambling affects your mood, sleep, studies, work, relationships, or finances.',
            'You feel unable to stop, or you return to gambling after deciding to stop.',
          ],
        },
        {
          id: 'help',
          title: '4. If you need help',
          paragraphs: [
            'Pause your account and speak to someone you trust. You do not have to deal with gambling harm alone. If you are in immediate danger or feel unable to keep yourself safe, contact your local emergency services.',
            'The organisations below provide free, confidential information and support. They are independent from Donutcash. Availability and languages vary by country.',
          ],
          links: supportLinksEn,
        },
        {
          id: 'self-exclusion',
          title: '5. Self-exclusion',
          paragraphs: [
            'You can block your own account from Settings → Responsible play. Choose a 24-hour, 7-day, 30-day, or permanent block.',
            'Self-exclusion takes effect immediately and signs you out. The block cannot be lifted early. It applies to the account you are signed into; it is not a substitute for professional treatment or emergency help.',
            'Sign in and open Settings → Responsible play → Self-exclude my account, or contact support if you cannot access your account.',
          ],
        },
        {
          id: 'friends',
          title: '6. For friends and family',
          paragraphs: [
            'If someone you know is struggling with gambling, listen without judgement and encourage them to use the support services above. Do not lend money for gambling or try to win back losses on their behalf. Professional services can also advise family members and friends.',
          ],
        },
      ],
    },
    nl: {
      title: 'Verantwoord spelen',
      eyebrow: 'Speel voor plezier, niet om te overleven',
      intro:
        'Donutcash gebruikt alleen in-game valuta, maar gokgedrag kan nog steeds schadelijk worden. Deze pagina legt uit hoe je het spelen onder controle houdt en waar je hulp kunt vinden.',
      sections: [
        {
          id: 'important',
          title: '1. Belangrijke informatie',
          paragraphs: [
            'Donutcash is een entertainmentservice voor volwassenen van 18 jaar of ouder (of de hogere wettelijke gokleeftijd in hun land). In-game valuta heeft geen geldwaarde in de echte wereld, maar de tijd en aandacht die je eraan besteedt kunnen wel belangrijk zijn.',
            'Gokken met in-game valuta kan in strijd zijn met de regels van DonutSMP en tot een ban leiden. Je gebruikt deze website volledig op eigen risico. Gok nooit met geld dat je niet kunt missen en koop nooit in-game valuta met echt geld.',
          ],
        },
        {
          id: 'tips',
          title: '2. Tips voor verantwoord spelen',
          bullets: [
            'Bepaal vóór je speelt hoeveel tijd en in-game valuta je gebruikt, en stop wanneer je die limiet bereikt.',
            'Zie verliezen als kosten voor entertainment. Jaag geen verliezen na door hoger in te zetten of langer te spelen.',
            'Neem regelmatig pauzes. Stop als je gestrest, gefrustreerd, moe, onder invloed of onder druk bent.',
            'Houd gokken gescheiden van belangrijke verantwoordelijkheden zoals school, werk, slaap, relaties en uitgaven in de echte wereld.',
            'Leen geen geld, verkoop geen bezittingen en ruil geen echt geld voor in-game valuta om door te spelen.',
            'Laat nooit iemand anders op je account spelen en zet vrienden of familie niet onder druk om te gokken.',
            'Gebruik de zelfuitsluiting als je een duidelijke pauze nodig hebt. Beter vroeg stoppen dan blijven jagen op een andere uitkomst.',
          ],
        },
        {
          id: 'warning-signs',
          title: '3. Waarschuwingstekens',
          paragraphs: [
            'Gokken kan een probleem worden als je een of meer van de volgende signalen herkent:',
          ],
          bullets: [
            'Je besteedt meer tijd of in-game valuta dan gepland, of je verhoogt je inzetten steeds.',
            'Je denkt voortdurend aan gokken of voelt je onrustig als je niet kunt spelen.',
            'Je jaagt verliezen na, verbergt je spel of liegt over hoeveel je hebt ingezet.',
            'Gokken beïnvloedt je humeur, slaap, studie, werk, relaties of financiën.',
            'Je voelt je niet in staat om te stoppen, of je begint opnieuw nadat je besloot te stoppen.',
          ],
        },
        {
          id: 'help',
          title: '4. Als je hulp nodig hebt',
          paragraphs: [
            'Pauzeer je account en praat met iemand die je vertrouwt. Je hoeft gokschade niet alleen te dragen. Als je in direct gevaar bent of jezelf niet veilig kunt houden, neem dan contact op met de lokale hulpdiensten.',
            'De onderstaande organisaties bieden gratis en vertrouwelijke informatie en ondersteuning. Ze zijn onafhankelijk van Donutcash. Beschikbaarheid en talen verschillen per land.',
          ],
          links: supportLinksNl,
        },
        {
          id: 'self-exclusion',
          title: '5. Zelfuitsluiting',
          paragraphs: [
            'Je kunt je eigen account blokkeren via het onderdeel Verantwoord spelen in je instellingen. Kies een blokkade van 24 uur, 7 dagen, 30 dagen of permanent.',
            'Zelfuitsluiting gaat onmiddellijk in en logt je uit. De blokkade kan niet eerder worden opgeheven. De blokkade geldt voor het account waarmee je bent ingelogd; het is geen vervanging voor professionele behandeling of spoedeisende hulp.',
            'Log in en open Instellingen → Verantwoord spelen → Zelfuitsluiting starten, of neem contact op met support als je geen toegang hebt tot je account.',
          ],
        },
        {
          id: 'friends',
          title: '6. Voor vrienden en familie',
          paragraphs: [
            'Als iemand die je kent moeite heeft met gokken, luister dan zonder oordeel en moedig diegene aan de bovenstaande hulpdiensten te gebruiken. Leen geen geld voor gokken en probeer niet namens diegene verliezen terug te winnen. Professionele diensten kunnen ook vrienden en familie adviseren.',
          ],
        },
      ],
    },
  },
};

export function getLegalDocument(kind: LegalPageKind, locale: LegalLocale): LegalDocument {
  return legalDocuments[kind][locale];
}

export const legalVersions = {
  terms: LEGAL_TERMS_VERSION,
  privacy: LEGAL_PRIVACY_VERSION,
};
