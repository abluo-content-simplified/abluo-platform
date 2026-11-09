// ── Testimonials module — the module-owned Testimonial form (ADR-048 D4) ──────
//
// Phase 2. Submissions reuse Forms: the module OWNS a `formDefinition` (the
// WhatsApp pattern, src/lib/modules/whatsapp/form-sync.ts) so the tenant never
// builds a form. Stored, spam-checked, notified and retained by Forms as for any
// other form; the module only lists them (Testimonials → Submissions) and turns
// one into a DRAFT testimonial (createTestimonialFromSubmission). Nothing a
// visitor writes is ever published automatically.
//
// This file is pure — it computes documents. The write is
// syncTestimonialForm (src/lib/api/testimonial-form.ts).
//
// Guarantees (as WhatsApp):
//  1. Stable identity — the document id derives from the tenant slug, so
//     re-syncing updates in place.
//  2. Stable submission keys — TESTIMONIAL_FORM_KEYS never change when a label
//     is renamed or translated, so past submissions keep resolving.
//  3. Every visitor-facing string exists in EVERY platform locale (a test pins
//     it): labels, help, title, intro, consent and the thank-you message.
//  4. No destructive writes — the sync (form-sync.ts) always sets the identity
//     keys (formId, tenantSlug, type, role) and only FILLS the rest where missing,
//     so wording an admin adjusted in Studio survives. `version` is set once at
//     creation.

import { LOCALE_CODES, type SupportedLocale } from '@/lib/i18n/locales'
import { TESTIMONIAL_FORM_ID, TESTIMONIAL_FORM_KEYS, TESTIMONIAL_FORM_STEP_KEY, TESTIMONIAL_RATING } from './model'

/** One string in every platform locale — the type makes a missing language a compile error. */
export type AllLocales = Record<SupportedLocale, string>

