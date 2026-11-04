import { describe, expect, it } from 'vitest'
import { hexToLottieColor, PLATFORM_ANIMATIONS, platformAnimation } from '../platform'
import { readLottie } from '@/lib/media/lottie'

/** Every `sid` used on a property anywhere in the animation. */
function usedSlots(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((n) => usedSlots(n, out))
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'sid' && typeof v === 'string') out.add(v)
      else usedSlots(v, out)
    }
  }
  return out
}

describe('platform animations (ADR-046)', () => {
  it.each(PLATFORM_ANIMATIONS.map((a) => [a.id, a]))('%s is a valid Lottie animation with its source and licence recorded', (_, a) => {
    expect(readLottie(new TextEncoder().encode(JSON.stringify(a.data)))?.format).toBe('lottie-json')
    expect(a.source.trim()).not.toBe('')
    expect(a.license.trim()).not.toBe('')
  })

  it.each(PLATFORM_ANIMATIONS.map((a) => [a.id, a]))('%s declares exactly the colour slots it uses', (_, a) => {
    const declared = Object.keys((a.data.slots ?? {}) as Record<string, unknown>).sort()
    expect(declared).toEqual([...a.slots].sort())
    expect([...usedSlots(a.data.layers)].sort()).toEqual([...a.slots].sort())
  })

  it('ids are unique and found by id', () => {
    expect(new Set(PLATFORM_ANIMATIONS.map((a) => a.id)).size).toBe(PLATFORM_ANIMATIONS.length)
    expect(platformAnimation('checkmark')?.slots).toEqual(['accent'])
    expect(platformAnimation('nope')).toBeNull()
  })

  it('hexToLottieColor turns a design-system colour into a slot value', () => {
    expect(hexToLottieColor('#ff0000')).toEqual([1, 0, 0, 1])
    expect(hexToLottieColor('336699')).toEqual([0.2, 0.4, 0.6, 1])
    expect(hexToLottieColor('red')).toBeNull()
    expect(hexToLottieColor('#fff')).toBeNull()
  })
})
