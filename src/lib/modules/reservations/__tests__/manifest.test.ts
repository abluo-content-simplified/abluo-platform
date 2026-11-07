import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import { GRANTABLE_MODULE_PERMISSIONS } from '@/lib/authz/permissions'
import { SUPPORT_NEVER_WRITES, supportPermissions } from '@/lib/support/state'
import {
  DEFAULT_RESERVATION_CAPABILITIES,
  RESERVATION_CAPABILITY_CONFIG_IDS,
  resolveReservationCapabilities,
} from '../capabilities'

const mod = MODULE_REGISTRY.find((m) => m.id === 'reservations')!
const perms = mod.platformContract.permissions

describe('Reservations manifest (ADR-044 D12)', () => {
  it('is registered, operational-only, standalone and has no sections, schema types or navigation', () => {
    expect(mod).toBeDefined()
    expect(mod.dataStore.primary).toBe('operational')
    expect(mod.dependencies.requires).toEqual([])
    expect(mod.platformContract.sectionTypes).toEqual([])
    expect(mod.platformContract.schemaTypes).toEqual([])
    expect(mod.platformContract.collections).toEqual([])
    expect(mod.platformContract.pageType).toBeUndefined()
  })

  it('declares exactly the D12 permissions with the D12 default roles', () => {
    expect(Object.fromEntries(perms.map((p) => [p.id, [...p.defaultRoles]]))).toEqual({
      'reservations.booking.read': ['owner', 'editor'],
      'reservations.booking.write': ['owner', 'editor'],
      'reservations.booking.delete': ['owner'],
      'reservations.payment.update': ['owner'],
      'reservations.refund.manage': ['owner'],
      'reservations.capacity.manage': ['owner'],
      'reservations.export.use': ['owner'],
      'reservations.settings.manage': ['owner'],
    })
    for (const p of perms) {
      expect(p.label).toBeTruthy()
      expect(p.description).toBeTruthy()
    }
  })

  it('payment, refund, export and settings are never writable in support mode', () => {
    for (const id of ['reservations.payment.update', 'reservations.refund.manage', 'reservations.export.use', 'reservations.settings.manage']) {
      expect(SUPPORT_NEVER_WRITES).toContain(id)
    }
  })

  it('bookings are hidden from support (even when contact requests are shown) — D16.16 tenant grant is a TODO', () => {
    const all = perms.map((p) => p.id)
    for (const purpose of ['render', 'mutation'] as const) {
      const got = supportPermissions({ rolePermissions: all, purpose, writesAllowed: true, contactRequestsShown: true })
      expect(got.some((id) => id.startsWith('reservations.booking.'))).toBe(false)
    }
  })

  it('grantable extras are booking.read and payment.update (requires booking.read), as in migration 066', () => {
    const extras = Object.keys(GRANTABLE_MODULE_PERMISSIONS).filter((id) => id.startsWith('reservations.'))
    expect(extras.sort()).toEqual(['reservations.booking.read', 'reservations.payment.update'])
    expect(GRANTABLE_MODULE_PERMISSIONS['reservations.payment.update']).toEqual({ requires: 'reservations.booking.read' })
    const sql = readFileSync(path.join(process.cwd(), 'supabase/migrations/066_reservations.sql'), 'utf8')
    expect(sql).toMatch(/'reservations\.booking\.read',\s*'project',\s*null/)
    expect(sql).toMatch(/'reservations\.payment\.update',\s*'project',\s*'reservations\.booking\.read'/)
  })
})

describe('Reservations capabilities (ADR-044 D13)', () => {
  it('nothing stored → the defaults; Stripe and reminders are locked off', () => {
    expect(resolveReservationCapabilities(null)).toEqual(DEFAULT_RESERVATION_CAPABILITIES)
    const c = resolveReservationCapabilities({ capPasses: true, capPassSignUp: 'opt_in', capPassEntries: true, reminders: true, stripe: true })
    expect(c).toMatchObject({ passes: true, passSignUp: 'opt_in', passEntries: true, reminders: false, stripe: false })
  })
  it('pass options mean nothing without passes; invalid values fall back', () => {
    expect(resolveReservationCapabilities({ capPassEntries: true, capPassSignUp: 'opt_in' })).toMatchObject({ passes: false, passEntries: false, passSignUp: 'off' })
    expect(resolveReservationCapabilities({ capPasses: true, capPassSignUp: 'nonsense', capOfflinePayments: 'yes' })).toMatchObject({ passSignUp: 'off', offlinePayments: true })
  })
  it('the manifest declares exactly the capability fields the resolver reads', () => {
    expect(mod.platformContract.configSchema.map((f) => f.id)).toEqual([...RESERVATION_CAPABILITY_CONFIG_IDS])
  })
})
