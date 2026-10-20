import { describe, expect, it } from 'vitest'
import {
  attendanceModeAllowed,
  DEFAULT_EVENT_CAPABILITIES,
  EVENT_CAPABILITY_CONFIG_IDS,
  eventFieldAllowed,
  placeTokenAllowed,
  resolveEventCapabilities,
} from '../capabilities'
import { EVENT_CHOICE_FIELDS, EVENT_TEXT_FIELDS } from '@/lib/api/event-drafts'
import { MODULE_REGISTRY } from '@/lib/modules/registry'

describe('Events capabilities (ADR-038 D6)', () => {
  it('nothing stored → the defaults, which match the dashboard before capabilities', () => {
    expect(resolveEventCapabilities(null)).toEqual(DEFAULT_EVENT_CAPABILITIES)
    expect(resolveEventCapabilities({})).toEqual(DEFAULT_EVENT_CAPABILITIES)
    expect(DEFAULT_EVENT_CAPABILITIES).toMatchObject({ registration: 'externalLink', venues: 'abluoManaged', hosts: false, pricing: false, recurrence: false })
  })
  it('reads stored values and ignores invalid ones', () => {
    const c = resolveEventCapabilities({ capVenues: 'tenantManaged', capPricing: true, capRegistration: 'nonsense', capHosts: 'yes' })
    expect(c).toMatchObject({ venues: 'tenantManaged', pricing: true, registration: 'externalLink', hosts: false })
  })
  it('never leaves zero ways to attend', () => {
    const c = resolveEventCapabilities({ capInPerson: false, capOnline: false, capHybrid: false })
    expect(c.attendance).toEqual(DEFAULT_EVENT_CAPABILITIES.attendance)
  })
  it('every field the dashboard can change is governed by exactly one rule', () => {
    const editable = [...Object.keys(EVENT_TEXT_FIELDS), ...Object.keys(EVENT_CHOICE_FIELDS), 'startDate', 'endDate', 'registrationUrl', 'place', 'categories']
    for (const f of editable) expect(eventFieldAllowed(DEFAULT_EVENT_CAPABILITIES, f), f).toBe(true)
    expect(eventFieldAllowed(DEFAULT_EVENT_CAPABILITIES, 'somethingElse')).toBe(false)
  })
  it('keeping a stored value is always allowed', () => {
    const c = resolveEventCapabilities({ capOnline: false, capVenues: 'off' })
    expect(attendanceModeAllowed(c, 'online', 'online')).toBe(true)
    expect(attendanceModeAllowed(c, 'online', 'inPerson')).toBe(false)
    expect(placeTokenAllowed(c, 'venue:v1', 'venue:v1')).toBe(true)
    expect(placeTokenAllowed(c, 'venue:v2', 'venue:v1')).toBe(false)
    expect(placeTokenAllowed(c, 'location:x', '')).toBe(true)
  })
  it('the manifest declares exactly the capability fields the resolver reads', () => {
    const events = MODULE_REGISTRY.find((m) => m.id === 'events')!
    const ids = events.platformContract.configSchema.map((f) => f.id).filter((id) => id.startsWith('cap'))
    expect(ids).toEqual([...EVENT_CAPABILITY_CONFIG_IDS])
  })
})
