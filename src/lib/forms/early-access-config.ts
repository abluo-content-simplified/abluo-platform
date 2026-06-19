/**
 * Early Access Form — localized messages
 *
 * Single source of truth for all user-facing text in the Early Access form.
 *
 * ARCHITECTURE NOTE — localization readiness
 * ─────────────────────────────────────────────────────────────────────────────
 * All strings are keyed by locale here. Components never import string
 * literals directly — they call getEarlyAccessMessages(locale) and receive
 * a fully-typed EarlyAccessMessages object.
 *
 * When a `form` Sanity document type is eventually built, or when next-intl
 * message files are extended, replace getEarlyAccessMessages() with a
 * CMS/i18n fetch — components need zero changes.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * TODO [COPY REVIEW — EN]: review and finalize English copy before launch.
 * TODO [COPY REVIEW — IT]: review and finalize Italian translations before launch.
 * TODO [LEGAL REVIEW]: GDPR consent text must be reviewed by legal before launch.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EarlyAccessOptionItem {
  value: string
  label: string
}

export interface EarlyAccessMessages {
  // ── Modal chrome ──────────────────────────────────────────────────────────
  modalTitle: string

  // ── Progress labels ───────────────────────────────────────────────────────
  /** Short name shown in step header, e.g. "Contact" */
  step1Name: string
  step2Name: string
  step3Name: string
  /** e.g. "Step 1 of 3" */
  stepOfLabel: (current: number, total: number) => string

  // ── Step 1 — Contact ──────────────────────────────────────────────────────
  step1Title: string
  step1Subtitle: string
  nameLabel: string
  namePlaceholder: string
  emailLabel: string
  emailPlaceholder: string
  step1SubmitLabel: string

  // ── Step 2 — Your Organisation ────────────────────────────────────────────
  step2Title: string
  step2Subtitle: string
  organizationLabel: string
  organizationPlaceholder: string
  roleLabel: string
  roleOptions: EarlyAccessOptionItem[]
  orgTypeLabel: string
  orgTypePlaceholder: string
  orgTypeOptions: EarlyAccessOptionItem[]
  step2NextLabel: string

  // ── Step 3 — Streaming Needs ──────────────────────────────────────────────
  step3Title: string
  step3Subtitle: string
  useCasesLabel: string
  useCasesHelpText: string
  useCaseOptions: EarlyAccessOptionItem[]
  audienceSizeLabel: string
  audienceSizePlaceholder: string
  audienceSizeOptions: EarlyAccessOptionItem[]
  websiteLabel: string
  websitePlaceholder: string
  referralSourceLabel: string
  referralSourcePlaceholder: string
  referralOptions: EarlyAccessOptionItem[]
  gdprFieldLabel: string
  /** Full GDPR consent text. TODO [LEGAL REVIEW] before launch. */
  gdprConsentText: string
  step3SubmitLabel: string

  // ── Shared ────────────────────────────────────────────────────────────────
  submittingLabel: string
  backLabel: string
  closeLabel: string

  // ── Success state ─────────────────────────────────────────────────────────
  successTitle: string
  /** Called with the submitter's name. */
  successBody: (name: string) => string
  successCloseLabel: string

  // ── Footer CTA mini-form ──────────────────────────────────────────────────
  footerNamePlaceholder: string
  footerEmailPlaceholder: string
  footerCtaLabel: string

  // ── Error messages ────────────────────────────────────────────────────────
  nameRequiredError: string
  emailRequiredError: string
  emailInvalidError: string
  submitError: string
  roleRequiredError: string
  orgTypeRequiredError: string
}

// ─── English ──────────────────────────────────────────────────────────────────

