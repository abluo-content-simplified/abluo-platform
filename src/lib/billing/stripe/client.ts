// Server-only. Never import from a client component.
/**
 * The one Stripe client — ADR-041 D6 (restricted keys, mode follows the
 * environment). Lazily created so builds never need a key.
 *
 *   STRIPE_API_KEY         restricted key: rk_live_… in production, rk_test_… elsewhere
 *   STRIPE_WEBHOOK_SECRET  whsec_… of the endpoint for this environment
 *
 * A missing key, a full secret key (sk_…) or a key of the wrong mode disables
 * billing with one logged error — it is never "used anyway".
 */
import Stripe from 'stripe'
import { resolveAccessEnvironment, type AccessEnvironment } from '@/lib/access/environment'

/** Pinned API version (Stripe SDK 23.1.0 default; see the upgrade-stripe skill before changing). */
export const STRIPE_API_VERSION = '2026-10-28.endive'

export type StripeKeyCheck =
  | { ok: true; livemode: boolean }
  | { ok: false; reason: 'missing' | 'secret_key' | 'mode_mismatch' | 'unknown_environment' }

/** Pure: may this key be used in this environment? */
export function checkStripeKey(key: string | undefined, env: AccessEnvironment | null): StripeKeyCheck {
  if (!key) return { ok: false, reason: 'missing' }
  if (env === null) return { ok: false, reason: 'unknown_environment' }
  if (/^sk_/.test(key)) return { ok: false, reason: 'secret_key' }
  const live = env === 'production'
  if (live && key.startsWith('rk_live_')) return { ok: true, livemode: true }
  if (!live && key.startsWith('rk_test_')) return { ok: true, livemode: false }
  return { ok: false, reason: 'mode_mismatch' }
}

let cached: { key: string; client: Stripe } | null = null
let warned = false

/** The Stripe client for this environment, or null when billing is not configured (logged once). */
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_API_KEY
  const check = checkStripeKey(key, resolveAccessEnvironment())
  if (!check.ok) {
    if (!warned && check.reason !== 'missing') console.error(`[billing] Stripe disabled: ${check.reason}`)
    warned = true
    return null
  }
  if (!cached || cached.key !== key) {
    cached = {
      key: key!,
      client: new Stripe(key!, { apiVersion: STRIPE_API_VERSION, appInfo: { name: 'Abluo' }, maxNetworkRetries: 2 }),
    }
  }
  return cached.client
}

export function stripeWebhookSecret(): string | null {
  const s = process.env.STRIPE_WEBHOOK_SECRET
  return s && s.startsWith('whsec_') ? s : null
}
