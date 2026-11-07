/**
 * Booking rules service (ADR-044 D7, D13): permission refused before any I/O,
 * project scoping, validation, optimistic version conflict, capabilities, and
 * the "not available yet" state when migration 066 is missing.
 */
import { describe, expect, it, vi } from 'vitest'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { fail, ok } from '../errors'
import { loadBookingRules, saveBookingRules, siteFactsOf, type RulesDeps, type SiteFacts } from '../settings-service'
import type { SettingsStore, StoredSettings } from '../settings-store'
import { valuesFromSettings } from '../../rules-form'

const PID = '11111111-1111-4111-8111-111111111111'
const OTHER = '99999999-9999-4999-8999-999999999999'
const OWNER = ['reservations.booking.read', 'reservations.settings.manage']
const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: PID,
  projectSlug: asSupabaseProjectSlug('cyce'),
  membershipId: 'm1',
  role: 'owner',
  permissions: OWNER,
  enabledModuleIds: ['reservations'],
  ...o,
})
const ctx = (...g: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: g })

const site = (config: Record<string, unknown> | null = null): SiteFacts => ({ config, defaultLocale: 'en', languages: ['en', 'it'] })

function harness(initial: StoredSettings | null = null, siteFacts: SiteFacts = site()) {
  let row = initial
  const store: SettingsStore = {
    get: vi.fn(async (projectId: string) => ok(projectId === PID ? row : null)),
    save: vi.fn(async (projectId, expected, write) => {
      if ((row?.version ?? 0) !== expected) return fail({ kind: 'conflict', code: 'changed' })
      row = { projectId, rules: write.rules, bankDetails: write.bankDetails, paymentInstructions: write.paymentInstructions, referencePrefix: write.referencePrefix, version: expected + 1 }
      return ok(row)
    }),
    listPriceCategories: vi.fn(async () => ok([])),
  }
  const readSite = vi.fn(async () => siteFacts)
  const deps: RulesDeps = { store, readSite }
  return { deps, store, readSite, row: () => row }
}

const defaults = () => valuesFromSettings({ rules: {}, bankDetails: null, paymentInstructions: null, referencePrefix: null })

