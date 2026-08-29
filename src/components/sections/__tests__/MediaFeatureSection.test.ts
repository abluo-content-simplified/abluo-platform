import { describe, expect, it } from 'vitest'
import {
  buildMediaLayers,
  cssEasing,
  featureGridColsClass,
  hasInteractiveMedia,
  hasMediaColumn,
  nextFeatureIndex,
  resolveActiveAlt,
  resolveActiveImage,
  resolveMediaStyle,
  selectionModeFromPointer,
} from '../MediaFeatureSection'
import type { FeatureRow, ResolvedImage } from '@/lib/sanity/types'

// ─── Fixtures for the interactive-media helpers ──────────────────────────────
// Asset refs use the real Sanity shape (image-<id>-<w>x<h>-<ext>) so the
// helpers that build URLs exercise the actual url-builder rather than a stub.

function img(id: string, alt?: string): ResolvedImage {
  return {
    asset: { _id: `image-${id}-1200x800-jpg`, _ref: `image-${id}-1200x800-jpg` },
    ...(alt ? { alt } : {}),
  } as unknown as ResolvedImage
}

function row(key: string, title?: string, image?: ResolvedImage): FeatureRow {
  return { _type: 'featureRow', _key: key, title, image } as FeatureRow
}

describe('featureGridColsClass', () => {
  // The two designs this section replaces (ProductShowcase, Qualification) both
  // hardcoded a desktop grid with no breakpoint, so they never collapsed on
  // mobile. Every class this helper can return must therefore be md:-prefixed.
  it('only ever emits md:-prefixed column classes', () => {
    const all = [
      featureGridColsClass(undefined, false),
      featureGridColsClass('50/50', false),
      featureGridColsClass('40/60', true),
      featureGridColsClass('40/60', false),
      featureGridColsClass('60/40', true),
      featureGridColsClass('60/40', false),
    ]
    for (const cls of all) {
      expect(cls.startsWith('md:')).toBe(true)
    }
  })

  it('defaults to an even split when contentRatio is unset (GROQ returns null)', () => {
    expect(featureGridColsClass(undefined, false)).toBe('md:grid-cols-2')
    // GROQ hands back null, not undefined, for a field the editor never touched
    expect(featureGridColsClass(null as unknown as undefined, true)).toBe('md:grid-cols-2')
  })

  it('treats 50/50 as the even split', () => {
    expect(featureGridColsClass('50/50', true)).toBe('md:grid-cols-2')
  })

  it('gives the media column the larger fraction for 40/60', () => {
    // contentRatio is content-first: 40 % content, 60 % media
    expect(featureGridColsClass('40/60', false)).toBe('md:grid-cols-[2fr_3fr]')
    expect(featureGridColsClass('40/60', true)).toBe('md:grid-cols-[3fr_2fr]')
  })

  it('gives the content column the larger fraction for 60/40', () => {
    expect(featureGridColsClass('60/40', false)).toBe('md:grid-cols-[3fr_2fr]')
    expect(featureGridColsClass('60/40', true)).toBe('md:grid-cols-[2fr_3fr]')
  })

  it('mirrors the fractions when the media moves to the left', () => {
    expect(featureGridColsClass('40/60', true)).not.toBe(featureGridColsClass('40/60', false))
    expect(featureGridColsClass('60/40', true)).not.toBe(featureGridColsClass('60/40', false))
  })
})

describe('hasMediaColumn', () => {
  it('is false when mediaPosition is none, even with an image set', () => {
    expect(hasMediaColumn('none', 'https://cdn.example/img.jpg')).toBe(false)
  })

  it('is false when no image resolved, even with a side chosen', () => {
    expect(hasMediaColumn('left', undefined)).toBe(false)
    expect(hasMediaColumn('right', undefined)).toBe(false)
  })

  it('is true for left or right with a resolved image', () => {
    expect(hasMediaColumn('left', 'https://cdn.example/img.jpg')).toBe(true)
    expect(hasMediaColumn('right', 'https://cdn.example/img.jpg')).toBe(true)
  })

  it('falls through to the media layout when mediaPosition is unset but an image exists', () => {
    // The component defaults mediaPosition to 'left'; an undefined value here
    // must not be mistaken for 'none'.
    expect(hasMediaColumn(undefined, 'https://cdn.example/img.jpg')).toBe(true)
  })
})

