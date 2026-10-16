import { describe, it, expect, afterEach } from 'vitest'
import { assertLocaleEstablished } from '@/lib/i18n/locale-contract'

/**
 * The contract itself. It must be loud where someone can act on it and silent
 * where a throw would hurt a visitor — see locale-contract.ts for why.
 */
const setEnv = (value: string) => {
  Object.defineProperty(process.env, 'NODE_ENV', {
    value,
    configurable: true,
    writable: true,
    enumerable: true,
  })
}
const original = process.env.NODE_ENV

describe('the locale contract', () => {
  afterEach(() => setEnv(original ?? 'test'))

  it('passes silently when the URL and next-intl agree', () => {
    for (const locale of ['en', 'it', 'de', 'fr', 'nl', 'pt', 'es']) {
      expect(() => assertLocaleEstablished(locale, locale)).not.toThrow()
    }
  })

  it('throws when they disagree, naming both', () => {
    // The exact production shape: URL says Italian, next-intl answers English
    // because the request locale was never established.
    expect(() => assertLocaleEstablished('it', 'en')).toThrow(/Locale contract violated/)
    expect(() => assertLocaleEstablished('it', 'en')).toThrow(/"it"/)
    expect(() => assertLocaleEstablished('it', 'en')).toThrow(/"en"/)
  })

  it('points at the cause rather than the symptom', () => {
    // A future reader hitting this needs to know where to look, not just that
    // something is wrong.
    expect(() => assertLocaleEstablished('de', 'en')).toThrow(/setRequestLocale/)
    expect(() => assertLocaleEstablished('de', 'en')).toThrow(/proxy\.ts/)
  })

  it('never throws in production', () => {
    // A wrong-language page is bad; a 500 for a real visitor is worse. The
    // Playwright suite in e2e/i18n covers deployments instead.
    setEnv('production')
    expect(() => assertLocaleEstablished('it', 'en')).not.toThrow()
  })

  it('throws in development and in test', () => {
    for (const env of ['development', 'test']) {
      setEnv(env)
      expect(() => assertLocaleEstablished('fr', 'en')).toThrow()
    }
  })
})
