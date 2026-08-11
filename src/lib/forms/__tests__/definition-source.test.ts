import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Sanity client so resolveActiveDefinition never touches the network.
vi.mock('@/lib/sanity/client', () => ({ sanityClient: { fetch: vi.fn() } }))

import { sanityClient } from '@/lib/sanity/client'
import {
  mapSanityFormDefinition,
  reconstructDefinitionFromSnapshot,
  resolveActiveDefinition,
} from '@/lib/forms/definition-source'
import { resolveDefinition, resolveDefinitionSnapshot } from '@/lib/forms/definitions'
import fixture from './early-access.fixture.json'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFetch = (sanityClient as any).fetch as ReturnType<typeof vi.fn>

// The slice-1 code descriptor wrote the non-canonical 'multiselect'; the Field
// Library canonical (types.ts + slice-2 schema enum) is 'multi-select'. Field
// type is informational in the snapshot (validation never branches on it), so
// this one string is normalized when comparing behaviour-equivalence.
const canon = (snap: unknown) => JSON.parse(JSON.stringify(snap).split('"multiselect"').join('"multi-select"'))

beforeEach(() => mockFetch.mockReset())

describe('mapSanityFormDefinition', () => {
  it('maps the published Early Access doc to the same snapshot as the code descriptor', () => {
    const mapped = mapSanityFormDefinition(fixture)
    const code = resolveDefinition('early-access')!
    expect(mapped).not.toBeNull()
    expect(canon(resolveDefinitionSnapshot(mapped!))).toEqual(canon(resolveDefinitionSnapshot(code)))
  })

  it('uses the canonical Field Library type for multi-select', () => {
    const mapped = mapSanityFormDefinition(fixture)!
    const useCases = mapped.steps[1].fields.find((f) => f.key === 'useCases')!
    expect(useCases.type).toBe('multi-select')
  })

  it('returns null for a doc with no formId or no steps', () => {
    expect(mapSanityFormDefinition(null)).toBeNull()
    expect(mapSanityFormDefinition({ formId: 'x', steps: [] })).toBeNull()
  })
})

describe('reconstructDefinitionFromSnapshot', () => {
  it('round-trips the pinned snapshot unchanged', () => {
    const snap = resolveDefinitionSnapshot(mapSanityFormDefinition(fixture)!)
    expect(resolveDefinitionSnapshot(reconstructDefinitionFromSnapshot(snap))).toEqual(snap)
  })

  it('defaults consent to required for pre-slice-3 snapshots missing the flag', () => {
    const snap = resolveDefinitionSnapshot(mapSanityFormDefinition(fixture)!)
    const legacy = { formId: 'early-access', version: 1, steps: snap.steps }
    expect(reconstructDefinitionFromSnapshot(legacy).requiresConsentAtFinalStep).toBe(true)
  })
})

describe('resolveDefinitionSnapshot', () => {
  it('carries requiresConsentAtFinalStep', () => {
    const snap = resolveDefinitionSnapshot(resolveDefinition('early-access')!) as { requiresConsentAtFinalStep?: boolean }
    expect(snap.requiresConsentAtFinalStep).toBe(true)
  })
})

describe('resolveActiveDefinition', () => {
  it('uses the published Sanity definition when one exists', async () => {
    mockFetch.mockResolvedValueOnce(fixture)
    const def = await resolveActiveDefinition('early-access', 'livener')
    const code = resolveDefinition('early-access')!
    expect(def).not.toBeNull()
    expect(canon(resolveDefinitionSnapshot(def!))).toEqual(canon(resolveDefinitionSnapshot(code)))
  })

  it('falls back to the code descriptor on a Sanity miss', async () => {
    mockFetch.mockResolvedValueOnce(null)
    const def = await resolveActiveDefinition('early-access', 'livener')
    expect(def?.formId).toBe('early-access')
  })

  it('falls back to the code descriptor on a Sanity error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('sanity down'))
    const def = await resolveActiveDefinition('early-access', 'livener')
    expect(def?.formId).toBe('early-access')
  })

  it('returns null for an unknown formId (route → 404)', async () => {
    mockFetch.mockResolvedValueOnce(null)
    const def = await resolveActiveDefinition('does-not-exist', 'livener')
    expect(def).toBeNull()
  })
})
