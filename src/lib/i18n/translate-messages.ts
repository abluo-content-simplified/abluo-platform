/**
 * Translate module messages (ADR-023 §9).
 *
 * Every string the Translate button can show — labels, status badges, and one
 * sentence per API error code — in every platform locale. The API returns
 * codes only; this dictionary is the one place they become words.
 *
 * Studio renders `en` today; the client dashboard will pass the user's
 * interface locale. `{source}`, `{targets}`, `{used}` and `{quota}` are
 * placeholders filled by `formatTranslateMessage`.
 */

import type { TranslateErrorCode } from '@/lib/translate/types'

export interface TranslateMessages {
  /** Button: "Translate from EN". */
  translateFrom: string
  translating: string
  /** After success: "Translated into FR, DE". */
  translated: string
  /** Source is empty. */
  nothingToTranslate: string
  /** Every target has original or reviewed text, which one click never overwrites. */
  allTargetsProtected: string
  /** Source-language picker label. */
  sourceLabel: string
  /** The language being translated from. */
  statusSource: string
  /** A site language with no text yet. */
  statusMissing: string
  statusOriginal: string
  statusMachine: string
  statusReviewed: string
  markReviewed: string
  /** "{used} of {quota} characters this month". */
  usageWithQuota: string
  /** "{used} characters this month". */
  usageNoQuota: string
  errors: Record<TranslateErrorCode, string>
}