describe('resolveMediaStyle', () => {
  it('falls back to the default style when the key is unset', () => {
    expect(resolveMediaStyle(undefined, undefined).key).toBe('default')
  })

  it('falls back to the default style for a key the DS does not define', () => {
    expect(resolveMediaStyle('doesNotExist', undefined).key).toBe('default')
  })

  it('resolves a built-in key from the fallback table when the DS has no mediaStyles', () => {
    expect(resolveMediaStyle('landscape', undefined).aspectRatio).toBe('16/9')
    expect(resolveMediaStyle('circle', []).borderRadius).toBe(9999)
  })

  it('lets the Design System override what a named style means', () => {
    const ds = [{ key: 'rounded', borderRadius: 4, aspectRatio: '1/1' as const }]
    expect(resolveMediaStyle('rounded', ds).borderRadius).toBe(4)
  })

  it('falls back to the platform default when the DS defines styles but not this key', () => {
    const ds = [{ key: 'rounded', borderRadius: 4 }]
    expect(resolveMediaStyle('portrait', ds).key).toBe('default')
  })
})


// ─── Interactive media ───────────────────────────────────────────────────────

describe('hasInteractiveMedia', () => {
  const withImage = [row('a', 'Reservations'), row('b', 'Seating', img('bbb'))]

  it('is off unless the flag is explicitly true', () => {
    // GROQ hands back null for a document authored before the field existed;
    // undefined/false are the other two ways off is expressed.
    expect(hasInteractiveMedia(undefined, withImage)).toBe(false)
    expect(hasInteractiveMedia(null, withImage)).toBe(false)
    expect(hasInteractiveMedia(false, withImage)).toBe(false)
  })

  it('is off when the flag is on but no row carries an image yet', () => {
    // The editor ticked the box before uploading the six screenshots — the
    // section must keep rendering the historical static layout.
    expect(hasInteractiveMedia(true, [row('a'), row('b')])).toBe(false)
    expect(hasInteractiveMedia(true, [])).toBe(false)
    expect(hasInteractiveMedia(true, undefined)).toBe(false)
  })

  it('is on when the flag is set and at least one row has an image', () => {
    expect(hasInteractiveMedia(true, withImage)).toBe(true)
  })

  it('ignores a row whose image object has no asset', () => {
    const empty = [{ _type: 'featureRow', _key: 'a', image: {} }] as unknown as FeatureRow[]
    expect(hasInteractiveMedia(true, empty)).toBe(false)
  })
})

describe('resolveActiveImage', () => {
  const section = img('section')
  const rows = [row('a', 'Reservations'), row('b', 'Seating', img('seating'))]

  it('prefers the active row image', () => {
    expect(resolveActiveImage(rows, 1, section)).toBe(rows[1].image)
  })

  it('falls back to the section image when the active row has none', () => {
    expect(resolveActiveImage(rows, 0, section)).toBe(section)
  })

  it('falls back to the first row image when there is no section image', () => {
    // Guarantees the pane is never empty, which is the whole point of the
    // "first row active by default" rule.
    expect(resolveActiveImage(rows, 0, undefined)).toBe(rows[1].image)
  })

  it('returns undefined when nothing anywhere has an image', () => {
    expect(resolveActiveImage([row('a'), row('b')], 0, undefined)).toBeUndefined()
  })

  it('survives an out-of-range index (rows deleted while mounted)', () => {
    expect(resolveActiveImage(rows, 9, section)).toBe(section)
    expect(resolveActiveImage(undefined, 0, section)).toBe(section)
  })
})

describe('resolveActiveAlt', () => {
  it('prefers the row image alt', () => {
    const rows = [row('a', 'Seating Plan', img('seating', 'The seating plan editor'))]
    expect(resolveActiveAlt(rows, 0, undefined, 'Product')).toBe('The seating plan editor')
  })

  it('falls back to the row title when the row image has no alt', () => {
    const rows = [row('a', 'Seating Plan', img('seating'))]
    expect(resolveActiveAlt(rows, 0, undefined, 'Product')).toBe('Seating Plan')
  })

  it('uses the section image alt when the row falls back to the section image', () => {
    const rows = [row('a', 'Reservations')]
    expect(resolveActiveAlt(rows, 0, img('sec', 'Product screenshot'), 'Product')).toBe(
      'Product screenshot',
    )
  })

  it('falls back to the section title, then the empty string', () => {
    expect(resolveActiveAlt([row('a')], 0, img('sec'), 'Product')).toBe('Product')
    expect(resolveActiveAlt([row('a')], 0, undefined, undefined)).toBe('')
  })
})

