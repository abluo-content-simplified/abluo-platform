/**
 * `og:locale` wants a language_TERRITORY tag (`it_IT`), not the bare URL code.
 * One table for every route — it used to be repeated inline per route, and
 * the routes without a copy (news index, news articles) emitted no og:locale.
 */
const OG_LOCALES: Record<string, string> = {
  en: 'en_US',
  it: 'it_IT',
  de: 'de_DE',
  fr: 'fr_FR',
  es: 'es_ES',
  pt: 'pt_PT',
  nl: 'nl_NL',
}

export function ogLocale(locale: string): string {
  return OG_LOCALES[locale] ?? locale
}
