import { describe, expect, it } from 'vitest'
import { GALLERY_CONTENT, POST_CONTENT, isContentPatch, routePreDraft } from '../lazy-draft'

describe('lazy draft creation', () => {
  it('a title, story text or a photo is content; empty values and positions are not', () => {
    expect(isContentPatch({ 'title.it': 'Ciao' }, POST_CONTENT)).toBe(true)
    expect(isContentPatch({ 'body.it': [{ _type: 'block' }] }, POST_CONTENT)).toBe(true)
    expect(isContentPatch({ 'title.it': '   ' }, POST_CONTENT)).toBe(false)
    expect(isContentPatch({ 'wizard.step': 'title', categories: ['cura'] }, POST_CONTENT)).toBe(false)
    expect(isContentPatch({ items: [{ key: 'k', assetId: 'a' }] }, GALLERY_CONTENT)).toBe(true)
    expect(isContentPatch({ items: [] }, GALLERY_CONTENT)).toBe(false)
  })

  it('holds non-content changes, then sends them together with the first content', () => {
    let r = routePreDraft({}, { categories: ['cura'] }, POST_CONTENT)
    expect(r).toEqual({ send: null, held: { categories: ['cura'] } })
    r = routePreDraft(r.held, { 'wizard.step': 'title' }, POST_CONTENT)
    expect(r.send).toBeNull()
    r = routePreDraft(r.held, { 'title.it': 'Ciao' }, POST_CONTENT)
    expect(r).toEqual({ send: { categories: ['cura'], 'wizard.step': 'title', 'title.it': 'Ciao' }, held: {} })
  })
})
