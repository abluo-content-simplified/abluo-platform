// ─── Platform Locale Registry ─────────────────────────────────────────────────
//
// SINGLE SOURCE OF TRUTH for all languages the Abluo platform supports.
//
// Architecture:
//   Platform locales  = what Abluo CAN support (defined here)
//   Tenant locales    = what each site CHOOSES to enable (siteConfig.supportedLocales)
//
// Adding a new language:
//   1. Add an entry to PLATFORM_LOCALES below
//   2. Add a messages/<code>.json file for admin UI translations
//   3. Deploy
//   After deploy, any tenant can enable the language via siteConfig — no further deployment needed.
//
// ─────────────────────────────────────────────────────────────────────────────

export interface LocaleDefinition {
  code: string
  name: string        // English name
  nativeName: string  // Name in that language
  rtl: boolean        // Right-to-left script (Arabic, Hebrew, etc.)
}

export const PLATFORM_LOCALES = {
  en: { code: 'en', name: 'English',    nativeName: 'English',    rtl: false },
  it: { code: 'it', name: 'Italian',    nativeName: 'Italiano',   rtl: false },
  de: { code: 'de', name: 'German',     nativeName: 'Deutsch',    rtl: false },
  fr: { code: 'fr', name: 'French',     nativeName: 'Français',   rtl: false },
  es: { code: 'es', name: 'Spanish',    nativeName: 'Español',    rtl: false },
  pt: { code: 'pt', name: 'Portuguese', nativeName: 'Português',  rtl: false },
  nl: { code: 'nl', name: 'Dutch',      nativeName: 'Nederlands', rtl: false },
} as const satisfies Record<string, LocaleDefinition>

// Derived types — do not edit manually, edit PLATFORM_LOCALES above.

export type SupportedLocale = keyof typeof PLATFORM_LOCALES

export const LOCALE_CODES = Object.keys(PLATFORM_LOCALES) as SupportedLocale[]

// Short label used in the UI switcher (e.g. "EN", "IT")
export const LOCALE_LABELS: Record<SupportedLocale, string> = Object.fromEntries(
  LOCALE_CODES.map((code) => [code, code.toUpperCase()])
) as Record<SupportedLocale, string>

// Full name in the language's own script (e.g. "Italiano", "Deutsch")
export const LOCALE_NATIVE_NAMES: Record<SupportedLocale, string> = Object.fromEntries(
  LOCALE_CODES.map((code) => [code, PLATFORM_LOCALES[code].nativeName])
) as Record<SupportedLocale, string>

// Full name in English (e.g. "Italian", "German")
export const LOCALE_ENGLISH_NAMES: Record<SupportedLocale, string> = Object.fromEntries(
  LOCALE_CODES.map((code) => [code, PLATFORM_LOCALES[code].name])
) as Record<SupportedLocale, string>

// RTL codes — for future use when Arabic/Hebrew are added
export const RTL_LOCALES = LOCALE_CODES.filter((code) => PLATFORM_LOCALES[code].rtl)