describe('loadBookingRules', () => {
  it('shows defaults at version 0 for a project with nothing saved', async () => {
    const h = harness()
    const r = await loadBookingRules(ctx(grant()), PID, h.deps)
    expect(r.ok && r.view.version).toBe(0)
    expect(r.ok && r.view.canManage).toBe(true)
    expect(r.ok && r.view.visibility).toEqual({ payments: true, absenceNotice: false, passes: false })
  })
  it('is refused without reservations.booking.read, before any read', async () => {
    const h = harness()
    await expect(loadBookingRules(ctx(grant({ permissions: [] })), PID, h.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(h.store.get).not.toHaveBeenCalled()
    expect(h.readSite).not.toHaveBeenCalled()
  })
  it('is refused when the module is not installed on the project', async () => {
    const h = harness()
    await expect(loadBookingRules(ctx(grant({ enabledModuleIds: [] })), PID, h.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
  })
  it('is refused for a project the caller has no grant on', async () => {
    const h = harness()
    await expect(loadBookingRules(ctx(grant()), OTHER, h.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(h.store.get).not.toHaveBeenCalled()
  })
  it('a reader without settings.manage gets canManage false', async () => {
    const r = await loadBookingRules(ctx(grant({ role: 'editor', permissions: ['reservations.booking.read'] })), PID, harness().deps)
    expect(r.ok && r.view.canManage).toBe(false)
  })
  it('answers unavailable (not an error) when migration 066 is not applied', async () => {
    const h = harness()
    h.store.get = vi.fn(async () => fail({ kind: 'unavailable' }))
    expect(await loadBookingRules(ctx(grant()), PID, h.deps)).toEqual({ ok: false, error: 'unavailable' })
  })
  it('hides sections from the capabilities and never returns them', async () => {
    const h = harness(null, site({ capOfflinePayments: false, capAbsenceNotice: true, capPasses: true, capPassSignUp: 'opt_in' }))
    const r = await loadBookingRules(ctx(grant()), PID, h.deps)
    expect(r.ok && r.view.visibility).toEqual({ payments: false, absenceNotice: true, passes: true })
    expect(JSON.stringify(r)).not.toContain('capAbsenceNotice')
  })
})

describe('saveBookingRules', () => {
  const input = (over: Record<string, unknown> = {}, ...v: unknown[]) => ({ expectedVersion: v.length ? v[0] : 0, values: { ...defaults(), ...over } })

  it('is refused without reservations.settings.manage, before any read or write', async () => {
    const h = harness()
    await expect(saveBookingRules(ctx(grant({ permissions: ['reservations.booking.read'] })), PID, input(), h.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(h.readSite).not.toHaveBeenCalled()
    expect(h.store.get).not.toHaveBeenCalled()
    expect(h.store.save).not.toHaveBeenCalled()
  })
  it('is refused for a project the caller has no grant on', async () => {
    const h = harness()
    await expect(saveBookingRules(ctx(grant()), OTHER, input(), h.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(h.store.save).not.toHaveBeenCalled()
  })
  it('saves, bumps the version, and writes only to the caller’s project', async () => {
    const h = harness()
    const r = await saveBookingRules(ctx(grant()), PID, input({ acceptBankTransfer: true, holdDays: 9, referencePrefix: 'cyce', bankDetails: { en: 'IBAN' } }), h.deps)
    expect(r.ok && r.view.version).toBe(1)
    expect(h.store.save).toHaveBeenCalledWith(PID, 0, expect.objectContaining({ referencePrefix: 'CYCE', bankDetails: { en: 'IBAN' }, rules: expect.objectContaining({ holdDays: 9, acceptBankTransfer: true }) }))
    const again = await saveBookingRules(ctx(grant()), PID, input({ holdDays: 10 }, 1), h.deps)
    expect(again.ok && again.view.version).toBe(2)
  })
  it('answers conflict when the page is out of date, and writes nothing', async () => {
    const h = harness({ projectId: PID, rules: {}, bankDetails: null, paymentInstructions: null, referencePrefix: null, version: 3 })
    const r = await saveBookingRules(ctx(grant()), PID, input({}, 2), h.deps)
    expect(r).toEqual({ ok: false, error: 'conflict' })
    expect(h.store.save).not.toHaveBeenCalled()
  })
  it('answers conflict when someone saves between the check and the write', async () => {
    const h = harness({ projectId: PID, rules: {}, bankDetails: null, paymentInstructions: null, referencePrefix: null, version: 1 })
    h.store.save = vi.fn(async () => fail({ kind: 'conflict', code: 'changed' }))
    expect(await saveBookingRules(ctx(grant()), PID, input({}, 1), h.deps)).toEqual({ ok: false, error: 'conflict' })
  })
  it('a first save loses cleanly when another first save won', async () => {
    const h = harness()
    h.store.save = vi.fn(async () => fail({ kind: 'conflict', code: 'changed' }))
    expect(await saveBookingRules(ctx(grant()), PID, input(), h.deps)).toEqual({ ok: false, error: 'conflict' })
  })
  it('rejects invalid values with the fields named, writing nothing', async () => {
    const h = harness()
    const r = await saveBookingRules(ctx(grant()), PID, input({ holdDays: 99, referencePrefix: 'no way' }), h.deps)
    expect(r).toEqual({ ok: false, error: 'invalid', errors: { holdDays: 'out_of_range', referencePrefix: 'bad_prefix' } })
    expect(h.store.save).not.toHaveBeenCalled()
  })
  it('rejects a missing or malformed expected version', async () => {
    const h = harness()
    for (const v of [undefined, -1, 1.5, '1']) expect(await saveBookingRules(ctx(grant()), PID, input({}, v), h.deps), String(v)).toEqual({ ok: false, error: 'invalid' })
  })
  it('refuses to switch on a capability Abluo has not enabled', async () => {
    const h = harness()
    const r = await saveBookingRules(ctx(grant()), PID, input({ passSignUp: 'opt_in', absenceNotice: { enabled: true, releasePlace: false, outcome: 'none' } }), h.deps)
    expect(r).toMatchObject({ ok: false, error: 'invalid', errors: { passSignUp: 'capability_off', 'absenceNotice.enabled': 'capability_off' } })
  })
  it('keeps the stored value of a capability that is off', async () => {
    const h = harness({ projectId: PID, rules: { passSignUp: 'opt_in', holdDays: 4 }, bankDetails: null, paymentInstructions: null, referencePrefix: null, version: 1 })
    await saveBookingRules(ctx(grant()), PID, input({ passSignUp: 'off' }, 1), h.deps)
    expect(h.row()?.rules).toMatchObject({ passSignUp: 'opt_in' })
  })
  it('rejects text in a language the site does not have', async () => {
    const r = await saveBookingRules(ctx(grant()), PID, input({ bankDetails: { fr: 'x' } }), harness().deps)
    expect(r).toMatchObject({ ok: false, error: 'invalid', errors: { bankDetails: 'bad_language' } })
  })
  it('answers unavailable when migration 066 is not applied', async () => {
    const h = harness()
    h.store.get = vi.fn(async () => fail({ kind: 'unavailable' }))
    expect(await saveBookingRules(ctx(grant()), PID, input(), h.deps)).toEqual({ ok: false, error: 'unavailable' })
  })
})

describe('siteFactsOf', () => {
  it('puts the default language first and ignores junk', () => {
    expect(siteFactsOf({ config: { capPasses: true }, site: { defaultLocale: 'it', supportedLocales: ['en', 'it', 3] } })).toEqual({ config: { capPasses: true }, defaultLocale: 'it', languages: ['it', 'en'] })
    expect(siteFactsOf(null)).toEqual({ config: null, defaultLocale: 'en', languages: ['en'] })
    expect(siteFactsOf({ config: [1] }).config).toBeNull()
  })
})
