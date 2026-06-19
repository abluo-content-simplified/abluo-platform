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
 * TODO [OPTIONS I18N]: option labels (orgType, useCases, referral) are currently
 *   English-only. Add locale-keyed option arrays when Italian translations are
 *   confirmed, or move option labels into EarlyAccessMessages (see structure below).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EarlyAccessOptionItem {
  value: string
  label: string
}

export interface EarlyAccessMessages {
  // ── Modal chrome ──────────────────────────────────────────────────────────
  modalTitle: string

  // ── Step 1 ────────────────────────────────────────────────────────────────
  step1Title: string
  step1Subtitle: string
  nameLabel: string
  namePlaceholder: string
  emailLabel: string
  emailPlaceholder: string
  step1SubmitLabel: string

  // ── Step 2 ────────────────────────────────────────────────────────────────
  step2Title: string
  step2Subtitle: string
  organizationLabel: string
  organizationPlaceholder: string
  roleLabel: string
  rolePlaceholder: string
  websiteLabel: string
  websitePlaceholder: string
  countryLabel: string
  orgTypeLabel: string
  orgTypePlaceholder: string
  orgTypeOptions: EarlyAccessOptionItem[]
  useCasesLabel: string
  useCasesHelpText: string
  useCaseOptions: EarlyAccessOptionItem[]
  referralSourceLabel: string
  referralSourcePlaceholder: string
  referralOptions: EarlyAccessOptionItem[]
  messageLabel: string
  messagePlaceholder: string
  gdprFieldLabel: string
  /** Full GDPR consent text. TODO [LEGAL REVIEW] before launch. */
  gdprConsentText: string
  step2SubmitLabel: string

  // ── Shared ────────────────────────────────────────────────────────────────
  submittingLabel: string
  backLabel: string
  closeLabel: string

  // ── Success state ─────────────────────────────────────────────────────────
  successTitle: string
  /** Called with the submitter's name. May include {Name} token for future CMS use. */
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
}

// ─── English ──────────────────────────────────────────────────────────────────

const en: EarlyAccessMessages = {
  modalTitle: 'Request Early Access',

  step1Title: "Let's get started",
  step1Subtitle: "We'll send you updates and reach out as soon as we're ready.",
  nameLabel: 'Full Name',
  namePlaceholder: 'Your name',
  emailLabel: 'Email Address',
  emailPlaceholder: 'you@example.com',
  step1SubmitLabel: 'Continue',

  step2Title: 'Tell us about yourself',
  step2Subtitle: 'This helps us prioritise and match you with the right plan.',
  organizationLabel: 'Organisation / Company',
  organizationPlaceholder: 'Your organisation',
  roleLabel: 'Your Role',
  rolePlaceholder: 'e.g. Founder, Manager, IT Lead',
  websiteLabel: 'Website',
  websitePlaceholder: 'https://yourwebsite.com',
  countryLabel: 'Country',
  orgTypeLabel: 'Organisation Type',
  orgTypePlaceholder: 'Select type…',
  orgTypeOptions: [
    { value: 'individual',  label: 'Individual' },
    { value: 'practice',    label: 'Professional Practice' },
    { value: 'company',     label: 'Company' },
    { value: 'agency',      label: 'Agency' },
    { value: 'association', label: 'Association / Non-profit' },
    { value: 'school',      label: 'School / Education' },
    { value: 'sports_club', label: 'Sports Club' },
    { value: 'religious',   label: 'Religious Organisation' },
    { value: 'other',       label: 'Other' },
  ],
  useCasesLabel: 'Intended Use Cases',
  useCasesHelpText: 'Select all that apply',
  useCaseOptions: [
    { value: 'website',        label: 'Website' },
    { value: 'blog',           label: 'Blog / News' },
    { value: 'events',         label: 'Event Management' },
    { value: 'booking',        label: 'Online Booking' },
    { value: 'lead_gen',       label: 'Lead Generation' },
    { value: 'members',        label: 'Member Management' },
    { value: 'client_portal',  label: 'Client Portal' },
    { value: 'internal_comms', label: 'Internal Communication' },
    { value: 'other',          label: 'Other' },
  ],
  referralSourceLabel: 'How did you hear about us?',
  referralSourcePlaceholder: 'Select…',
  referralOptions: [
    { value: 'search',     label: 'Search Engine' },
    { value: 'linkedin',   label: 'LinkedIn' },
    { value: 'referral',   label: 'Friend / Referral' },
    { value: 'conference', label: 'Conference / Event' },
    { value: 'social',     label: 'Social Media' },
    { value: 'customer',   label: 'Existing Customer' },
    { value: 'other',      label: 'Other' },
  ],
  messageLabel: 'Message',
  messagePlaceholder: "Anything else you'd like to share…",
  gdprFieldLabel: 'Privacy Consent',
  // TODO [LEGAL REVIEW]: replace with reviewed copy before launch
  gdprConsentText:
    'I agree to the processing of my personal data for the purpose of evaluating my early access request. I understand that my data will be stored securely and not shared with third parties without my consent. I can withdraw my consent at any time by contacting support.',
  step2SubmitLabel: 'Request Early Access',

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
}

