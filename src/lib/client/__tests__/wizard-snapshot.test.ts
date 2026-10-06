import { describe, expect, it } from 'vitest'
import { applyToSnapshot } from '@/components/client/create/snapshot'
import type { DraftSnapshot } from '@/components/client/create/types'

const base: DraftSnapshot = {
  id: 'x',
  rev: 'r',
  title: { it: 'Ciao' },
  subtitle: {},
  excerpt: {},
  body: {},
  categories: [],
  cover: null,
  step: 'title',
}

describe('wizard snapshot patches', () => {
  it('applies autosave paths locally, the way the server stores them', () => {
    const out = applyToSnapshot(base, {
      'title.de': 'Hallo',
      'subtitle.it': 'Sotto',
      'body.it': [{ _type: 'block', _key: 'b', children: [] }],
      categories: ['a'],
      'wizard.step': 'story',
      'wizard.furthest': 'cover',
    })
    expect(out.title).toEqual({ it: 'Ciao', de: 'Hallo' })
    expect(out.subtitle).toEqual({ it: 'Sotto' })
    expect(out.body.it).toHaveLength(1)
    expect(out.categories).toEqual(['a'])
    expect(out.step).toBe('story')
    expect(out.furthest).toBe('cover')
    expect(base.title).toEqual({ it: 'Ciao' })
  })

  it('an emptied value is removed (the server unsets it); unknown paths are ignored', () => {
    const out = applyToSnapshot(base, { 'title.it': '', 'body.it': [], projectSlug: 'evil', 'slug.it': 'x' })
    expect(out.title).toEqual({})
    expect(out).not.toHaveProperty('projectSlug')
    expect(out).not.toHaveProperty('slug')
  })
})

describe('call-to-action patches', () => {
  it('custom + key, then back to default clears the key', () => {
    const custom = applyToSnapshot(base, { 'cta.mode': 'custom', 'cta.ref': 'cta-call' })
    expect(custom.cta).toEqual({ mode: 'custom', ref: 'cta-call' })
    expect(applyToSnapshot(custom, { 'cta.mode': 'default', 'cta.ref': null }).cta).toEqual({ mode: 'default', ref: null })
    expect(applyToSnapshot(custom, { 'cta.mode': 'none', 'cta.ref': null }).cta).toEqual({ mode: 'none', ref: null })
  })
})

describe('gallery patch', () => {
  it('sets and clears the gallery locally', () => {
    const withG = applyToSnapshot(base, { gallery: 'g1' })
    expect(withG.gallery).toBe('g1')
    expect(applyToSnapshot(withG, { gallery: null }).gallery).toBeNull()
  })
})
