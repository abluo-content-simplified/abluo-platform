import { routing } from '@/i18n/routing'

/**
 * The platform's locale contract, enforced where a locale is REQUIRED.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `src/i18n/request.ts` falls back to `routing.defaultLocale` when the request
 * locale is missing. That fallback is correct and must stay: the `(platform)`
 * surfaces — login, password reset, invite acceptance, Studio — carry no locale
 * segment by design, and the platform default is the right answer for them.
 *
 * It is also what hid a platform-wide defect for months. On every tenant
 * website request `src/proxy.ts` rewrites rather than delegating to next-intl's
 * middleware, so the request locale was never established, the fallback fired
 * silently, and the whole app believed each page was English regardless of its
 * URL. Nothing failed; it just served the wrong language to next-intl, which
 * sent the language switcher to /fr/it and a 404. See
 * `src/app/[locale]/layout.tsx` for the full account.
 *
 * ── What this does ──────────────────────────────────────────────────────────
 * Inside a `[locale]` route the URL states the locale, so a resolved locale
 * that disagrees with it is a BUG, never a default. This makes that case loud
 * in development and in tests, where someone can act on it.
 *
 * It is deliberately inert in production: an assertion here would turn a
 * wrong-language page into a 500 for a real visitor, which is worse than the
 * defect it guards against. Production is covered by the Playwright suite in
 * `e2e/i18n`, which exercises the behaviour against a deployment before release.
 *
 * This is NOT a guard that repairs a value — it never changes what is returned.
 * It only refuses to let a broken contract pass unnoticed.
 */
export function assertLocaleEstablished(urlLocale: string, resolvedLocale: string): void {
  if (process.env.NODE_ENV === 'production') return
  if (urlLocale === resolvedLocale) return

  throw new Error(
    `[i18n] Locale contract violated: the URL says "${urlLocale}" but next-intl ` +
      `resolved "${resolvedLocale}".\n\n` +
      `Inside a [locale] route the URL is the only source of truth. This means ` +
      `the request locale was not established before next-intl read it — ` +
      `src/i18n/request.ts then fell back to routing.defaultLocale ` +
      `("${routing.defaultLocale}").\n\n` +
      `Check that src/app/[locale]/layout.tsx still calls setRequestLocale(locale) ` +
      `before anything reads a translation, and that no route renders next-intl ` +
      `content outside that layout. Every tenant website request reaches the app ` +
      `through a rewrite in src/proxy.ts and never touches next-intl's ` +
      `middleware, so this layout is the only thing establishing the locale.`
  )
}
