import { describe, expect, it } from 'vitest'
import { resolveVentureStatus, badgeStyle } from '../VentureListSection'
import { resolveSeparator } from '../ClientsFlowSection'
import { shouldSpanLastCard, resolveFeatureGridVariant } from '../FeatureGridSection'

// ─── Venture status ───────────────────────────────────────────────────────────

describe('resolveVentureStatus', () => {
  it('passes through the two states that carry news', () => {
    expect(resolveVentureStatus('live')).toBe('live')
    expect(resolveVentureStatus('soon')).toBe('soon')
  })

  it('treats unset as the resting state, not as an error', () => {
    // GROQ returns null (not undefined) for an unset field, and a venture
    // authored before the field existed has neither. Both are "in development",
    // which is the state most ventures are in most of the time.
    expect(resolveVentureStatus(null)).toBe('dev')
    expect(resolveVentureStatus(undefined)).toBe('dev')
    expect(resolveVentureStatus('dev')).toBe('dev')
  })

  it('falls back rather than trusting a value the schema no longer offers', () => {
    // A status removed from the options list must not leak into the DOM as a
    // class or a colour lookup that resolves to nothing.
    expect(resolveVentureStatus('shipped')).toBe('dev')
    expect(resolveVentureStatus('')).toBe('dev')
  })
})

describe('badgeStyle', () => {
  it('paints live from the success token, falling back to the accent', () => {
    // A design system with no success colour gets a duller page, not a broken
    // one — that fallback is what keeps the success token optional.
    const style = badgeStyle('live')
    expect(style.color).toBe('var(--color-success, var(--color-primary))')
  })

  it('paints soon with the accent', () => {
    expect(badgeStyle('soon').color).toBe('var(--color-primary)')
  })

  it('leaves dev unpainted — it is the resting state, not news', () => {
    const style = badgeStyle('dev')
    expect(style.color).toBe('var(--color-text-muted)')
    expect(style.backgroundColor).toBe('transparent')
    expect(style.border).toBe('1px solid var(--color-border)')
  })

  it('derives fill and hairline from the SAME token as the text', () => {
    // So a tenant that changes its accent gets a coherent badge rather than new
    // text sitting on a stale wash.
    for (const status of ['live', 'soon'] as const) {
      const style = badgeStyle(status)
      const token = style.color as string
      expect(style.backgroundColor).toBe(`color-mix(in srgb, ${token} 8%, transparent)`)
      expect(style.border).toBe(`1px solid color-mix(in srgb, ${token} 22%, transparent)`)
    }
  })
})

// ─── Clients separator ────────────────────────────────────────────────────────

describe('resolveSeparator', () => {
  it('uses the authored glyph', () => {
    expect(resolveSeparator('·')).toBe('·')
    expect(resolveSeparator('—')).toBe('—')
  })

  it('trims, so a stray space around the glyph does not double the gap', () => {
    expect(resolveSeparator('  /  ')).toBe('/')
  })

  it('falls back for unset, null and whitespace-only', () => {
    // Whitespace is the interesting one: an author who clears the field to a
    // space has left it blank, not chosen "no separator", and thirty names run
    // together with nothing between them is unreadable.
    expect(resolveSeparator(undefined)).toBe('/')
    expect(resolveSeparator(null)).toBe('/')
    expect(resolveSeparator('')).toBe('/')
    expect(resolveSeparator('   ')).toBe('/')
  })
})

// ─── Spanning last card ───────────────────────────────────────────────────────

describe('shouldSpanLastCard', () => {
  it('spans an odd count in a fixed-column grid', () => {
    expect(shouldSpanLastCard(true, '2', 5)).toBe(true)
    expect(shouldSpanLastCard(true, '3', 7)).toBe(true)
  })

  it('does nothing for an even count — there is no hole to fill', () => {
    expect(shouldSpanLastCard(true, '2', 4)).toBe(false)
    expect(shouldSpanLastCard(true, '2', 6)).toBe(false)
  })

  it('does nothing in auto columns, where auto-fit already fits the tracks', () => {
    // Forcing a span here fights the layout instead of tidying it.
    expect(shouldSpanLastCard(true, 'auto', 5)).toBe(false)
    expect(shouldSpanLastCard(true, null, 5)).toBe(false)
    expect(shouldSpanLastCard(true, undefined, 5)).toBe(false)
  })

  it('is off unless asked for — every existing grid is unchanged', () => {
    expect(shouldSpanLastCard(false, '2', 5)).toBe(false)
    expect(shouldSpanLastCard(null, '2', 5)).toBe(false)
    expect(shouldSpanLastCard(undefined, '2', 5)).toBe(false)
  })

  it('stops spanning when a card is added — the setting means "no hole"', () => {
    // tmz has five expertise cards today. A sixth removes the hole, and the
    // span should go away on its own rather than leave one card oddly wide.
    expect(shouldSpanLastCard(true, '2', 5)).toBe(true)
    expect(shouldSpanLastCard(true, '2', 6)).toBe(false)
  })

  it('handles an empty grid without claiming the zeroth card spans', () => {
    expect(shouldSpanLastCard(true, '2', 0)).toBe(false)
  })
})

// ─── The new ordinal variant ──────────────────────────────────────────────────

describe('resolveFeatureGridVariant: ordinal', () => {
  it('recognises ordinal', () => {
    expect(resolveFeatureGridVariant('ordinal')).toBe('ordinal')
  })

  it('leaves the three existing variants exactly as they were', () => {
    // 'number' is in use on a live page — a small corner watermark, a different
    // design from 'ordinal'. Adding one must not redefine the other.
    expect(resolveFeatureGridVariant('icon')).toBe('icon')
    expect(resolveFeatureGridVariant('number')).toBe('number')
    expect(resolveFeatureGridVariant('none')).toBe('none')
    expect(resolveFeatureGridVariant(null)).toBe('icon')
    expect(resolveFeatureGridVariant(undefined)).toBe('icon')
  })

  it('still falls back for a value the schema does not offer', () => {
    // 'list' exists on a live page and is not in the options list — it must
    // keep resolving to the icon default rather than rendering nothing.
    expect(resolveFeatureGridVariant('list')).toBe('icon')
  })
})
