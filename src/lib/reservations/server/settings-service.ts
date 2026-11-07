// ── Reservations — Booking rules service (ADR-044 D7, D9, D13, D16.14/15) ─────
//
// The one reader/writer behind the Booking rules page. Authorisation first
// (module installed for THIS project + permission, ADR-015 steps 4–5), then the
// project's capabilities and site languages (Sanity, read-only), then the store.
//   read  → reservations.booking.read
//   write → reservations.settings.manage (never in support mode)
// The project id comes from the caller's grant, never from input.
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveReservationCapabilities } from '@/lib/modules/reservations/capabilities'
import {
  applyRulesInput,
  valuesFromSettings,
  validateRulesInput,
  visibilityOf,
  type RulesErrors,
  type RulesValues,
  type RulesVisibility,
} from '../rules-form'
import type { SettingsStore } from './settings-store'

export const BOOKING_READ_PERMISSION = 'reservations.booking.read'
export const SETTINGS_MANAGE_PERMISSION = 'reservations.settings.manage'

/** What the page needs from Sanity: the Reservations installation config and the site's languages. */
export type SiteFacts = {
  config: Record<string, unknown> | null
  defaultLocale: string
  /** Default language first. */
  languages: string[]
}

export function siteFactsOf(r: { config?: unknown; site?: { defaultLocale?: unknown; supportedLocales?: unknown } | null } | null): SiteFacts {
  const supported = Array.isArray(r?.site?.supportedLocales) ? (r!.site!.supportedLocales as unknown[]).filter((x): x is string => typeof x === 'string' && !!x) : []
  const defaultLocale = (typeof r?.site?.defaultLocale === 'string' && r.site.defaultLocale) || supported[0] || 'en'
  return {
    config: r?.config && typeof r.config === 'object' && !Array.isArray(r.config) ? (r.config as Record<string, unknown>) : null,
    defaultLocale,
    languages: [defaultLocale, ...supported.filter((l) => l !== defaultLocale)],
  }
}

export type RulesDeps = {
  store: SettingsStore
  readSite: (projectSlug: string) => Promise<SiteFacts>
}

export type RulesView = {
  /** 0 = nothing saved yet (defaults shown). */
  version: number
  values: RulesValues
  /** Which sections exist for this project (from Abluo's capabilities, which the tenant never sees). */
  visibility: RulesVisibility
  defaultLocale: string
  languages: string[]
  canManage: boolean
}

export type LoadResult = { ok: true; view: RulesView } | { ok: false; error: 'unavailable' }

export type SaveError = 'invalid' | 'conflict' | 'unavailable'
export type SaveResult =
  | { ok: true; view: RulesView }
  | { ok: false; error: SaveError; errors?: RulesErrors }

function grantFor(ctx: TenantAuthorizationContext, projectId: string, permission: string) {
  assertModuleAction(ctx, projectId, permission)
  return ctx.projects.find((p) => p.projectId === projectId)!
}

function holds(ctx: TenantAuthorizationContext, projectId: string, permission: string): boolean {
  try {
    assertModuleAction(ctx, projectId, permission)
    return true
  } catch {
    return false
  }
}

/** Throws TenantAuthorizationError when the caller may not read bookings of this project. */
export async function loadBookingRules(ctx: TenantAuthorizationContext, projectId: string, deps: RulesDeps): Promise<LoadResult> {
  const grant = grantFor(ctx, projectId, BOOKING_READ_PERMISSION)
  const [site, stored] = await Promise.all([deps.readSite(grant.projectSlug), deps.store.get(projectId)])
  if (!stored.ok) return { ok: false, error: 'unavailable' }
  const capabilities = resolveReservationCapabilities(site.config)
  return {
    ok: true,
    view: {
      version: stored.value?.version ?? 0,
      values: valuesFromSettings(stored.value ?? { rules: {}, bankDetails: null, paymentInstructions: null, referencePrefix: null }),
      visibility: visibilityOf(capabilities),
      defaultLocale: site.defaultLocale,
      languages: site.languages,
      canManage: holds(ctx, projectId, SETTINGS_MANAGE_PERMISSION),
    },
  }
}

/** Throws TenantAuthorizationError without `reservations.settings.manage`. */
export async function saveBookingRules(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { expectedVersion: unknown; values: unknown },
  deps: RulesDeps,
): Promise<SaveResult> {
  const grant = grantFor(ctx, projectId, SETTINGS_MANAGE_PERMISSION)
  const expected = typeof input.expectedVersion === 'number' && Number.isInteger(input.expectedVersion) && input.expectedVersion >= 0 ? input.expectedVersion : null
  if (expected === null) return { ok: false, error: 'invalid' }

  const site = await deps.readSite(grant.projectSlug)
  const caps = resolveReservationCapabilities(site.config)
  const checked = validateRulesInput(input.values, visibilityOf(caps), site.languages)
  if (!checked.ok) return { ok: false, error: 'invalid', errors: checked.errors }

  const current = await deps.store.get(projectId)
  if (!current.ok) return { ok: false, error: 'unavailable' }
  if ((current.value?.version ?? 0) !== expected) return { ok: false, error: 'conflict' }

  const v = checked.value
  const saved = await deps.store.save(projectId, expected, {
    rules: applyRulesInput(current.value?.rules, v, visibilityOf(caps)),
    bankDetails: v.bankDetails,
    paymentInstructions: v.paymentInstructions,
    referencePrefix: v.referencePrefix,
  })
  if (!saved.ok) return { ok: false, error: saved.error.kind === 'conflict' ? 'conflict' : saved.error.kind === 'refused' ? 'invalid' : 'unavailable' }

  return {
    ok: true,
    view: {
      version: saved.value.version,
      values: valuesFromSettings(saved.value),
      visibility: visibilityOf(caps),
      defaultLocale: site.defaultLocale,
      languages: site.languages,
      canManage: true,
    },
  }
}