// ─── Italian ──────────────────────────────────────────────────────────────────
// TODO [COPY REVIEW — IT]: review and finalize translations before launch.

const it: EarlyAccessMessages = {
  modalTitle: 'Richiedi Accesso Anticipato',

  step1Title: 'Iniziamo',
  step1Subtitle: 'Ti invieremo aggiornamenti e ti contatteremo non appena saremo pronti.',
  nameLabel: 'Nome Completo',
  namePlaceholder: 'Il tuo nome',
  emailLabel: 'Indirizzo Email',
  emailPlaceholder: 'tu@esempio.com',
  step1SubmitLabel: 'Continua',

  step2Title: 'Parlaci di te',
  step2Subtitle: 'Questo ci aiuta a darti la priorità e ad abbinarti al piano giusto.',
  organizationLabel: 'Organizzazione / Azienda',
  organizationPlaceholder: 'La tua organizzazione',
  roleLabel: 'Il Tuo Ruolo',
  rolePlaceholder: 'es. Fondatore, Manager, Responsabile IT',
  websiteLabel: 'Sito Web',
  websitePlaceholder: 'https://iltuosito.com',
  countryLabel: 'Paese',
  orgTypeLabel: 'Tipo di Organizzazione',
  orgTypePlaceholder: 'Seleziona tipo…',
  orgTypeOptions: [
    { value: 'individual',  label: 'Individuale' },
    { value: 'practice',    label: 'Studio Professionale' },
    { value: 'company',     label: 'Azienda' },
    { value: 'agency',      label: 'Agenzia' },
    { value: 'association', label: 'Associazione / Non profit' },
    { value: 'school',      label: 'Scuola / Istruzione' },
    { value: 'sports_club', label: 'Associazione Sportiva' },
    { value: 'religious',   label: 'Organizzazione Religiosa' },
    { value: 'other',       label: 'Altro' },
  ],
  useCasesLabel: 'Casi d\'uso Previsti',
  useCasesHelpText: 'Seleziona tutto ciò che si applica',
  useCaseOptions: [
    { value: 'website',        label: 'Sito Web' },
    { value: 'blog',           label: 'Blog / Notizie' },
    { value: 'events',         label: 'Gestione Eventi' },
    { value: 'booking',        label: 'Prenotazione Online' },
    { value: 'lead_gen',       label: 'Generazione Contatti' },
    { value: 'members',        label: 'Gestione Soci' },
    { value: 'client_portal',  label: 'Portale Clienti' },
    { value: 'internal_comms', label: 'Comunicazione Interna' },
    { value: 'other',          label: 'Altro' },
  ],
  referralSourceLabel: 'Come ci hai conosciuto?',
  referralSourcePlaceholder: 'Seleziona…',
  referralOptions: [
    { value: 'search',     label: 'Motore di Ricerca' },
    { value: 'linkedin',   label: 'LinkedIn' },
    { value: 'referral',   label: 'Amico / Referral' },
    { value: 'conference', label: 'Conferenza / Evento' },
    { value: 'social',     label: 'Social Media' },
    { value: 'customer',   label: 'Cliente Esistente' },
    { value: 'other',      label: 'Altro' },
  ],
  messageLabel: 'Messaggio',
  messagePlaceholder: 'Qualcos\'altro che vorresti condividere…',
  gdprFieldLabel: 'Consenso Privacy',
  // TODO [LEGAL REVIEW]: testo da revisionare con il legale prima del lancio
  gdprConsentText:
    'Acconsento al trattamento dei miei dati personali ai fini della valutazione della mia richiesta di accesso anticipato. Comprendo che i miei dati saranno conservati in modo sicuro e non condivisi con terze parti senza il mio consenso. Posso revocare il consenso in qualsiasi momento contattando il supporto.',
  step2SubmitLabel: 'Richiedi Accesso Anticipato',

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
}

// ─── Registry + lookup ────────────────────────────────────────────────────────

const MESSAGES: Record<string, EarlyAccessMessages> = { en, it }

/**
 * Returns localised messages for the given locale.
 * Falls back to English if the locale is not yet translated.
 *
 * FUTURE: replace this lookup with a Sanity fetch or next-intl hook
 * when the form content is managed in CMS.
 */
export function getEarlyAccessMessages(locale: string): EarlyAccessMessages {
  return MESSAGES[locale] ?? MESSAGES.en
}
