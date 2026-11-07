import 'server-only'
// ── Reservations — the production Booking rules store (service role) ──────────
// Each call opens the audited trusted-operation wrapper (like client.server.ts).
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { createSettingsStore, type SettingsDb, type SettingsStore } from './settings-store'

const REASON = 'ADR-044 reservations: reservation_settings / price_categories, server-only tables (migration 066)'

export function getSettingsStore(): SettingsStore {
  const proxy = <K extends keyof SettingsStore>(name: K) =>
    ((...args: unknown[]) =>
      runAsTrustedSystemOperation(REASON, (sb) =>
        (createSettingsStore(sb as unknown as SettingsDb)[name] as (...a: unknown[]) => Promise<unknown>)(...args),
      )) as SettingsStore[K]
  return { get: proxy('get'), save: proxy('save'), listPriceCategories: proxy('listPriceCategories') }
}
