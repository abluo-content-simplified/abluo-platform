/** Contract C2-9 — channel model fixtures. */
import { describe, expect, it } from 'vitest'
import { channelListIssues, channelUsage, publicContexts, readChannelEntry, readChannels } from '../channels'
import { resolvePrice } from '../prices'
import { ck, channel, format, price } from './fixtures'

describe('C2 channels', () => {
  it('C2-F1 empty — null → no channels; publicContexts = [general]', () => {
    const { channels, issues } = readChannels(null)
    expect(channels.all).toEqual([])
    expect(channels.active).toEqual([])
    expect(channels.none).toBe(true)
    expect(issues).toEqual([])
    expect(publicContexts(channels)).toEqual([{ kind: 'general' }])
  })
  it('C2-F2 legacy preset entry — active: true, defaultAvailability: unavailable (read default), unmigrated', () => {
    const { channels } = readChannels([{ value: 'dine-in', label: { en: 'Dine-in' } }])
    expect(channels.all[0]).toMatchObject({ key: 'dine-in', active: true, defaultAvailability: 'unavailable', defaultSchedule: [], explicitDefault: false })
    expect(channels.unmigrated).toBe(true)
    expect(publicContexts(channels)).toEqual([{ kind: 'channel', channel: 'dine-in' }])
  })
  it('C2-F3 all inactive → none', () => {
    const { channels } = readChannels([
      { value: 'a', label: { en: 'A' }, active: false, defaultAvailability: 'available' },
      { value: 'b', label: { en: 'B' }, active: false, defaultAvailability: 'unavailable' },
    ])
    expect(channels.none).toBe(true)
    expect(channels.unmigrated).toBe(false)
  })
  it('C2-F4 order — stored order kept in all and active', () => {
    const { channels } = readChannels([{ value: 'takeaway', label: { en: 'T' } }, { value: 'dine-in', label: { en: 'D' } }])
    expect(channels.all.map((c) => c.key)).toEqual(['takeaway', 'dine-in'])
    expect(channels.active.map((c) => c.key)).toEqual(['takeaway', 'dine-in'])
  })
  it('C2-F5 key rename refused — same _key, new value → channel.keyImmutable', () => {
    const prev = [{ ...channel('dine-in', 'available'), entryKey: 'k1' }]
    const next = [{ ...channel('dinein', 'available'), entryKey: 'k1' }]
    expect(channelListIssues(next, prev, { defaultLocale: 'en' }).map((i) => i.code)).toContain('channel.keyImmutable')
  })
  it('C2-F6 delete referenced — removing takeaway while one draft price names it', () => {
    const prev = [channel('dine-in', 'available'), channel('takeaway', 'available')]
    const next = [channel('dine-in', 'available')]
    const usage = { items: [{ formats: [{ _key: 'default', _type: 'catalogueFormat', prices: [{ _key: 'p', amount: 5, channel: 'takeaway' }] }] }] }
    const issues = channelListIssues(next, prev, { defaultLocale: 'en', usage })
    expect(issues).toContainEqual({ code: 'channel.deleteReferenced', level: 'error', key: 'takeaway', usage: { prices: 1, itemRules: 0, formatRules: 0, categoryRules: 0 } })
    // Legacy offers count too.
    expect(channelUsage(ck('takeaway'), { items: [{ offers: [{ _key: 'o', channel: 'takeaway', price: 1 }] }] }).prices).toBe(1)
  })
  it('C2-F7 key literally "default" — accepted, and never the standard price bucket', () => {
    const { channels } = readChannels([{ value: 'default', label: { en: 'Default' }, defaultAvailability: 'available' }])
    expect(channels.all.map((c) => c.key)).toEqual(['default'])
    expect(channelListIssues(channels.all, [], { defaultLocale: 'en' })).toEqual([])
    const r = resolvePrice(format('f', { prices: [price('c', 9, { scope: 'default' }), price('s', 12)] }), { kind: 'general' }, new Date(), null, channels, { currency: 'EUR' })
    expect(r).toMatchObject({ kind: 'price', price: { key: 's' }, source: { kind: 'standard' } })
  })
  it('C2-F8 malformed — a MIGRATED {value: "Dine In"} is dropped with channel.malformedEntry', () => {
    const { channels, issues } = readChannels([{ value: 'Dine In', defaultAvailability: 'available' }])
    expect(channels.all).toEqual([])
    expect(issues.map((i) => i.code)).toEqual(['channel.malformedEntry'])
  })
  it('R1 dual-read — an UNMIGRATED set keeps legacy values that fail the key rule (any non-empty value); empty values still drop', () => {
    const { channels, issues } = readChannels([{ value: 'Dine In' }, { value: 'takeAway' }, { value: '  ' }, { value: 'dine-in' }])
    expect(channels.unmigrated).toBe(true)
    expect(channels.all.map((c) => c.key)).toEqual(['Dine In', 'takeAway', 'dine-in'])
    expect(issues.map((i) => [i.code, i.index])).toEqual([['channel.malformedEntry', 2]])
    // The strict rule still applies to migrated entries and to save-time validation.
    expect(readChannelEntry({ value: 'takeAway', defaultAvailability: 'unavailable' }, { legacy: true })).toBeNull()
    expect(readChannelEntry({ value: 'takeAway' })).toBeNull()
    expect(channelListIssues(channels.all, [], { defaultLocale: 'en' }).map((i) => i.code)).toContain('channel.keyInvalid')
  })
  it('validation: invalid key, duplicate, missing label, limit, schedule codes', () => {
    const many = Array.from({ length: 13 }, (_, i) => channel(`c${i}`, 'available'))
    const codes = channelListIssues(
      [...many, channel('c0', 'available'), { ...channel('Bad Key', 'available') }, { ...channel('nolabel', 'available'), label: { it: 'x' } }, channel('s', 'unavailable', { schedule: [{ kind: 'weekly', key: 'z', days: [], from: '10:00', to: '10:00', state: 'available' }] })],
      [],
      { defaultLocale: 'en' },
    ).map((i) => i.code)
    expect(codes).toEqual(expect.arrayContaining(['channel.limitExceeded', 'channel.keyDuplicate', 'channel.keyInvalid', 'channel.labelMissing', 'availability.scheduleZeroLength']))
  })
})
