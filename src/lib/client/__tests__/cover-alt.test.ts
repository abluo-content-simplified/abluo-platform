import { describe, it, expect } from 'vitest'
import { coverNeedsAlt } from '../cover-alt'

describe('coverNeedsAlt', () => {
  it('is true only when a cover is set without default-language alt', () => {
    expect(coverNeedsAlt(null, 'it')).toBe(false)
    expect(coverNeedsAlt(undefined, 'it')).toBe(false)
    expect(coverNeedsAlt({ alt: {} }, 'it')).toBe(true)
    expect(coverNeedsAlt({ alt: { it: '  ' } }, 'it')).toBe(true)
    expect(coverNeedsAlt({ alt: { de: 'Meer' } }, 'it')).toBe(true)
    expect(coverNeedsAlt({ alt: { it: 'Il mare' } }, 'it')).toBe(false)
  })
})
