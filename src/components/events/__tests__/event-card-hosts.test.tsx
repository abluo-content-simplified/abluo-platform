/**
 * ADR-043 — event cards name the People-module hosts when the event stores
 * references (hostPeopleCount > 0), and fall back to the inline hosts exactly as before.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { EventCardExtras } from '@/components/events/EventEngagement'
import type { Event } from '@/lib/sanity/types'
import type { PersonPublic } from '@/lib/modules/people/projection'

const person = (over: Partial<PersonPublic> & { publicId: string }): PersonPublic => ({
  firstName: 'Anna', lastName: 'Rossi', visibility: 'listed', archived: false, hasPage: false, slug: {}, ...over,
})
const event = (over: Record<string, unknown>) =>
  ({ _id: 'e1', title: 'Class', hosts: [{ _key: 'h1', name: 'Legacy Teacher' }], ...over }) as unknown as Event
const html = (e: Event, extra: { peopleOn?: boolean } = {}) =>
  renderToStaticMarkup(<EventCardExtras event={e} locale="en" tenantId="cyce" {...extra} />)

describe('EventCardExtras hosts', () => {
  it('prefers hostPeople when references are stored', () => {
    const out = html(event({ hostPeopleCount: 2, hostPeople: [person({ publicId: 'a' }), person({ publicId: 'b', firstName: 'Marco', lastName: 'Bianchi' })] }))
    expect(out).toContain('Anna Rossi')
    expect(out).toContain('Marco Bianchi')
    expect(out).not.toContain('Legacy Teacher')
  })

  it('stored references win even when none is listable (never mixes in the legacy hosts)', () => {
    const out = html(event({ hostPeopleCount: 1, hostPeople: [] }))
    expect(out).not.toContain('Legacy Teacher')
  })

  it('falls back to the inline hosts with no stored references, or with the People module off', () => {
    expect(html(event({ hostPeopleCount: 0, hostPeople: null }))).toContain('Legacy Teacher')
    expect(html(event({}))).toContain('Legacy Teacher')
    expect(html(event({ hostPeopleCount: 1, hostPeople: [person({ publicId: 'a' })] }), { peopleOn: false })).toContain('Legacy Teacher')
  })

  it('renders nothing without hosts, price or registration', () => {
    expect(html(event({ hosts: [] }))).toBe('')
  })
})
