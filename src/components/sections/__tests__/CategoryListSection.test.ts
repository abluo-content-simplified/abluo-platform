import { describe, expect, it } from 'vitest'
import { hasRenderableCallout, resolveColumnBackground } from '../CategoryListSection'

describe('hasRenderableCallout', () => {
  it('returns false when the callout is undefined', () => {
    expect(hasRenderableCallout(undefined)).toBe(false)
  })

  it('returns false when the callout is null (GROQ unset-field shape)', () => {
    // GROQ returns `null` (not `undefined`) for an unset object field, so the
    // guard has to reject null explicitly or the bar renders empty.
    expect(hasRenderableCallout(null)).toBe(false)
  })

  it('returns false for an empty callout object left blank in Studio', () => {
    expect(hasRenderableCallout({})).toBe(false)
  })

  it('returns false for a callout carrying only an icon', () => {
    // An icon alone is decoration with nothing to say — not worth a full bar.
    expect(hasRenderableCallout({ icon: 'code' })).toBe(false)
  })

  it('returns true when the callout has a title', () => {
    expect(hasRenderableCallout({ title: 'RESTful API + Webhooks' })).toBe(true)
  })

  it('returns true when the callout has only a description', () => {
    expect(hasRenderableCallout({ description: 'Sandbox environment included.' })).toBe(true)
  })

  it('returns true when the callout has only a resolvable CTA', () => {
    expect(
      hasRenderableCallout({
        cta: { internalName: 'API Access', actionType: 'externalUrl', externalUrl: 'https://example.com' },
      })
    ).toBe(true)
  })

  it('returns false for a CTA with no actionType chosen yet', () => {
    expect(hasRenderableCallout({ cta: { internalName: 'API Access' } })).toBe(false)
  })
})

describe('resolveColumnBackground', () => {
  it('passes through the surface background custom property', () => {
    expect(resolveColumnBackground('var(--color-section-surface2)')).toBe(
      'var(--color-section-surface2)'
    )
  })

  it('falls back to the page background for transparent surfaces', () => {
    // getSurfaceStyles() returns undefined for transparent / usePagePattern;
    // the columns still need an opaque paint or the 1px gaps stop reading as
    // hairlines and the whole grid shows the border colour through.
    expect(resolveColumnBackground(undefined)).toBe('var(--color-background)')
  })
})