export const TESTIMONIAL_FORM_TEXT = {
  title: {
    en: 'Share your experience',
    it: 'Condividi la tua esperienza',
    de: 'Teile deine Erfahrung',
    fr: 'Partagez votre expérience',
    es: 'Comparte tu experiencia',
    pt: 'Partilha a tua experiência',
    nl: 'Deel je ervaring',
  },
  intro: {
    en: 'Your words help others get to know us. Only the name you choose below is shown; your contact details stay private.',
    it: 'Le tue parole aiutano altre persone a conoscerci. Viene mostrato solo il nome che scegli qui sotto; i tuoi recapiti restano privati.',
    de: 'Deine Worte helfen anderen, uns kennenzulernen. Angezeigt wird nur der Name, den du unten wählst; deine Kontaktdaten bleiben privat.',
    fr: 'Vos mots aident d’autres personnes à nous connaître. Seul le nom que vous choisissez ci-dessous est affiché ; vos coordonnées restent privées.',
    es: 'Tus palabras ayudan a otras personas a conocernos. Solo se muestra el nombre que elijas abajo; tus datos de contacto siguen siendo privados.',
    pt: 'As tuas palavras ajudam outras pessoas a conhecer-nos. Só é mostrado o nome que escolheres abaixo; os teus contactos ficam privados.',
    nl: 'Jouw woorden helpen anderen ons te leren kennen. Alleen de naam die je hieronder kiest wordt getoond; je contactgegevens blijven privé.',
  },
  displayName: {
    en: 'Name as shown',
    it: 'Nome da mostrare',
    de: 'Angezeigter Name',
    fr: 'Nom affiché',
    es: 'Nombre que se mostrará',
    pt: 'Nome a mostrar',
    nl: 'Getoonde naam',
  },
  displayNameHelp: {
    en: 'How your name should appear. A first name or initials is fine.',
    it: 'Come vuoi che appaia il tuo nome. Va bene anche solo il nome di battesimo o le iniziali.',
    de: 'So soll dein Name erscheinen. Ein Vorname oder Initialen genügen.',
    fr: 'La façon dont votre nom doit apparaître. Un prénom ou des initiales suffisent.',
    es: 'Cómo quieres que aparezca tu nombre. Basta con el nombre de pila o las iniciales.',
    pt: 'Como queres que o teu nome apareça. Basta o primeiro nome ou as iniciais.',
    nl: 'Hoe je naam moet verschijnen. Een voornaam of initialen is genoeg.',
  },
  fullName: {
    en: 'Full name',
    it: 'Nome e cognome',
    de: 'Vollständiger Name',
    fr: 'Nom complet',
    es: 'Nombre completo',
    pt: 'Nome completo',
    nl: 'Volledige naam',
  },
  fullNameHelp: {
    en: 'Only we see this. It is never published.',
    it: 'Lo vediamo solo noi. Non viene mai pubblicato.',
    de: 'Nur wir sehen das. Es wird nie veröffentlicht.',
    fr: 'Nous seuls le voyons. Il n’est jamais publié.',
    es: 'Solo lo vemos nosotros. Nunca se publica.',
    pt: 'Só nós vemos isto. Nunca é publicado.',
    nl: 'Alleen wij zien dit. Het wordt nooit gepubliceerd.',
  },
  email: {
    en: 'Email',
    it: 'Email',
    de: 'E-Mail',
    fr: 'E-mail',
    es: 'Correo electrónico',
    pt: 'E-mail',
    nl: 'E-mail',
  },
  emailHelp: {
    en: 'Only we see this. It is never published.',
    it: 'La vediamo solo noi. Non viene mai pubblicata.',
    de: 'Nur wir sehen das. Sie wird nie veröffentlicht.',
    fr: 'Nous seuls le voyons. Il n’est jamais publié.',
    es: 'Solo lo vemos nosotros. Nunca se publica.',
    pt: 'Só nós vemos isto. Nunca é publicado.',
    nl: 'Alleen wij zien dit. Het wordt nooit gepubliceerd.',
  },
  phone: {
    en: 'Phone',
    it: 'Telefono',
    de: 'Telefon',
    fr: 'Téléphone',
    es: 'Teléfono',
    pt: 'Telefone',
    nl: 'Telefoon',
  },
  phoneHelp: {
    en: 'Optional. Only we see this.',
    it: 'Facoltativo. Lo vediamo solo noi.',
    de: 'Optional. Nur wir sehen das.',
    fr: 'Facultatif. Nous seuls le voyons.',
    es: 'Opcional. Solo lo vemos nosotros.',
    pt: 'Opcional. Só nós vemos isto.',
    nl: 'Optioneel. Alleen wij zien dit.',
  },
  testimonial: {
    en: 'Your testimonial',
    it: 'La tua testimonianza',
    de: 'Dein Erfahrungsbericht',
    fr: 'Votre témoignage',
    es: 'Tu testimonio',
    pt: 'O teu testemunho',
    nl: 'Jouw getuigenis',
  },
  testimonialHelp: {
    en: 'What was your experience?',
    it: 'Com’è stata la tua esperienza?',
    de: 'Wie war deine Erfahrung?',
    fr: 'Comment s’est passée votre expérience ?',
    es: '¿Cómo fue tu experiencia?',
    pt: 'Como foi a tua experiência?',
    nl: 'Hoe was je ervaring?',
  },
  rating: {
    en: 'Rating',
    it: 'Valutazione',
    de: 'Bewertung',
    fr: 'Note',
    es: 'Valoración',
    pt: 'Avaliação',
    nl: 'Beoordeling',
  },
  ratingHelp: {
    en: 'Optional.',
    it: 'Facoltativa.',
    de: 'Optional.',
    fr: 'Facultative.',
    es: 'Opcional.',
    pt: 'Opcional.',
    nl: 'Optioneel.',
  },
  consent: {
    en: 'I agree that my testimonial may be published on this website, and that my contact details are kept so that I can be contacted about it. I can withdraw my consent at any time.',
    it: 'Acconsento alla pubblicazione della mia testimonianza su questo sito e alla conservazione dei miei recapiti affinché possano contattarmi in merito. Posso revocare il consenso in qualsiasi momento.',
    de: 'Ich bin damit einverstanden, dass mein Erfahrungsbericht auf dieser Website veröffentlicht wird und dass meine Kontaktdaten gespeichert werden, damit man mich dazu kontaktieren kann. Ich kann meine Einwilligung jederzeit widerrufen.',
    fr: 'J’accepte que mon témoignage soit publié sur ce site et que mes coordonnées soient conservées afin que l’on puisse me contacter à ce sujet. Je peux retirer mon consentement à tout moment.',
    es: 'Acepto que mi testimonio se publique en este sitio web y que mis datos de contacto se conserven para poder contactarme al respecto. Puedo retirar mi consentimiento en cualquier momento.',
    pt: 'Aceito que o meu testemunho seja publicado neste site e que os meus contactos sejam guardados para que possam contactar-me sobre o assunto. Posso retirar o consentimento a qualquer momento.',
    nl: 'Ik ga ermee akkoord dat mijn getuigenis op deze website wordt gepubliceerd en dat mijn contactgegevens worden bewaard, zodat men me hierover kan benaderen. Ik kan mijn toestemming op elk moment intrekken.',
  },
  successTitle: {
    en: 'Thank you!',
    it: 'Grazie!',
    de: 'Danke!',
    fr: 'Merci !',
    es: '¡Gracias!',
    pt: 'Obrigado!',
    nl: 'Bedankt!',
  },
  successBody: {
    en: 'We have received your testimonial. We will read it and, with your permission, publish it on our website.',
    it: 'Abbiamo ricevuto la tua testimonianza. La leggeremo e, con il tuo consenso, la pubblicheremo sul nostro sito.',
    de: 'Wir haben deinen Erfahrungsbericht erhalten. Wir lesen ihn und veröffentlichen ihn mit deiner Erlaubnis auf unserer Website.',
    fr: 'Nous avons bien reçu votre témoignage. Nous le lirons et, avec votre accord, nous le publierons sur notre site.',
    es: 'Hemos recibido tu testimonio. Lo leeremos y, con tu permiso, lo publicaremos en nuestro sitio web.',
    pt: 'Recebemos o teu testemunho. Vamos lê-lo e, com a tua autorização, publicá-lo no nosso site.',
    nl: 'We hebben je getuigenis ontvangen. We lezen het en publiceren het, met jouw toestemming, op onze website.',
  },
} as const satisfies Record<string, AllLocales>

