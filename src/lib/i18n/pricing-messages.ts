/**
 * Pricing sections UI messages (pricingCardsSection, comparisonTableSection).
 *
 * Platform chrome only — plan names, prices, bullets and notes are content in
 * the section. Same pattern as price-list-messages.ts: one dictionary per
 * platform locale, English fallback.
 *
 * Templates use {name} placeholders, filled by fillTemplate() in
 * src/lib/pricing/billing.ts. Never concatenate translated fragments.
 */

export interface PricingMessages {
  /** Accessible name of the monthly / yearly switch (visually hidden legend). */
  billingPeriod: string
  monthly: string
  yearly: string
  /** Switch badge when every card saves the same: "Save {percent}%". */
  save: string
  /** Switch badge when savings differ: "Save up to {percent}%". */
  saveUpTo: string
  /** Visible unit after a price ("/ month") and its spoken form ("per month"). */
  perMonth: string
  perMonthSpoken: string
  perYear: string
  perYearSpoken: string
  /** Short form used in table headers: "€29/mo". */
  perMonthShort: string
  /** Line under a monthly price. */
  billedMonthly: string
  /** Line under the monthly equivalent of a yearly price. */
  yearlyLine: string
  /** Same, when the yearly price saves nothing. */
  yearlyLineNoSaving: string
  /** Compact cards, yearly total: "{yearly} / year (save {saving})". */
  yearlyTotalSaving: string
  /** Comparison table cells. */
  included: string
  notIncluded: string
}

const MESSAGES: Record<string, PricingMessages> = {
  en: {
    billingPeriod: 'Billing period',
    monthly: 'Monthly',
    yearly: 'Yearly',
    save: 'Save {percent}%',
    saveUpTo: 'Save up to {percent}%',
    perMonth: '/ month',
    perMonthSpoken: 'per month',
    perYear: '/ year',
    perYearSpoken: 'per year',
    perMonthShort: '/mo',
    billedMonthly: 'Billed monthly, cancel any time',
    yearlyLine: '{yearly} a year instead of {full}. You save {saving} every year.',
    yearlyLineNoSaving: '{yearly} billed yearly',
    yearlyTotalSaving: '{yearly} / year (save {saving})',
    included: 'Included',
    notIncluded: 'Not included',
  },
  it: {
    billingPeriod: 'Periodo di fatturazione',
    monthly: 'Mensile',
    yearly: 'Annuale',
    save: 'Risparmi il {percent}%',
    saveUpTo: 'Risparmi fino al {percent}%',
    perMonth: '/ mese',
    perMonthSpoken: 'al mese',
    perYear: '/ anno',
    perYearSpoken: "all'anno",
    perMonthShort: '/mese',
    billedMonthly: 'Fatturato mensilmente, disdici quando vuoi',
    yearlyLine: '{yearly} all’anno invece di {full}. Risparmi {saving} ogni anno.',
    yearlyLineNoSaving: '{yearly} fatturati annualmente',
    yearlyTotalSaving: '{yearly} / anno (risparmi {saving})',
    included: 'Incluso',
    notIncluded: 'Non incluso',
  },
  de: {
    billingPeriod: 'Abrechnungszeitraum',
    monthly: 'Monatlich',
    yearly: 'Jährlich',
    save: '{percent} % sparen',
    saveUpTo: 'Bis zu {percent} % sparen',
    perMonth: '/ Monat',
    perMonthSpoken: 'pro Monat',
    perYear: '/ Jahr',
    perYearSpoken: 'pro Jahr',
    perMonthShort: '/Monat',
    billedMonthly: 'Monatliche Abrechnung, jederzeit kündbar',
    yearlyLine: '{yearly} pro Jahr statt {full}. Jedes Jahr {saving} gespart.',
    yearlyLineNoSaving: '{yearly} jährlich abgerechnet',
    yearlyTotalSaving: '{yearly} / Jahr ({saving} gespart)',
    included: 'Inklusive',
    notIncluded: 'Nicht enthalten',
  },
  fr: {
    billingPeriod: 'Période de facturation',
    monthly: 'Mensuel',
    yearly: 'Annuel',
    save: 'Économisez {percent} %',
    saveUpTo: "Économisez jusqu'à {percent} %",
    perMonth: '/ mois',
    perMonthSpoken: 'par mois',
    perYear: '/ an',
    perYearSpoken: 'par an',
    perMonthShort: '/mois',
    billedMonthly: 'Facturé chaque mois, résiliable à tout moment',
    yearlyLine: '{yearly} par an au lieu de {full}. Vous économisez {saving} chaque année.',
    yearlyLineNoSaving: '{yearly} facturés chaque année',
    yearlyTotalSaving: '{yearly} / an (économie de {saving})',
    included: 'Inclus',
    notIncluded: 'Non inclus',
  },
  es: {
    billingPeriod: 'Periodo de facturación',
    monthly: 'Mensual',
    yearly: 'Anual',
    save: 'Ahorra un {percent} %',
    saveUpTo: 'Ahorra hasta un {percent} %',
    perMonth: '/ mes',
    perMonthSpoken: 'al mes',
    perYear: '/ año',
    perYearSpoken: 'al año',
    perMonthShort: '/mes',
    billedMonthly: 'Facturación mensual, cancela cuando quieras',
    yearlyLine: '{yearly} al año en lugar de {full}. Ahorras {saving} cada año.',
    yearlyLineNoSaving: '{yearly} facturados anualmente',
    yearlyTotalSaving: '{yearly} / año (ahorras {saving})',
    included: 'Incluido',
    notIncluded: 'No incluido',
  },
  pt: {
    billingPeriod: 'Período de faturação',
    monthly: 'Mensal',
    yearly: 'Anual',
    save: 'Poupe {percent}%',
    saveUpTo: 'Poupe até {percent}%',
    perMonth: '/ mês',
    perMonthSpoken: 'por mês',
    perYear: '/ ano',
    perYearSpoken: 'por ano',
    perMonthShort: '/mês',
    billedMonthly: 'Faturação mensal, cancele quando quiser',
    yearlyLine: '{yearly} por ano em vez de {full}. Poupa {saving} todos os anos.',
    yearlyLineNoSaving: '{yearly} faturados anualmente',
    yearlyTotalSaving: '{yearly} / ano (poupa {saving})',
    included: 'Incluído',
    notIncluded: 'Não incluído',
  },
  nl: {
    billingPeriod: 'Factuurperiode',
    monthly: 'Maandelijks',
    yearly: 'Jaarlijks',
    save: 'Bespaar {percent}%',
    saveUpTo: 'Bespaar tot {percent}%',
    perMonth: '/ maand',
    perMonthSpoken: 'per maand',
    perYear: '/ jaar',
    perYearSpoken: 'per jaar',
    perMonthShort: '/mnd',
    billedMonthly: 'Maandelijks gefactureerd, altijd opzegbaar',
    yearlyLine: '{yearly} per jaar in plaats van {full}. Je bespaart elk jaar {saving}.',
    yearlyLineNoSaving: '{yearly} jaarlijks gefactureerd',
    yearlyTotalSaving: '{yearly} / jaar (bespaar {saving})',
    included: 'Inbegrepen',
    notIncluded: 'Niet inbegrepen',
  },
}

export function getPricingMessages(locale: string | undefined): PricingMessages {
  return (locale && MESSAGES[locale]) || MESSAGES.en
}

export const PRICING_MESSAGES_FOR_TEST = MESSAGES