const en: EarlyAccessMessages = {
  modalTitle: 'Request Early Access',

  step1Name: 'Contact',
  step2Name: 'Your Organisation',
  step3Name: 'Streaming Needs',
  stepOfLabel: (current, total) => `Step ${current} of ${total}`,

  step1Title: "Let's get started",
  step1Subtitle: "We'll send you updates and reach out as soon as we're ready.",
  nameLabel: 'Full Name',
  namePlaceholder: 'Your name',
  emailLabel: 'Email Address',
  emailPlaceholder: 'you@example.com',
  step1SubmitLabel: 'Continue',

  step2Title: 'About your organisation',
  step2Subtitle: 'Tell us who you are so we can match you with the right plan.',
  organizationLabel: 'Organisation Name',
  organizationPlaceholder: 'Your organisation',
  roleLabel: 'Your Role',
  roleOptions: [
    { value: 'founder',     label: 'Founder / Owner' },
    { value: 'manager',     label: 'Manager' },
    { value: 'marketing',   label: 'Marketing / Communications' },
    { value: 'organizer',   label: 'Event Organizer' },
    { value: 'technical',   label: 'Technical / IT' },
    { value: 'production',  label: 'Production / Media' },
    { value: 'consultant',  label: 'Consultant' },
    { value: 'other',       label: 'Other' },
  ],
  orgTypeLabel: 'Organisation Type',
  orgTypePlaceholder: 'Select type…',
  orgTypeOptions: [
    { value: 'individual',  label: 'Individual' },
    { value: 'association', label: 'Association / Non-profit' },
    { value: 'company',     label: 'Company' },
    { value: 'agency',      label: 'Agency' },
    { value: 'school',      label: 'School / Education' },
    { value: 'sports_club', label: 'Sports Club' },
    { value: 'religious',   label: 'Religious Organisation' },
    { value: 'venue',       label: 'Venue' },
    { value: 'other',       label: 'Other' },
  ],
  step2NextLabel: 'Continue',

  step3Title: 'Your streaming needs',
  step3Subtitle: 'This helps us prepare the right setup for you.',
  useCasesLabel: 'What would you like to stream?',
  useCasesHelpText: 'Select all that apply',
  useCaseOptions: [
    { value: 'religious',    label: 'Religious Services' },
    { value: 'sports',       label: 'Sports Events' },
    { value: 'concerts',     label: 'Concerts & Live Music' },
    { value: 'conferences',  label: 'Conferences & Seminars' },
    { value: 'education',    label: 'Education & Training' },
    { value: 'community',    label: 'Community Events' },
    { value: 'corporate',    label: 'Corporate Events' },
    { value: 'festivals',    label: 'Festivals' },
    { value: 'theatre',      label: 'Theatre & Performances' },
    { value: 'weddings',     label: 'Weddings & Ceremonies' },
    { value: 'public',       label: 'Public Meetings' },
    { value: 'other',        label: 'Other' },
  ],
  audienceSizeLabel: 'Approximate Audience Size',
  audienceSizePlaceholder: 'Select a range…',
  audienceSizeOptions: [
    { value: '1_50',       label: '1 – 50' },
    { value: '51_200',     label: '51 – 200' },
    { value: '201_1000',   label: '201 – 1,000' },
    { value: '1001_5000',  label: '1,001 – 5,000' },
    { value: '5000_plus',  label: '5,000+' },
  ],
  websiteLabel: 'Organisation Website',
  websitePlaceholder: 'https://yourwebsite.com',
  referralSourceLabel: 'How did you hear about us?',
  referralSourcePlaceholder: 'Choose an option',
  referralOptions: [
    { value: 'search',     label: 'Search Engine' },
    { value: 'linkedin',   label: 'LinkedIn' },
    { value: 'referral',   label: 'Friend / Referral' },
    { value: 'conference', label: 'Conference / Event' },
    { value: 'social',     label: 'Social Media' },
    { value: 'customer',   label: 'Existing Customer' },
    { value: 'other',      label: 'Other' },
  ],
  gdprFieldLabel: 'Privacy Consent',
  // TODO [LEGAL REVIEW]: replace with reviewed copy before launch
  gdprConsentText:
    'I agree to the processing of my personal data for the purpose of evaluating my early access request. I understand that my data will be stored securely and not shared with third parties without my consent. I can withdraw my consent at any time by contacting support.',
  step3SubmitLabel: 'Request Early Access',

  submittingLabel: 'Sending…',
  backLabel: 'Back',
  closeLabel: 'Close',

  successTitle: "You're on the list!",
  successBody: (name) =>
    `Thank you, ${name}! We received your early access request. We'll keep you informed about new developments and reach out as soon as we're ready.`,
  successCloseLabel: 'Close',

  footerNamePlaceholder: 'Your name',
  footerEmailPlaceholder: 'your@email.com',
  footerCtaLabel: 'Get Early Access',

  nameRequiredError: 'Please enter your name.',
  emailRequiredError: 'Please enter a valid email address.',
  emailInvalidError: 'Please enter a valid email address.',
  submitError: 'Something went wrong. Please try again.',
  roleRequiredError: 'Please select your role.',
  orgTypeRequiredError: 'Please select an organisation type.',
}

