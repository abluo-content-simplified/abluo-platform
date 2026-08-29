import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// next-intl resolves `next-intl/server` through the "react-server" export
// condition. Vitest runs under the default condition, where getRequestConfig()
// returns a throwing stub, so stub it with the identity function it really is
// in an RSC environment (see next-intl/dist/.../react-server/getRequestConfig).
vi.mock('next-intl/server', () => ({
  getRequestConfig: (fn: unknown) => fn,
}))

import requestConfig from '../request'
import en from '../../../messages/en.json'
import itMessages from '../../../messages/it.json'

/**
 * Bug L-1 — request.ts imported `messages/${locale}.json` with no try/catch,
 * while the Platform Locale Registry advertises seven locales and only
 * en/de/it bundles exist. An unbundled locale must degrade to English rather
 * than throw. (Not currently reachable from the public site, which uses the
 * hand-rolled maps in src/lib/i18n/*-messages.ts, but reachable the moment a
 * useTranslations() call site lands on a public route.)
 */
const call = (locale: string | undefined) =>
  (requestConfig as unknown as (p: {
    requestLocale: Promise<string | undefined>
  }) => Promise<{ locale: string; messages: unknown }>)({ requestLocale: Promise.resolve(locale) })

const MISSING = ['fr', 'es', 'pt', 'nl']

describe('i18n request config — message bundle fallback', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warn.mockRestore()
  })

  it('loads the real bundle for a locale that has one', async () => {
    for (const [locale, bundle] of [['it', itMessages], ['en', en]] as const) {
      const cfg = await call(locale)
      expect(cfg.locale).toBe(locale)
      expect(cfg.messages).toEqual(bundle)
    }
    expect(warn).not.toHaveBeenCalled()
  })

  it('yields the English bundle instead of throwing for an advertised locale with no bundle', async () => {
    for (const locale of MISSING) {
      const cfg = await call(locale)
      // The locale is still honoured for formatting; only the messages fall back.
      expect(cfg.locale).toBe(locale)
      expect(cfg.messages).toEqual(en)
    }
  })

  it('warns exactly once per missing locale, naming it — not once per request', async () => {
    // Every locale in MISSING was already warned about by the test above, so a
    // second round must add no warnings at all.
    for (const locale of MISSING) {
      await call(locale)
      await call(locale)
    }
    expect(warn).not.toHaveBeenCalled()

    // A locale that HAS a bundle never warns.
    await call('de')
    expect(warn).not.toHaveBeenCalled()
  })

  it('falls back to the default locale for a segment outside the registry', async () => {
    const cfg = await call('zz')
    expect(cfg.locale).toBe('en')
    expect(cfg.messages).toEqual(en)
    expect(warn).not.toHaveBeenCalled()
  })

  it('falls back to the default locale when none is supplied', async () => {
    const cfg = await call(undefined)
    expect(cfg.locale).toBe('en')
    expect(cfg.messages).toEqual(en)
  })
})

describe('i18n request config — the warning itself', () => {
  it('names the missing locale the first time it is seen', async () => {
    // Fresh module registry so the warned-locales set starts empty.
    vi.resetModules()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const fresh = (await import('../request')).default as unknown as (p: {
        requestLocale: Promise<string | undefined>
      }) => Promise<{ locale: string; messages: unknown }>
      const cfg = await fresh({ requestLocale: Promise.resolve('fr') })
      expect(cfg.messages).toEqual(en)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain('fr')
      await fresh({ requestLocale: Promise.resolve('fr') })
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })
})