describe('selectionModeFromPointer', () => {
  it('hovers on a fine pointer and taps everywhere else', () => {
    expect(selectionModeFromPointer(true)).toBe('hover')
    expect(selectionModeFromPointer(false)).toBe('click')
  })
})

describe('nextFeatureIndex', () => {
  it('moves forward and wraps at the end', () => {
    expect(nextFeatureIndex(0, 'ArrowDown', 6)).toBe(1)
    expect(nextFeatureIndex(0, 'ArrowRight', 6)).toBe(1)
    expect(nextFeatureIndex(5, 'ArrowDown', 6)).toBe(0)
  })

  it('moves backward and wraps at the start', () => {
    expect(nextFeatureIndex(1, 'ArrowUp', 6)).toBe(0)
    expect(nextFeatureIndex(0, 'ArrowUp', 6)).toBe(5)
    expect(nextFeatureIndex(0, 'ArrowLeft', 6)).toBe(5)
  })

  it('jumps to the ends for Home / End', () => {
    expect(nextFeatureIndex(3, 'Home', 6)).toBe(0)
    expect(nextFeatureIndex(3, 'End', 6)).toBe(5)
  })

  it('leaves the index alone for any other key', () => {
    // Returning `current` is what tells the handler not to preventDefault,
    // so Tab / typing / shortcuts keep their normal behaviour.
    expect(nextFeatureIndex(2, 'Tab', 6)).toBe(2)
    expect(nextFeatureIndex(2, 'a', 6)).toBe(2)
    expect(nextFeatureIndex(2, 'Enter', 6)).toBe(2)
  })

  it('never divides by zero on an empty list', () => {
    expect(nextFeatureIndex(0, 'ArrowDown', 0)).toBe(0)
    expect(nextFeatureIndex(0, 'End', 0)).toBe(0)
  })
})

describe('cssEasing', () => {
  it('converts a design-system cubic-bezier token straight through', () => {
    expect(cssEasing('cubic-bezier(0.2, 0, 0, 1)')).toBe('cubic-bezier(0.2, 0, 0, 1)')
  })

  it('converts a motion easing array to CSS', () => {
    expect(cssEasing([0, 0, 0.2, 1])).toBe('cubic-bezier(0, 0, 0.2, 1)')
  })

  it('maps motion named easings onto their CSS equivalents', () => {
    expect(cssEasing('easeOut')).toBe('ease-out')
    expect(cssEasing('easeInOut')).toBe('ease-in-out')
    expect(cssEasing('linear')).toBe('linear')
  })

  it('degrades to the platform default for anything unusable', () => {
    // Same never-throw contract as resolveEasing: a malformed DS token must
    // not be able to blank the section.
    expect(cssEasing(undefined)).toBe('cubic-bezier(0, 0, 0.2, 1)')
    expect(cssEasing('not-an-easing')).toBe('cubic-bezier(0, 0, 0.2, 1)')
    expect(cssEasing('backOut')).toBe('cubic-bezier(0, 0, 0.2, 1)')
  })
})

describe('buildMediaLayers', () => {
  it('builds nothing when there are no rows', () => {
    expect(buildMediaLayers(undefined, img('sec'))).toEqual({ layers: [], rowLayerIndex: [] })
  })

  it('gives every row with its own screenshot its own layer', () => {
    const rows = [row('a', 'A', img('one')), row('b', 'B', img('two'))]
    const { layers, rowLayerIndex } = buildMediaLayers(rows, undefined)
    expect(layers).toHaveLength(2)
    expect(rowLayerIndex).toEqual([0, 1])
    expect(layers[0].src).not.toBe(layers[1].src)
  })

  it('deduplicates rows that share the section image fallback', () => {
    // Four rows, one screenshot + the section image → two <img> elements,
    // not four downloads of the same file.
    const rows = [row('a'), row('b', 'B', img('two')), row('c'), row('d')]
    const { layers, rowLayerIndex } = buildMediaLayers(rows, img('sec'))
    expect(layers).toHaveLength(2)
    expect(rowLayerIndex).toEqual([0, 1, 0, 0])
  })

  it('maps a row with no resolvable image at all to -1', () => {
    const { rowLayerIndex } = buildMediaLayers([row('a')], undefined)
    expect(rowLayerIndex).toEqual([-1])
  })

  it('emits a srcSet for every layer so the pane stays responsive', () => {
    const { layers } = buildMediaLayers([row('a', 'A', img('one'))], undefined)
    expect(layers[0].srcSet).toContain('600w')
    expect(layers[0].srcSet).toContain('1600w')
  })
})