const MESSAGES: Record<string, TranslateMessages> = {
  en: {
    translateFrom: 'Translate from {source}',
    translating: 'Translating…',
    translated: 'Translated into {targets}. Please check the result.',
    nothingToTranslate: 'Write the {source} text first.',
    allTargetsProtected: 'The other languages already have text written or reviewed by a person, so nothing was changed.',
    sourceLabel: 'Translate from',
    statusSource: 'Source',
    statusMissing: 'Missing',
    statusOriginal: 'Original',
    statusMachine: 'Machine translation',
    statusReviewed: 'Reviewed',
    markReviewed: 'Mark as reviewed',
    usageWithQuota: '{used} of {quota} characters this month',
    usageNoQuota: '{used} characters this month',
    errors: {
      forbidden: 'You are not allowed to translate content.',
      invalid_request: 'This text could not be sent for translation.',
      too_large: 'This text is too long to translate in one go. Translate it in smaller parts.',
      project_not_found: 'This website could not be found.',
      module_disabled: 'Translation is not switched on for this website.',
      provider_not_configured: 'The translation service is not set up yet. Please contact us.',
      quota_reached: 'This website has used all its translations for this month. Please contact us to raise the limit.',
      usage_unavailable: 'Translation is temporarily unavailable. Please try again in a few minutes.',
      provider_error: 'The translation service returned an error. Please try again.',
      network_error: 'The translation service could not be reached. Please try again.',
    },
  },
  it: {
    translateFrom: 'Traduci da {source}',
    translating: 'Traduzione in corso…',
    translated: 'Tradotto in {targets}. Controlla il risultato.',
    nothingToTranslate: 'Scrivi prima il testo in {source}.',
    allTargetsProtected: 'Le altre lingue hanno già un testo scritto o rivisto da una persona, quindi non è stato modificato nulla.',
    sourceLabel: 'Traduci da',
    statusSource: 'Origine',
    statusMissing: 'Mancante',
    statusOriginal: 'Originale',
    statusMachine: 'Traduzione automatica',
    statusReviewed: 'Rivisto',
    markReviewed: 'Segna come rivisto',
    usageWithQuota: '{used} di {quota} caratteri questo mese',
    usageNoQuota: '{used} caratteri questo mese',
    errors: {
      forbidden: 'Non hai i permessi per tradurre i contenuti.',
      invalid_request: 'Non è stato possibile inviare questo testo per la traduzione.',
      too_large: 'Il testo è troppo lungo per essere tradotto in una volta. Traducilo in parti più brevi.',
      project_not_found: 'Sito non trovato.',
      module_disabled: 'La traduzione non è attiva per questo sito.',
      provider_not_configured: 'Il servizio di traduzione non è ancora configurato. Contattaci.',
      quota_reached: 'Questo sito ha esaurito le traduzioni di questo mese. Contattaci per aumentare il limite.',
      usage_unavailable: 'La traduzione non è momentaneamente disponibile. Riprova tra qualche minuto.',
      provider_error: 'Il servizio di traduzione ha restituito un errore. Riprova.',
      network_error: 'Impossibile raggiungere il servizio di traduzione. Riprova.',
    },
  },
  fr: {
    translateFrom: 'Traduire depuis {source}',
    translating: 'Traduction en cours…',
    translated: 'Traduit en {targets}. Merci de vérifier le résultat.',
    nothingToTranslate: 'Rédigez d’abord le texte en {source}.',
    allTargetsProtected: 'Les autres langues contiennent déjà un texte rédigé ou relu par une personne : rien n’a été modifié.',
    sourceLabel: 'Traduire depuis',
    statusSource: 'Source',
    statusMissing: 'Manquant',
    statusOriginal: 'Original',
    statusMachine: 'Traduction automatique',
    statusReviewed: 'Relu',
    markReviewed: 'Marquer comme relu',
    usageWithQuota: '{used} sur {quota} caractères ce mois-ci',
    usageNoQuota: '{used} caractères ce mois-ci',
    errors: {
      forbidden: 'Vous n’êtes pas autorisé à traduire le contenu.',
      invalid_request: 'Ce texte n’a pas pu être envoyé à la traduction.',
      too_large: 'Ce texte est trop long pour être traduit en une fois. Traduisez-le en plusieurs parties.',
      project_not_found: 'Site introuvable.',
      module_disabled: 'La traduction n’est pas activée pour ce site.',
      provider_not_configured: 'Le service de traduction n’est pas encore configuré. Contactez-nous.',
      quota_reached: 'Ce site a utilisé toutes ses traductions pour ce mois. Contactez-nous pour augmenter la limite.',
      usage_unavailable: 'La traduction est momentanément indisponible. Réessayez dans quelques minutes.',
      provider_error: 'Le service de traduction a renvoyé une erreur. Réessayez.',
      network_error: 'Impossible de joindre le service de traduction. Réessayez.',
    },
  },
  de: {
    translateFrom: 'Aus {source} übersetzen',
    translating: 'Wird übersetzt…',
    translated: 'Übersetzt in {targets}. Bitte prüfen Sie das Ergebnis.',
    nothingToTranslate: 'Schreiben Sie zuerst den Text auf {source}.',
    allTargetsProtected: 'Die anderen Sprachen enthalten bereits von einer Person geschriebenen oder geprüften Text, daher wurde nichts geändert.',
    sourceLabel: 'Übersetzen aus',
    statusSource: 'Quelle',
    statusMissing: 'Fehlt',
    statusOriginal: 'Original',
    statusMachine: 'Maschinelle Übersetzung',
    statusReviewed: 'Geprüft',
    markReviewed: 'Als geprüft markieren',
    usageWithQuota: '{used} von {quota} Zeichen in diesem Monat',
    usageNoQuota: '{used} Zeichen in diesem Monat',
    errors: {
      forbidden: 'Sie dürfen keine Inhalte übersetzen.',
      invalid_request: 'Dieser Text konnte nicht zur Übersetzung gesendet werden.',
      too_large: 'Der Text ist zu lang für eine einzelne Übersetzung. Übersetzen Sie ihn in kleineren Teilen.',
      project_not_found: 'Die Website wurde nicht gefunden.',
      module_disabled: 'Die Übersetzung ist für diese Website nicht aktiviert.',
      provider_not_configured: 'Der Übersetzungsdienst ist noch nicht eingerichtet. Bitte kontaktieren Sie uns.',
      quota_reached: 'Diese Website hat ihr Übersetzungskontingent für diesen Monat aufgebraucht. Bitte kontaktieren Sie uns, um das Limit zu erhöhen.',
      usage_unavailable: 'Die Übersetzung ist vorübergehend nicht verfügbar. Bitte versuchen Sie es in einigen Minuten erneut.',
      provider_error: 'Der Übersetzungsdienst hat einen Fehler gemeldet. Bitte versuchen Sie es erneut.',
      network_error: 'Der Übersetzungsdienst ist nicht erreichbar. Bitte versuchen Sie es erneut.',
    },
  },
  es: {
    translateFrom: 'Traducir desde {source}',
    translating: 'Traduciendo…',
    translated: 'Traducido al {targets}. Revisa el resultado.',
    nothingToTranslate: 'Escribe primero el texto en {source}.',
    allTargetsProtected: 'Los demás idiomas ya tienen un texto escrito o revisado por una persona, así que no se ha cambiado nada.',
    sourceLabel: 'Traducir desde',
    statusSource: 'Origen',
    statusMissing: 'Falta',
    statusOriginal: 'Original',
    statusMachine: 'Traducción automática',
    statusReviewed: 'Revisado',
    markReviewed: 'Marcar como revisado',
    usageWithQuota: '{used} de {quota} caracteres este mes',
    usageNoQuota: '{used} caracteres este mes',
    errors: {
      forbidden: 'No tienes permiso para traducir contenido.',
      invalid_request: 'No se ha podido enviar este texto a traducir.',
      too_large: 'El texto es demasiado largo para traducirlo de una vez. Tradúcelo por partes.',
      project_not_found: 'No se ha encontrado el sitio web.',
      module_disabled: 'La traducción no está activada para este sitio web.',
      provider_not_configured: 'El servicio de traducción aún no está configurado. Ponte en contacto con nosotros.',
      quota_reached: 'Este sitio web ha agotado sus traducciones de este mes. Ponte en contacto con nosotros para ampliar el límite.',
      usage_unavailable: 'La traducción no está disponible en este momento. Inténtalo de nuevo en unos minutos.',
      provider_error: 'El servicio de traducción ha devuelto un error. Inténtalo de nuevo.',
      network_error: 'No se ha podido conectar con el servicio de traducción. Inténtalo de nuevo.',
    },
  },
  pt: {
    translateFrom: 'Traduzir de {source}',
    translating: 'A traduzir…',
    translated: 'Traduzido para {targets}. Verifique o resultado.',
    nothingToTranslate: 'Escreva primeiro o texto em {source}.',
    allTargetsProtected: 'As outras línguas já têm texto escrito ou revisto por uma pessoa, por isso nada foi alterado.',
    sourceLabel: 'Traduzir de',
    statusSource: 'Origem',
    statusMissing: 'Em falta',
    statusOriginal: 'Original',
    statusMachine: 'Tradução automática',
    statusReviewed: 'Revisto',
    markReviewed: 'Marcar como revisto',
    usageWithQuota: '{used} de {quota} caracteres este mês',
    usageNoQuota: '{used} caracteres este mês',
    errors: {
      forbidden: 'Não tem permissão para traduzir conteúdos.',
      invalid_request: 'Não foi possível enviar este texto para tradução.',
      too_large: 'O texto é demasiado longo para ser traduzido de uma só vez. Traduza-o em partes mais pequenas.',
      project_not_found: 'Site não encontrado.',
      module_disabled: 'A tradução não está ativada para este site.',
      provider_not_configured: 'O serviço de tradução ainda não está configurado. Contacte-nos.',
      quota_reached: 'Este site esgotou as traduções deste mês. Contacte-nos para aumentar o limite.',
      usage_unavailable: 'A tradução está temporariamente indisponível. Tente novamente dentro de alguns minutos.',
      provider_error: 'O serviço de tradução devolveu um erro. Tente novamente.',
      network_error: 'Não foi possível contactar o serviço de tradução. Tente novamente.',
    },
  },
  nl: {
    translateFrom: 'Vertalen uit {source}',
    translating: 'Bezig met vertalen…',
    translated: 'Vertaald naar {targets}. Controleer het resultaat.',
    nothingToTranslate: 'Schrijf eerst de tekst in het {source}.',
    allTargetsProtected: 'De andere talen hebben al tekst die door een persoon is geschreven of nagekeken, dus er is niets gewijzigd.',
    sourceLabel: 'Vertalen uit',
    statusSource: 'Bron',
    statusMissing: 'Ontbreekt',
    statusOriginal: 'Origineel',
    statusMachine: 'Machinevertaling',
    statusReviewed: 'Nagekeken',
    markReviewed: 'Markeren als nagekeken',
    usageWithQuota: '{used} van {quota} tekens deze maand',
    usageNoQuota: '{used} tekens deze maand',
    errors: {
      forbidden: 'U mag geen inhoud vertalen.',
      invalid_request: 'Deze tekst kon niet voor vertaling worden verstuurd.',
      too_large: 'De tekst is te lang om in één keer te vertalen. Vertaal hem in kleinere delen.',
      project_not_found: 'Website niet gevonden.',
      module_disabled: 'Vertalen is niet ingeschakeld voor deze website.',
      provider_not_configured: 'De vertaaldienst is nog niet ingesteld. Neem contact met ons op.',
      quota_reached: 'Deze website heeft alle vertalingen voor deze maand gebruikt. Neem contact met ons op om de limiet te verhogen.',
      usage_unavailable: 'Vertalen is tijdelijk niet beschikbaar. Probeer het over een paar minuten opnieuw.',
      provider_error: 'De vertaaldienst gaf een fout. Probeer het opnieuw.',
      network_error: 'De vertaaldienst is niet bereikbaar. Probeer het opnieuw.',
    },
  },
}

export const TRANSLATE_MESSAGE_LOCALES = Object.keys(MESSAGES)

export function getTranslateMessages(locale: string | undefined): TranslateMessages {
  return (locale && MESSAGES[locale]) || MESSAGES.en
}

export function formatTranslateMessage(
  template: string,
  values: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) =>
    key in values ? String(values[key]) : m
  )
}