// ─── Italian ──────────────────────────────────────────────────────────────────
// TODO [COPY REVIEW — IT]: review and finalize translations before launch.

const it: EarlyAccessMessages = {
  modalTitle: 'Richiedi Accesso Anticipato',

  step1Name: 'Contatto',
  step2Name: 'La Tua Organizzazione',
  step3Name: 'Esigenze di Streaming',
  stepOfLabel: (current, total) => `Passo ${current} di ${total}`,

  step1Title: 'Iniziamo',
  step1Subtitle: 'Ti invieremo aggiornamenti e ti contatteremo non appena saremo pronti.',
  nameLabel: 'Nome Completo',
  namePlaceholder: 'Il tuo nome',
  emailLabel: 'Indirizzo Email',
  emailPlaceholder: 'tu@esempio.com',
  step1SubmitLabel: 'Continua',

  step2Title: 'La tua organizzazione',
  step2Subtitle: 'Dicci chi sei così possiamo abbinarti al piano giusto.',
  organizationLabel: 'Nome Organizzazione',
  organizationPlaceholder: 'La tua organizzazione',
  roleLabel: 'Il Tuo Ruolo',
  roleOptions: [
    { value: 'founder',     label: 'Fondatore / Titolare' },
    { value: 'manager',     label: 'Manager' },
    { value: 'marketing',   label: 'Marketing / Comunicazione' },
    { value: 'organizer',   label: 'Organizzatore di Eventi' },
    { value: 'technical',   label: 'Tecnico / IT' },
    { value: 'production',  label: 'Produzione / Media' },
    { value: 'consultant',  label: 'Consulente' },
    { value: 'other',       label: 'Altro' },
  ],
  orgTypeLabel: 'Tipo di Organizzazione',
  orgTypePlaceholder: 'Seleziona tipo…',
  orgTypeOptions: [
    { value: 'individual',  label: 'Individuale' },
    { value: 'association', label: 'Associazione / Non profit' },
    { value: 'company',     label: 'Azienda' },
    { value: 'agency',      label: 'Agenzia' },
    { value: 'school',      label: 'Scuola / Istruzione' },
    { value: 'sports_club', label: 'Associazione Sportiva' },
    { value: 'religious',   label: 'Organizzazione Religiosa' },
    { value: 'venue',       label: 'Spazio / Venue' },
    { value: 'other',       label: 'Altro' },
  ],
  step2NextLabel: 'Continua',

  step3Title: 'Le tue esigenze di streaming',
  step3Subtitle: 'Questo ci aiuta a prepararci al meglio per te.',
  useCasesLabel: 'Cosa vorresti trasmettere?',
  useCasesHelpText: 'Seleziona tutto ciò che si applica',
  useCaseOptions: [
    { value: 'religious',    label: 'Servizi Religiosi' },
    { value: 'sports',       label: 'Eventi Sportivi' },
    { value: 'concerts',     label: 'Concerti e Musica dal Vivo' },
    { value: 'conferences',  label: 'Conferenze e Seminari' },
    { value: 'education',    label: 'Formazione ed Istruzione' },
    { value: 'community',    label: 'Eventi Comunitari' },
    { value: 'corporate',    label: 'Eventi Aziendali' },
    { value: 'festivals',    label: 'Festival' },
    { value: 'theatre',      label: 'Teatro e Spettacoli' },
    { value: 'weddings',     label: 'Matrimoni e Cerimonie' },
    { value: 'public',       label: 'Riunioni Pubbliche' },
    { value: 'other',        label: 'Altro' },
  ],
  audienceSizeLabel: 'Pubblico Stimato',
  audienceSizePlaceholder: 'Seleziona un intervallo…',
  audienceSizeOptions: [
    { value: '1_50',       label: '1 – 50' },
    { value: '51_200',     label: '51 – 200' },
    { value: '201_1000',   label: '201 – 1.000' },
    { value: '1001_5000',  label: '1.001 – 5.000' },
    { value: '5000_plus',  label: '5.000+' },
  ],
  websiteLabel: 'Sito Web dell\'Organizzazione',
  websitePlaceholder: 'https://iltuosito.com',
  referralSourceLabel: 'Come ci hai conosciuto?',
  referralSourcePlaceholder: 'Scegli un\'opzione',
  referralOptions: [
    { value: 'search',     label: 'Motore di Ricerca' },
    { value: 'linkedin',   label: 'LinkedIn' },
    { value: 'referral',   label: 'Amico / Referral' },
    { value: 'conference', label: 'Conferenza / Evento' },
    { value: 'social',     label: 'Social Media' },
    { value: 'customer',   label: 'Cliente Esistente' },
    { value: 'other',      label: 'Altro' },
  ],
  gdprFieldLabel: 'Consenso Privacy',
  // TODO [LEGAL REVIEW]: testo da revisionare con il legale prima del lancio
  gdprConsentText:
    'Acconsento al trattamento dei miei dati personali ai fini della valutazione della mia richiesta di accesso anticipato. Comprendo che i miei dati saranno conservati in modo sicuro e non condivisi con terze parti senza il mio consenso. Posso revocare il consenso in qualsiasi momento contattando il supporto.',
  step3SubmitLabel: 'Richiedi Accesso Anticipato',

  submittingLabel: 'Invio in corso…',
  backLabel: 'Indietro',
  closeLabel: 'Chiudi',

  successTitle: 'Sei nella lista!',
  successBody: (name) =>
    `Grazie, ${name}! Abbiamo ricevuto la tua richiesta di accesso anticipato. Ti terremo informato sulle novità e ti contatteremo non appena saremo pronti.`,
  successCloseLabel: 'Chiudi',

  footerNamePlaceholder: 'Il tuo nome',
  footerEmailPlaceholder: 'tua@email.com',
  footerCtaLabel: 'Richiedi Accesso',

  nameRequiredError: 'Inserisci il tuo nome.',
  emailRequiredError: 'Inserisci un indirizzo email valido.',
  emailInvalidError: 'Indirizzo email non valido.',
  submitError: 'Qualcosa è andato storto. Riprova.',
  roleRequiredError: 'Seleziona il tuo ruolo.',
  orgTypeRequiredError: 'Seleziona il tipo di organizzazione.',
}

// ─── Registry + lookup ────────────────────────────────────────────────────────

const MESSAGES: Record<string, EarlyAccessMessages> = { en, it }

/**
 * Returns localised messages for the given locale.
 * Falls back to English if the locale is not yet translated.
 */
export function getEarlyAccessMessages(locale: string): EarlyAccessMessages {
  return MESSAGES[locale] ?? MESSAGES.en
}
