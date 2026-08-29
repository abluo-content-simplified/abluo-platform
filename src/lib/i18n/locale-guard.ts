// ─── Tenant locale guard (bug L-2) ────────────────────────────────────────────
//
// Two locale lists exist and only one of them was ever enforced:
//
//   Platform locales — LOCALE_CODES / routing.locales (en it de fr es pt nl).
//                      Checked in src/app/[locale]/layout.tsx.
//   Project locales  — siteConfig.supportedLocales, what a single site CHOSE
//                      to enable. Checked nowhere, so every tenant served all
//                      seven platform locales: /de on a project whose locales
//                      are [it, en] returned 200 with German UI chrome over
//                      Italian content — indexable duplicate content.
//
// This predicate is the project-level half of that pair. It is deliberately a
// pure function so the allow/deny/missing-config matrix is testable without
// booting the tenant layout's Sanity + React dependency graph (a Next.js layout
// module may not export anything but the framework's own fields).

import type { SupportedLocale } from './locales'

export interface ProjectLocaleConfig {
  defaultLocale?: SupportedLocale
  supportedLocales?: SupportedLocale[]
}

/**
 * Is `locale` enabled for this project?
 *
 * Fallback policy when configuration is incomplete — the safe direction differs
 * per case, because "no siteConfig document" and "a siteConfig that lists no
 * locales" are different failures:
 *
 *  - `localeConfig` null/undefined: the query returned nothing — an unlaunched
 *    project, or a degraded Sanity read. Fail OPEN (allow). 404-ing the entire
 *    site of every project without a siteConfig is far worse than serving a few
 *    duplicate locale URLs, and the platform-level guard still caps the segment
 *    to the seven registry locales.
 *  - `supportedLocales` missing/empty but a document exists: the project IS
 *    configured, it just never filled the list. Fail CLOSED to the project's
 *    own defaultLocale (or 'en'), so the site serves one locale rather than
 *    seven copies of it.
 *  - `defaultLocale` is always allowed, even if absent from supportedLocales.
 *    Inconsistent data must never 404 the locale the site redirects to.
 */
export function isLocaleEnabledForProject(
  locale: string,
  localeConfig: ProjectLocaleConfig | null | undefined
): boolean {
  if (!localeConfig) return true

  const supported = localeConfig.supportedLocales
  const fallbackLocale: string = localeConfig.defaultLocale ?? 'en'

  if (!Array.isArray(supported) || supported.length === 0) {
    return locale === fallbackLocale
  }

  return supported.includes(locale as SupportedLocale) || locale === fallbackLocale
}
