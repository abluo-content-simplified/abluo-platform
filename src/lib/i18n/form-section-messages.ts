/**
 * FormSection UI Messages
 *
 * Fallback labels for the form submit button, loading state, success, and
 * error messages. These are platform UI strings, not tenant content.
 * If the form document provides a submitLabel or successMessage, those take
 * priority over these fallbacks.
 *
 * FUTURE: replace with next-intl `getTranslations` once the messages/
 * directory is the authoritative source for all UI strings.
 */

import type { FormRendererMessages } from '@/components/forms/FormRenderer'

const MESSAGES: Record<string, FormRendererMessages> = {
  en: {
    submitLabel:    'Submit',
    submitting:     'Sending…',
    successMessage: 'Your message has been sent. Thank you!',
    errorMessage:   'Something went wrong. Please try again.',
  },
  it: {
    submitLabel:    'Invia',
    submitting:     'Invio in corso…',
    successMessage: 'Il tuo messaggio è stato inviato. Grazie!',
    errorMessage:   'Si è verificato un problema. Riprova.',
  },
  de: {
    submitLabel:    'Absenden',
    submitting:     'Wird gesendet…',
    successMessage: 'Ihre Nachricht wurde gesendet. Vielen Dank!',
    errorMessage:   'Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.',
  },
  fr: {
    submitLabel:    'Envoyer',
    submitting:     'Envoi en cours…',
    successMessage: 'Votre message a été envoyé. Merci !',
    errorMessage:   'Une erreur est survenue. Veuillez réessayer.',
  },
  es: {
    submitLabel:    'Enviar',
    submitting:     'Enviando…',
    successMessage: '¡Tu mensaje ha sido enviado. Gracias!',
    errorMessage:   'Algo salió mal. Por favor, inténtalo de nuevo.',
  },
}

export function getFormSectionMessages(locale: string): FormRendererMessages {
  return MESSAGES[locale] ?? MESSAGES.en
}
