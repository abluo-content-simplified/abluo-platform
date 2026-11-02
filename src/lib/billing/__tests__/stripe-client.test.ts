import { describe, expect, it } from 'vitest'
import { checkStripeKey } from '../stripe/client'

describe('checkStripeKey (ADR-041 D6)', () => {
  it('production needs a live restricted key; every other environment a test restricted key', () => {
    expect(checkStripeKey('rk_live_abc', 'production')).toEqual({ ok: true, livemode: true })
    expect(checkStripeKey('rk_test_abc', 'dev')).toEqual({ ok: true, livemode: false })
    expect(checkStripeKey('rk_test_abc', 'local')).toEqual({ ok: true, livemode: false })
    expect(checkStripeKey('rk_test_abc', 'production')).toEqual({ ok: false, reason: 'mode_mismatch' })
    expect(checkStripeKey('rk_live_abc', 'preview')).toEqual({ ok: false, reason: 'mode_mismatch' })
  })
  it('refuses secret keys, a missing key and an unknown environment', () => {
    expect(checkStripeKey('sk_live_abc', 'production')).toEqual({ ok: false, reason: 'secret_key' })
    expect(checkStripeKey('sk_test_abc', 'dev')).toEqual({ ok: false, reason: 'secret_key' })
    expect(checkStripeKey(undefined, 'dev')).toEqual({ ok: false, reason: 'missing' })
    expect(checkStripeKey('rk_test_abc', null)).toEqual({ ok: false, reason: 'unknown_environment' })
  })
})
