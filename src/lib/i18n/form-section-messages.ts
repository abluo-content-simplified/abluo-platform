/**
 * FormSection UI Messages
 *
 * Fallback labels for the form submit button, loading, success, and error
 * states, plus multi-step chrome (Continue button + step progress). These are
 * platform UI strings, not tenant content; a definition's own success copy
 * takes priority over `successMessage` where present.
 *
 * FUTURE: replace with next-intl `getTranslations` once the messages/
 * directory is the authoritative source for all UI strings.
 */

export interface FormSectionMessages {
  submitLabel: string
  submitting: string
  successMessage: string
  errorMessage: string
  /** Advance-to-next-step button on a non-final multi-step page. */
  continueLabel: string
  /** Step progress template with {current}/{total} placeholders, e.g. "Step {current} of {total}".
   * A plain string (not a function) so it can cross the Server→Client Component boundary. */
  stepLabel: string
  /** Hint shown when a form/step has required fields (before the consent/submit). */
  requiredHint: string
}

const MESSAGES: Record<string, FormSectionMessages> = {
  en: {
    submitLabel:    'Submit',
    submitting:     'Sending…',
    successMessage: 'Your message has been sent. Thank you!',
    errorMessage:   'Something went wrong. Please try again.',
    continueLabel:  'Continue',
    stepLabel:      'Step {current} of {total}',
    requiredHint:   'Fields marked with * are required.',
  },
  it: {
    submitLabel:    'Invia',
    submitting:     'Invio in corso…',
    successMessage: 'Il tuo messaggio è stato inviato. Grazie!',
    errorMessage:   'Si è verificato un problema. Riprova.',
    continueLabel:  'Continua',
    stepLabel:      'Passo {current} di {total}',
    requiredHint:   'I campi contrassegnati con * sono obbligatori.',
  },
  de: {
    submitLabel:    'Absenden',
    submitting:     'Wird gesendet…',
    successMessage: 'Ihre Nachricht wurde gesendet. Vielen Dank!',
    errorMessage:   'Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.',
    continueLabel:  'Weiter',
    stepLabel:      'Schritt {current} von {total}',
    requiredHint:   'Mit * markierte Felder sind erforderlich.',
  },
  fr: {
    submitLabel:    'Envoyer',
    submitting:     'Envoi en cours…',
    successMessage: 'Votre message a été envoyé. Merci !',
    errorMessage:   'Une erreur est survenue. Veuillez réessayer.',
    continueLabel:  'Continuer',
    stepLabel:      'Étape {current} sur {total}',
    requiredHint:   'Les champs marqués d’un * sont obligatoires.',
  },
  es: {
    submitLabel:    'Enviar',
    submitting:     'Enviando…',
    successMessage: '¡Tu mensaje ha sido enviado. Gracias!',
    errorMessage:   'Algo salió mal. Por favor, inténtalo de nuevo.',
    continueLabel:  'Continuar',
    stepLabel:      'Paso {current} de {total}',
    requiredHint:   'Los campos marcados con * son obligatorios.',
  },
}

export function getFormSectionMessages(locale: string): FormSectionMessages {
  return MESSAGES[locale] ?? MESSAGES.en
}