export type TestimonialFormTextKey = keyof typeof TESTIMONIAL_FORM_TEXT

/** Every key whose text must exist in every platform locale (the test iterates this). */
export const TESTIMONIAL_FORM_TEXT_KEYS = Object.keys(TESTIMONIAL_FORM_TEXT) as TestimonialFormTextKey[]

/** A Sanity-shaped localized value (`localizedString` / `localizedText`) in every platform locale. */
function localized(key: TestimonialFormTextKey, type: 'localizedString' | 'localizedText' = 'localizedString'): Record<string, string> {
  const text = TESTIMONIAL_FORM_TEXT[key]
  return { _type: type, ...Object.fromEntries(LOCALE_CODES.map((code) => [code, text[code]])) }
}

/** Deterministic document id of a tenant's Testimonial form (as whatsAppFormId). */
export function testimonialFormDocId(tenantSlug: string): string {
  return `formDefinition-${tenantSlug}-${TESTIMONIAL_FORM_ID}`
}

function field(
  key: string,
  type: string,
  label: TestimonialFormTextKey,
  help: TestimonialFormTextKey,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    _type: 'formDefinitionField',
    _key: key,
    internalKey: key,
    type,
    label: localized(label),
    help: localized(help),
    ...extra,
  }
}

/** The form's single step: name, contact (private), text, rating. */
function buildFields(): Record<string, unknown>[] {
  const K = TESTIMONIAL_FORM_KEYS
  return [
    field(K.displayName, 'text', 'displayName', 'displayNameHelp', { required: true, maxLength: 120 }),
    field(K.fullName, 'text', 'fullName', 'fullNameHelp', { required: false, maxLength: 160 }),
    field(K.email, 'email', 'email', 'emailHelp', { required: true }),
    field(K.phone, 'phone', 'phone', 'phoneHelp', { required: false }),
    field(K.text, 'textarea', 'testimonial', 'testimonialHelp', { required: true, rows: 6, minLength: 10, maxLength: 5000 }),
    field(K.rating, 'rating', 'rating', 'ratingHelp', { required: false, maxRating: TESTIMONIAL_RATING.max }),
  ]
}

/**
 * The fields this module derives and therefore owns on the form document.
 * A patch body (not a whole document) so an existing form keeps any setting
 * the module does not manage.
 */
export function buildTestimonialFormPatch(input: { tenantSlug: string }): Record<string, unknown> {
  return {
    formId: TESTIMONIAL_FORM_ID,
    internalName: `Testimonials (${input.tenantSlug})`,
    title: localized('title'),
    intro: localized('intro', 'localizedText'),
    formType: 'single-step',
    role: 'active',
    tenantSlug: input.tenantSlug,
    notificationTopic: TESTIMONIAL_FORM_ID,
    steps: [
      {
        _type: 'formStep',
        _key: TESTIMONIAL_FORM_STEP_KEY,
        key: TESTIMONIAL_FORM_STEP_KEY,
        fields: buildFields(),
      },
    ],
    privacy: {
      _type: 'object',
      requireConsent: true,
      consentText: localized('consent', 'localizedText'),
    },
    success: {
      _type: 'object',
      title: localized('successTitle'),
      body: localized('successBody', 'localizedText'),
    },
  }
}

/**
 * The full document used when the tenant has no Testimonial form yet.
 * `version` is set once and never touched afterwards (it is pinned onto each
 * submission; the Forms module bumps it when the data shape changes).
 */
export function buildTestimonialFormDocument(input: { tenantSlug: string }): Record<string, unknown> {
  return {
    _id: testimonialFormDocId(input.tenantSlug),
    _type: 'formDefinition',
    version: 1,
    ...buildTestimonialFormPatch(input),
  }
}
