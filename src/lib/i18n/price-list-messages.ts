/**
 * Price list section UI messages.
 *
 * Platform chrome for PriceListSection: the unit words used by the optional
 * "price per period" line ("€25.00/month", "25,00 €/mois") and by the
 * automatic quantity sub-label ("12 months", "12 mois"). Not tenant content —
 * labels, prices and notes are content in the section — so the words live in
 * a locale dictionary (same pattern as team-section-messages.ts).
 *
 * Per unit:
 *   one / other — the noun after a count, chosen with Intl.PluralRules
 *                 ("1 month" / "12 months"). `one` is also the word after the
 *                 slash in the per-period line.
 *   per         — the spoken form for screen readers ("per month"), so the
 *                 slash is never the only thing that carries the meaning.
 */

export const PER_PERIOD_UNITS = ['month', 'week', 'day', 'hour', 'session', 'person'] as const
export type PerPeriodUnit = (typeof PER_PERIOD_UNITS)[number]

export interface UnitWords {
  one: string
  other: string
  per: string
}

export interface PriceListMessages {
  units: Record<PerPeriodUnit, UnitWords>
}

const MESSAGES: Record<string, PriceListMessages> = {
  en: {
    units: {
      month: { one: 'month', other: 'months', per: 'per month' },
      week: { one: 'week', other: 'weeks', per: 'per week' },
      day: { one: 'day', other: 'days', per: 'per day' },
      hour: { one: 'hour', other: 'hours', per: 'per hour' },
      session: { one: 'session', other: 'sessions', per: 'per session' },
      person: { one: 'person', other: 'people', per: 'per person' },
    },
  },
  it: {
    units: {
      month: { one: 'mese', other: 'mesi', per: 'al mese' },
      week: { one: 'settimana', other: 'settimane', per: 'a settimana' },
      day: { one: 'giorno', other: 'giorni', per: 'al giorno' },
      hour: { one: 'ora', other: 'ore', per: "all'ora" },
      session: { one: 'seduta', other: 'sedute', per: 'a seduta' },
      person: { one: 'persona', other: 'persone', per: 'a persona' },
    },
  },
  de: {
    units: {
      month: { one: 'Monat', other: 'Monate', per: 'pro Monat' },
      week: { one: 'Woche', other: 'Wochen', per: 'pro Woche' },
      day: { one: 'Tag', other: 'Tage', per: 'pro Tag' },
      hour: { one: 'Stunde', other: 'Stunden', per: 'pro Stunde' },
      session: { one: 'Sitzung', other: 'Sitzungen', per: 'pro Sitzung' },
      person: { one: 'Person', other: 'Personen', per: 'pro Person' },
    },
  },
  fr: {
    units: {
      month: { one: 'mois', other: 'mois', per: 'par mois' },
      week: { one: 'semaine', other: 'semaines', per: 'par semaine' },
      day: { one: 'jour', other: 'jours', per: 'par jour' },
      hour: { one: 'heure', other: 'heures', per: 'par heure' },
      session: { one: 'séance', other: 'séances', per: 'par séance' },
      person: { one: 'personne', other: 'personnes', per: 'par personne' },
    },
  },
  es: {
    units: {
      month: { one: 'mes', other: 'meses', per: 'al mes' },
      week: { one: 'semana', other: 'semanas', per: 'a la semana' },
      day: { one: 'día', other: 'días', per: 'al día' },
      hour: { one: 'hora', other: 'horas', per: 'por hora' },
      session: { one: 'sesión', other: 'sesiones', per: 'por sesión' },
      person: { one: 'persona', other: 'personas', per: 'por persona' },
    },
  },
  pt: {
    units: {
      month: { one: 'mês', other: 'meses', per: 'por mês' },
      week: { one: 'semana', other: 'semanas', per: 'por semana' },
      day: { one: 'dia', other: 'dias', per: 'por dia' },
      hour: { one: 'hora', other: 'horas', per: 'por hora' },
      session: { one: 'sessão', other: 'sessões', per: 'por sessão' },
      person: { one: 'pessoa', other: 'pessoas', per: 'por pessoa' },
    },
  },
  nl: {
    units: {
      month: { one: 'maand', other: 'maanden', per: 'per maand' },
      week: { one: 'week', other: 'weken', per: 'per week' },
      day: { one: 'dag', other: 'dagen', per: 'per dag' },
      hour: { one: 'uur', other: 'uur', per: 'per uur' },
      session: { one: 'sessie', other: 'sessies', per: 'per sessie' },
      person: { one: 'persoon', other: 'personen', per: 'per persoon' },
    },
  },
}

export function getPriceListMessages(locale: string | undefined): PriceListMessages {
  return (locale && MESSAGES[locale]) || MESSAGES.en
}

export const PRICE_LIST_MESSAGES_FOR_TEST = MESSAGES
