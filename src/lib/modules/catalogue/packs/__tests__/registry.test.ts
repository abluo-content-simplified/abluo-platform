/** C7.3 build-time validation of the seven launch packs + the C7.11 `pack/*` fixtures. Pure. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateSegment } from '../../segment'
import { getPack, listPacks, PACK_REGISTRY, RELEASED_PACK_VERSIONS, foodStarterPacks } from '../registry'
import type { PackDeclaration } from '../types'
import { validatePackDeclaration, validateRegistry } from '../validate'

const clone = (p: PackDeclaration): PackDeclaration => structuredClone(p)
const codes = (p: PackDeclaration) => validatePackDeclaration(p, { released: RELEASED_PACK_VERSIONS[p.id] }).map((i) => i.code)

describe('the registry', () => {
  it('holds exactly the seven launch packs (K-6), all v3', () => {
    expect(listPacks().map((p) => `${p.id}@${p.version}`)).toEqual(['pizzeria@3', 'traditional-restaurant@3', 'fine-dining@3', 'cafe-and-bar@3', 'wine-bar@3', 'empty@3', 'bookshop@3'])
    expect(foodStarterPacks().map((p) => p.id)).toEqual(['pizzeria', 'traditional-restaurant', 'fine-dining', 'cafe-and-bar', 'wine-bar', 'empty'])
    expect(getPack('bookshop')?.version).toBe(3)
    expect(getPack('restaurant')).toBeNull()
  })

  it('pack/registry-valid: every declaration validates against the current schema and config rules', () => {
    expect(validateRegistry(PACK_REGISTRY, RELEASED_PACK_VERSIONS)).toEqual([])
  })

  it('released versions are pinned (a new version must be added here and be greater)', () => {
    expect(RELEASED_PACK_VERSIONS).toEqual({ pizzeria: [3], 'traditional-restaurant': [3], 'fine-dining': [3], 'cafe-and-bar': [3], 'wine-bar': [3], empty: [3], bookshop: [1, 3] })
    for (const p of PACK_REGISTRY) expect(RELEASED_PACK_VERSIONS[p.id]).toContain(p.version)
    expect(codes({ ...clone(getPack('bookshop')!), version: 0 })).toContain('pack_version_invalid')
    expect(validatePackDeclaration({ ...clone(getPack('bookshop')!), version: 2 }, { released: [1, 3] }).map((i) => i.code)).toContain('pack_version_invalid')
  })

  it('suggested segments pass validateSegment (segment collisions block at plan time, not here)', () => {
    for (const p of PACK_REGISTRY) if (p.suggestedSegment) expect(validateSegment(p.suggestedSegment).ok).toBe(true)
  })

  it('packs never carry a currency, money, an _id or a Studio reference', () => {
    const text = JSON.stringify(PACK_REGISTRY)
    expect(text).not.toMatch(/"currency"|"_id"|appliedPack|studio/i)
    for (const p of PACK_REGISTRY) for (const g of p.optionGroups) for (const c of g.choices) expect(c.priceDelta).toBe(0)
  })

  it('Empty seeds nothing; Bookshop suggests Book, no channel, the segment books (D-13)', () => {
    const e = getPack('empty')!
    expect([e.channels, e.categories, e.tags, e.collections, e.formatSuggestions, e.optionGroups, e.policySuggestions].every((l) => l.length === 0)).toBe(true)
    const b = getPack('bookshop')!
    expect([b.suggestedDefaultProfile, b.suggestedSegment, b.channels.length, b.suggestedPublicName?.en]).toEqual(['book', 'books', 0, 'Books'])
  })

  it('rule on defaults: every channel is available all week except Pizzeria delivery (evening only, declinable)', () => {
    for (const p of PACK_REGISTRY)
      for (const c of p.channels) {
        if (p.id === 'pizzeria' && c.key === 'delivery') {
          expect(c).toMatchObject({ defaultAvailability: 'unavailable', defaultAvailabilityWithoutSchedule: 'available', preselected: true })
          expect(c.defaultSchedule).toEqual([{ key: 'evening', days: [], from: '18:00', to: '23:00', state: 'available' }])
        } else {
          expect(c.defaultAvailability).toBe('available')
          expect(c.defaultSchedule ?? []).toEqual([])
        }
      }
  })

  it('C7.10 outlines: schedules where the contract names them', () => {
    const cafe = getPack('cafe-and-bar')!
    expect(cafe.categories.find((c) => c.key === 'breakfast')!.channelRules!['dine-in']).toEqual({ state: 'unavailable', overrides: [{ key: 'breakfast', days: [], from: '07:00', to: '11:00', state: 'available' }] })
    expect(cafe.categories.find((c) => c.key === 'cocktails')!.channelRules).toEqual({ 'dine-in': { state: 'unavailable', overrides: [{ key: 'evening', days: [], from: '17:00', to: '01:00', state: 'available' }] }, takeaway: { state: 'unavailable' } })
    const fine = getPack('fine-dining')!
    expect(fine.categories.find((c) => c.key === 'tasting_menus')!.channelRules!['dine-in'].overrides![0]).toMatchObject({ from: '19:00', to: '23:00', days: ['tue', 'wed', 'thu', 'fri', 'sat', 'sun'] })
    const trad = getPack('traditional-restaurant')!
    expect(trad.categories.find((c) => c.key === 'lunch_specials')!.channelRules!.takeaway.overrides![0]).toMatchObject({ from: '12:00', to: '15:00', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] })
    expect(getPack('pizzeria')!.categories.find((c) => c.key === 'spirits')!.channelRules).toEqual({ delivery: { state: 'unavailable' } })
    expect(getPack('wine-bar')!.categories.find((c) => c.key === 'wine')!.channelRules).toEqual({ takeaway: { state: 'available' } })
  })
})

describe('C7.11 pack/* fixtures', () => {
  it('pack/missing-locale', () => {
    const p = clone(getPack('pizzeria')!)
    delete (p.categories[0].label as Record<string, unknown>).de
    expect(codes(p)).toContain('pack_label_missing')
  })

  it('pack/currency', () => {
    const p = clone(getPack('pizzeria')!) as PackDeclaration & { currency?: string }
    p.currency = 'EUR'
    expect(codes(p)).toContain('pack_currency_present')
    const q = clone(getPack('bookshop')!)
    q.formatSuggestions[0].label.en = 'EUR'
    expect(codes(q)).toContain('pack_currency_present')
  })

  it('pack/empty-has-content', () => {
    const p = clone(getPack('empty')!)
    p.categories.push({ key: 'x', label: { en: 'X', it: 'X', de: 'X' }, parent: null })
    expect(codes(p)).toContain('pack_empty_not_empty')
  })

  it('pack/cycle', () => {
    const p = clone(getPack('bookshop')!)
    p.categories = [
      { key: 'a', label: { en: 'A', it: 'A', de: 'A' }, parent: 'b' },
      { key: 'b', label: { en: 'B', it: 'B', de: 'B' }, parent: 'a' },
    ]
    expect(codes(p)).toContain('pack_cycle')
  })

  it('pack/schedule-valid: every rule and channel default passes C5a scheduleIssues', () => {
    expect(validateRegistry(PACK_REGISTRY, RELEASED_PACK_VERSIONS).filter((i) => i.code === 'pack_schedule_invalid')).toEqual([])
  })

  it('pack/schedule-overlap', () => {
    const p = clone(getPack('cafe-and-bar')!)
    p.categories.find((c) => c.key === 'breakfast')!.channelRules!['dine-in'].overrides!.push({ key: 'second', days: [], from: '10:00', to: '12:00', state: 'available' })
    const issues = validatePackDeclaration(p, { released: [3] })
    expect(issues.find((i) => i.code === 'pack_schedule_invalid')?.message).toBe('availability.scheduleOverlap')
  })

  it('other codes: unknown parent, bad keys, duplicate keys, unknown rule channel, missing default, unknown profile, bad segment, unknown option group, depth', () => {
    const p = clone(getPack('pizzeria')!)
    p.categories.push({ key: 'Bad Key', label: { en: 'x', it: 'x', de: 'x' }, parent: 'nowhere' })
    p.categories.push({ ...p.categories[0] })
    p.categories[1].channelRules = { 'room-service': { state: 'available' } }
    ;(p.channels[0] as { defaultAvailability?: string }).defaultAvailability = undefined
    p.suggestedDefaultProfile = 'wine' as never
    p.suggestedSegment = 'Not Valid'
    p.categories[2].defaultOptionGroups = ['nope']
    const c = codes(p)
    for (const code of ['pack_parent_unknown', 'pack_key_invalid', 'pack_key_duplicate', 'pack_rule_channel_unknown', 'pack_channel_default_missing', 'pack_profile_unknown', 'pack_segment_invalid', 'pack_option_ref_unknown'] as const) expect(c).toContain(code)
    const deep = clone(getPack('bookshop')!)
    deep.categories = ['l1', 'l2', 'l3', 'l4', 'l5'].map((k, i, a) => ({ key: k, label: { en: k, it: k, de: k }, parent: i ? a[i - 1] : null }))
    expect(codes(deep)).toContain('pack_depth')
  })

  it('pack_id_invalid / pack_id_duplicate', () => {
    expect(validateRegistry([clone(getPack('bookshop')!), clone(getPack('bookshop')!)], RELEASED_PACK_VERSIONS).map((i) => i.code)).toContain('pack_id_duplicate')
    expect(codes({ ...clone(getPack('bookshop')!), id: 'Book Shop' as never })).toContain('pack_id_invalid')
  })

  it('pack_too_large: more categories than MAX_CATEGORIES', () => {
    const p = clone(getPack('bookshop')!)
    p.categories = Array.from({ length: 301 }, (_, i) => ({ key: `c${i}`, label: { en: `C${i}`, it: `C${i}`, de: `C${i}` }, parent: null }))
    expect(codes(p)).toContain('pack_too_large')
  })
})

describe('C7.9 pack_runtime_branch: no module outside packs/ reads the registry by pack id', () => {
  const SRC = join(process.cwd(), 'src')
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full, out)
      else if (/\.(ts|tsx)$/.test(name)) out.push(full)
    }
    return out
  }
  it('PACK_REGISTRY is referenced only inside packs/', () => {
    const inPacks = `lib${sep}modules${sep}catalogue${sep}packs${sep}`
    const offenders = walk(SRC)
      .map((f) => ({ rel: relative(SRC, f), text: readFileSync(f, 'utf8') }))
      .filter(({ rel, text }) => !rel.startsWith(inPacks) && /PACK_REGISTRY|RELEASED_PACK_VERSIONS/.test(text))
      .map((f) => f.rel)
    expect(offenders).toEqual([])
  })
})
